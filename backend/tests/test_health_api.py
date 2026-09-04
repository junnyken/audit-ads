"""A2 integration tests against a real PostgreSQL database (MINI-SPEC A2 §10.2)."""
from __future__ import annotations

import sqlalchemy as sa

from app.models.entities import AccountEvent, AdAccount
from app.models.health import AccountHealthSignal
from tests.test_readiness_api import make_ready_account


def health(api, account_id):
    response = api.get(f"/api/v1/ad-accounts/{account_id}/health")
    assert response.status_code == 200, response.text
    return response.json()


def signals(api, account_id, **params):
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return api.get(
        f"/api/v1/ad-accounts/{account_id}/health/signals" + (f"?{query}" if query else "")
    ).json()["items"]


def active(api, account_id):
    return [s for s in signals(api, account_id) if s["status"] in ("open", "acknowledged")]


def rule_keys(api, account_id):
    return sorted(s["rule_key"] for s in active(api, account_id))


# ------------------------------------------------------------------ evaluation basics
def test_creating_an_account_evaluates_health_immediately(api):
    account = api.post("/api/v1/ad-accounts", json={"display_name": "Fresh"}).json()
    body = health(api, account["id"])
    assert body["health_status"] in ("attention_needed", "warning", "critical")
    assert body["engine_version"] == "a2-v1"
    assert body["freshness_status"] == "current"
    assert body["readiness"]["status"] == "unknown"
    assert "not a platform approval" in body["disclaimer"]


def test_health_and_readiness_are_reported_separately(api):
    account = make_ready_account(api)
    body = health(api, account["id"])
    assert body["health_status"] == "clear_signals"
    assert body["readiness"]["status"] == "operationally_ready"
    assert "health_status" in body and "readiness" in body
    assert body["status_description"].startswith("No current issues found by configured checks")


def test_complete_account_reaches_clear_signals_with_no_open_signals(api):
    account = make_ready_account(api)
    assert active(api, account["id"]) == []
    assert health(api, account["id"])["counts"] == {
        "critical": 0,
        "warning": 0,
        "attention": 0,
        "unknown": 0,
    }


def test_missing_required_evidence_yields_attention_with_a_reason(api):
    account = api.post("/api/v1/ad-accounts", json={"display_name": "Incomplete", "status": "active"}).json()
    body = health(api, account["id"])
    codes = {reason["code"] for reason in body["summary_reasons"]}
    assert "mandatory_readiness_evidence_missing" in codes
    assert body["health_status"] in ("attention_needed", "warning")
    signal = next(s for s in active(api, account["id"]) if s["rule_key"] == "mandatory_readiness_evidence_missing")
    assert signal["evidence_json"]["item_keys"]
    assert signal["why_it_matters"] and signal["recommended_next_step"]


def test_restricted_status_produces_a_critical_signal_and_clears_when_the_fact_changes(api):
    account = make_ready_account(api)
    api.patch(f"/api/v1/ad-accounts/{account['id']}", json={"status": "restricted"})
    assert health(api, account["id"])["health_status"] == "critical"
    assert "account_restricted_status" in rule_keys(api, account["id"])

    api.patch(f"/api/v1/ad-accounts/{account['id']}", json={"status": "active"})
    assert health(api, account["id"])["health_status"] == "clear_signals"
    assert "account_restricted_status" not in rule_keys(api, account["id"])

    historical = [s for s in signals(api, account["id"]) if s["rule_key"] == "account_restricted_status"]
    assert len(historical) == 1, "the historical signal must survive"
    assert historical[0]["status"] == "resolved"
    assert historical[0]["resolved_by"] is None, "closed by the engine, not by a person"


def test_events_produce_signals_with_source_links_and_correct_precedence(api):
    account = make_ready_account(api)
    warning = api.post(
        f"/api/v1/ad-accounts/{account['id']}/events",
        json={"event_type": "spend_anomaly", "severity": "warning", "summary": "Spend spike."},
    ).json()["event"]
    assert health(api, account["id"])["health_status"] == "warning"

    critical = api.post(
        f"/api/v1/ad-accounts/{account['id']}/events",
        json={"event_type": "policy_notice", "severity": "critical", "summary": "Policy notice."},
    ).json()["event"]
    body = health(api, account["id"])
    assert body["health_status"] == "critical", "critical outranks warning"
    assert body["counts"]["critical"] == 1 and body["counts"]["warning"] == 1

    derived = {s["rule_key"]: s for s in active(api, account["id"])}
    assert derived["critical_account_event_open"]["source_entity_id"] == critical["id"]
    assert derived["warning_account_event_open"]["source_entity_id"] == warning["id"]
    assert derived["critical_account_event_open"]["source_type"] == "manual_event"

    api.post(f"/api/v1/account-events/{critical['id']}/resolve", json={"resolution_note": "Cleared."})
    assert health(api, account["id"])["health_status"] == "warning"
    api.post(f"/api/v1/account-events/{warning['id']}/resolve", json={"resolution_note": "Cleared."})
    assert health(api, account["id"])["health_status"] == "clear_signals"


def test_readiness_not_ready_is_suppressed_behind_a_critical_status_signal(api):
    account = make_ready_account(api)
    api.patch(f"/api/v1/ad-accounts/{account['id']}", json={"status": "restricted"})
    keys = rule_keys(api, account["id"])
    assert "account_restricted_status" in keys
    assert "readiness_not_ready" not in keys


# ------------------------------------------------------------------ signal actions
def test_acknowledge_requires_a_note_and_does_not_resolve_the_signal(api):
    account = make_ready_account(api)
    api.post(
        f"/api/v1/ad-accounts/{account['id']}/events",
        json={"event_type": "x", "severity": "warning", "summary": "Warning."},
    )
    signal = next(s for s in active(api, account["id"]) if s["rule_key"] == "warning_account_event_open")

    assert api.post(f"/api/v1/account-health/signals/{signal['id']}/acknowledge", json={"note": "  "}).status_code == 422

    body = api.post(
        f"/api/v1/account-health/signals/{signal['id']}/acknowledge",
        json={"note": "Seen; waiting on the finance team."},
    ).json()
    assert body["signal"]["status"] == "acknowledged"
    assert body["signal"]["resolved_at"] is None
    assert body["health"]["health_status"] == "warning", "acknowledgement is not resolution"

    logs = api.get(f"/api/v1/account-health/signals/{signal['id']}/audit-logs").json()["items"]
    assert any(entry["action"] == "health_signal.acknowledged" for entry in logs)


def test_acknowledged_signal_survives_re_evaluation(api):
    account = make_ready_account(api)
    api.post(
        f"/api/v1/ad-accounts/{account['id']}/events",
        json={"event_type": "x", "severity": "warning", "summary": "Warning."},
    )
    signal = next(s for s in active(api, account["id"]) if s["rule_key"] == "warning_account_event_open")
    api.post(
        f"/api/v1/account-health/signals/{signal['id']}/acknowledge", json={"note": "Seen."}
    )
    api.post(f"/api/v1/ad-accounts/{account['id']}/health/recalculate")
    after = next(s for s in active(api, account["id"]) if s["rule_key"] == "warning_account_event_open")
    assert after["id"] == signal["id"]
    assert after["status"] == "acknowledged"


def test_resolving_a_signal_requires_a_reason_and_leaves_the_source_record_alone(api, db_session):
    account = make_ready_account(api)
    created = api.post(
        f"/api/v1/ad-accounts/{account['id']}/events",
        json={"event_type": "x", "severity": "warning", "summary": "Warning."},
    ).json()["event"]
    signal = next(s for s in active(api, account["id"]) if s["rule_key"] == "warning_account_event_open")

    assert api.post(f"/api/v1/account-health/signals/{signal['id']}/resolve", json={"reason": " "}).status_code == 422

    body = api.post(
        f"/api/v1/account-health/signals/{signal['id']}/resolve",
        json={"reason": "Handled outside the tool."},
    ).json()
    assert body["signal"]["status"] == "resolved"
    assert body["signal"]["resolved_by"] is not None

    source = db_session.get(AccountEvent, created["id"])
    db_session.refresh(source)
    assert source.status.value == "open", "resolving a health signal must not touch the A1 event"

    logs = api.get(f"/api/v1/account-health/signals/{signal['id']}/audit-logs").json()["items"]
    assert any(entry["action"] == "health_signal.resolved" for entry in logs)


def test_a_signal_resolved_while_its_condition_holds_comes_back_on_re_evaluation(api):
    """Honest behaviour: closing the signal does not close the fact behind it."""
    account = make_ready_account(api)
    api.post(
        f"/api/v1/ad-accounts/{account['id']}/events",
        json={"event_type": "x", "severity": "warning", "summary": "Still true."},
    )
    signal = next(s for s in active(api, account["id"]) if s["rule_key"] == "warning_account_event_open")
    api.post(
        f"/api/v1/account-health/signals/{signal['id']}/resolve", json={"reason": "Premature."}
    )
    api.post(f"/api/v1/ad-accounts/{account['id']}/health/recalculate")
    reopened = [s for s in active(api, account["id"]) if s["rule_key"] == "warning_account_event_open"]
    assert len(reopened) == 1 and reopened[0]["id"] != signal["id"]


def test_reopen_requires_a_reason_and_refuses_when_an_active_signal_exists(api):
    account = make_ready_account(api)
    api.patch(f"/api/v1/ad-accounts/{account['id']}", json={"status": "restricted"})
    signal = next(s for s in active(api, account["id"]) if s["rule_key"] == "account_restricted_status")
    api.post(f"/api/v1/account-health/signals/{signal['id']}/resolve", json={"reason": "Closing."})

    assert api.post(f"/api/v1/account-health/signals/{signal['id']}/reopen", json={"reason": ""}).status_code == 422

    # Recalculation raised a replacement, so reopening the old one must be refused.
    api.post(f"/api/v1/ad-accounts/{account['id']}/health/recalculate")
    clash = api.post(
        f"/api/v1/account-health/signals/{signal['id']}/reopen", json={"reason": "Changed my mind."}
    )
    assert clash.status_code == 409


# --------------------------------------------------------------------- deduplication
def test_re_evaluating_unchanged_facts_creates_no_duplicate_signals(api, db_session):
    account = api.post("/api/v1/ad-accounts", json={"display_name": "Repeat"}).json()
    for _ in range(4):
        api.post(f"/api/v1/ad-accounts/{account['id']}/health/recalculate")
    rows = db_session.execute(
        sa.select(AccountHealthSignal).where(AccountHealthSignal.ad_account_id == account["id"])
    ).scalars().all()
    active_rows = [row for row in rows if row.status.value in ("open", "acknowledged")]
    assert len(active_rows) == len({row.signal_key for row in active_rows})


def test_material_evidence_change_creates_a_successor_and_supersedes_the_original(api):
    account = make_ready_account(api)
    first = api.post(
        f"/api/v1/ad-accounts/{account['id']}/events",
        json={"event_type": "x", "severity": "warning", "summary": "First wording."},
    ).json()["event"]
    original = next(s for s in active(api, account["id"]) if s["rule_key"] == "warning_account_event_open")

    api.patch(f"/api/v1/account-events/{first['id']}", json={"summary": "Materially different."})
    all_signals = signals(api, account["id"])
    superseded = next(s for s in all_signals if s["id"] == original["id"])
    successor = next(s for s in all_signals if s["status"] == "open" and s["rule_key"] == "warning_account_event_open")
    assert superseded["status"] == "superseded"
    assert superseded["superseded_by_signal_id"] == successor["id"]
    assert successor["evidence_json"]["message"] == "Materially different."


def test_evaluation_is_idempotent_for_the_snapshot(api):
    account = make_ready_account(api)
    first = api.post(f"/api/v1/ad-accounts/{account['id']}/health/recalculate").json()
    second = api.post(f"/api/v1/ad-accounts/{account['id']}/health/recalculate").json()
    assert first["health_status"] == second["health_status"] == "clear_signals"
    assert first["counts"] == second["counts"]


# ------------------------------------------------------------------------- archived
def test_archived_account_is_unknown_and_its_signals_are_expired(api):
    account = make_ready_account(api)
    api.patch(f"/api/v1/ad-accounts/{account['id']}", json={"status": "restricted"})
    assert health(api, account["id"])["health_status"] == "critical"

    api.post(f"/api/v1/ad-accounts/{account['id']}/archive")
    body = health(api, account["id"])
    assert body["health_status"] == "unknown"
    assert body["freshness_status"] == "not_applicable"
    assert active(api, account["id"]) == []
    assert any(s["status"] == "expired" for s in signals(api, account["id"]))


def test_signal_actions_are_refused_on_an_archived_account(api):
    account = make_ready_account(api)
    api.patch(f"/api/v1/ad-accounts/{account['id']}", json={"status": "restricted"})
    signal = next(s for s in active(api, account["id"]) if s["rule_key"] == "account_restricted_status")
    api.post(f"/api/v1/ad-accounts/{account['id']}/archive")
    response = api.post(
        f"/api/v1/account-health/signals/{signal['id']}/acknowledge", json={"note": "Nope."}
    )
    assert response.status_code == 422


# ----------------------------------------------------------------- runs and backfill
def test_manual_recalculation_records_an_evaluation_run(api):
    account = make_ready_account(api)
    api.post(f"/api/v1/ad-accounts/{account['id']}/health/recalculate")
    runs = api.get(f"/api/v1/account-health/evaluation-runs?ad_account_id={account['id']}").json()["items"]
    manual = [run for run in runs if run["trigger_type"] == "manual_recalculate"]
    assert manual and manual[0]["status"] == "succeeded"
    assert manual[0]["engine_version"] == "a2-v1"
    assert manual[0]["result_summary_json"]["health_status"] == "clear_signals"

    detail = api.get(f"/api/v1/account-health/evaluation-runs/{manual[0]['id']}").json()
    assert detail["id"] == manual[0]["id"]


def test_evaluation_runs_are_recorded_for_every_a1_trigger(api):
    account = make_ready_account(api)
    api.post(
        f"/api/v1/ad-accounts/{account['id']}/events",
        json={"event_type": "x", "severity": "info", "summary": "Noted."},
    )
    triggers = {run["trigger_type"] for run in api.get("/api/v1/account-health/evaluation-runs?page_size=200").json()["items"]}
    assert {"account_mutation", "checklist_mutation", "evidence_mutation", "account_event_mutation"} <= triggers


def test_backfill_is_owner_confirmed_and_bounded(api):
    for index in range(3):
        api.post("/api/v1/ad-accounts", json={"display_name": f"Bulk {index}", "external_account_id": f"b{index}"})

    assert api.post("/api/v1/account-health/backfill", json={"confirm": False}).status_code == 422
    assert api.post("/api/v1/account-health/backfill", json={"confirm": True, "batch_size": 999}).status_code == 422

    result = api.post("/api/v1/account-health/backfill", json={"confirm": True, "batch_size": 2}).json()
    assert result["evaluated"] == 2 and result["succeeded"] == 2 and result["failed"] == 0
    assert result["remaining_active_accounts"] == 3
    assert result["run_id"]


def test_rules_endpoint_lists_the_versioned_registry(api):
    rules = api.get("/api/v1/account-health/rules").json()
    assert len(rules) == 10
    keys = {rule["rule_key"] for rule in rules}
    assert "account_restricted_status" in keys and "manual_review_due_or_stale" in keys
    for rule in rules:
        assert rule["version"] >= 1 and rule["enabled"] is True
        assert rule["why_it_matters"] and rule["recommended_next_step"]


# ------------------------------------------------------------------ list and filters
def test_health_list_filters_sorting_and_pagination(api):
    ready = make_ready_account(api)
    api.post("/api/v1/ad-accounts", json={"display_name": "Needs work", "external_account_id": "nw"})
    restricted = api.post(
        "/api/v1/ad-accounts",
        json={"display_name": "Blocked", "external_account_id": "bl", "status": "restricted"},
    ).json()

    listing = api.get("/api/v1/account-health?page_size=50").json()
    assert listing["total"] == 3
    by_id = {row["ad_account_id"]: row for row in listing["items"]}
    assert by_id[ready["id"]]["health_status"] == "clear_signals"
    assert by_id[restricted["id"]]["health_status"] == "critical"
    assert by_id[restricted["id"]]["top_reason"]["code"] == "account_restricted_status"
    assert by_id[ready["id"]]["readiness_status"] == "operationally_ready"

    assert api.get("/api/v1/account-health?health_status=critical").json()["total"] == 1
    assert api.get("/api/v1/account-health?health_status=clear_signals").json()["total"] == 1
    assert api.get("/api/v1/account-health?severity=critical").json()["total"] == 1
    assert api.get("/api/v1/account-health?rule_key=account_restricted_status").json()["total"] == 1
    assert api.get("/api/v1/account-health?freshness_status=current").json()["total"] == 3
    assert api.get("/api/v1/account-health?search=Blocked").json()["total"] == 1
    assert api.get("/api/v1/account-health?readiness_status=operationally_ready").json()["total"] == 1

    worst_first = api.get("/api/v1/account-health?sort=health_severity&sort_direction=desc").json()["items"]
    assert worst_first[0]["ad_account_id"] == restricted["id"]

    paged = api.get("/api/v1/account-health?page_size=2&page=2").json()
    assert paged["page"] == 2 and paged["total_pages"] == 2 and len(paged["items"]) == 1


def test_health_summary_counts_match_the_list(api):
    make_ready_account(api)
    api.post("/api/v1/ad-accounts", json={"display_name": "Needs work", "external_account_id": "nw"})
    api.post(
        "/api/v1/ad-accounts",
        json={"display_name": "Blocked", "external_account_id": "bl", "status": "restricted"},
    )
    summary = api.get("/api/v1/account-health/summary").json()
    assert summary["total_active"] == 3
    assert summary["critical"] == 1
    assert summary["clear_signals"] == 1
    assert summary["attention_needed"] + summary["warning"] == 1
    assert summary["stale_data"] == 0
    assert summary["failed_runs_recent"] == 0
    assert "not a platform approval" in summary["disclaimer"]


# ------------------------------------------------------------ failure and staleness
def test_a_failed_evaluation_leaves_health_unknown_and_still_commits_the_a1_change(
    api, db_session, monkeypatch
):
    account = make_ready_account(api)
    assert health(api, account["id"])["health_status"] == "clear_signals"

    def explode(*args, **kwargs):
        raise RuntimeError("simulated rule failure")

    monkeypatch.setattr("app.services.health_service.build_candidates", explode)

    response = api.patch(f"/api/v1/ad-accounts/{account['id']}", json={"display_name": "Renamed"})
    assert response.status_code == 200, "the A1 mutation must survive a health failure"
    db_session.expire_all()
    assert db_session.get(AdAccount, account["id"]).display_name == "Renamed"

    body = health(api, account["id"])
    assert body["health_status"] == "unknown", "a stale clear result must never be kept"
    assert body["summary_reasons"][0]["code"] == "health_evaluation_failed"

    runs = api.get(f"/api/v1/account-health/evaluation-runs?ad_account_id={account['id']}&status=failed").json()
    assert runs["total"] >= 1
    assert runs["items"][0]["error_code"] == "RuntimeError"
    assert api.get("/api/v1/account-health/summary").json()["failed_runs_recent"] >= 1


def test_a_stale_evaluation_is_reported_as_unknown_not_clear(api, db_session):
    from datetime import UTC, datetime, timedelta

    from app.models.health import AccountHealthSnapshot

    account = make_ready_account(api)
    assert health(api, account["id"])["health_status"] == "clear_signals"

    snapshot = db_session.execute(
        sa.select(AccountHealthSnapshot).where(AccountHealthSnapshot.ad_account_id == account["id"])
    ).scalar_one()
    snapshot.last_evaluated_at = datetime.now(UTC) - timedelta(days=5)
    db_session.commit()

    body = health(api, account["id"])
    assert body["freshness_status"] == "stale"
    assert body["health_status"] == "unknown"
    assert body["summary_reasons"][0]["code"] == "health_evaluation_stale"
    assert api.get("/api/v1/account-health?health_status=unknown").json()["total"] == 1
    assert api.get("/api/v1/account-health/summary").json()["stale_data"] == 1
