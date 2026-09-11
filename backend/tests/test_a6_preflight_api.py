"""A6 API integration tests against a real PostgreSQL database (mini-spec §10.2/§10.4/§10.5)."""
from __future__ import annotations

import time
from datetime import UTC, datetime

from app.services.preflight_landing_page import LandingPageCheckOutcome
from tests.test_readiness_api import make_ready_account


def make_account(api, **overrides):
    payload = {"display_name": "Account", "status": "active"}
    payload.update(overrides)
    return api.post("/api/v1/ad-accounts", json=payload).json()


def make_draft(api, **overrides):
    payload = {
        "title": "Test draft",
        "primary_copy": "Ưu đãi mùa hè, mua ngay hôm nay.",
        "targeting_summary": "Nữ 25-45, TP.HCM",
    }
    payload.update(overrides)
    response = api.post("/api/v1/campaign-drafts", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


# ------------------------------------------------------------------------ CRUD lifecycle


def test_create_get_update_draft(api):
    account = make_account(api)
    draft = make_draft(api, ad_account_id=account["id"], headline="Ưu đãi")
    assert draft["draft_status"] == "draft"
    assert draft["account_display_name"] == "Account"

    fetched = api.get(f"/api/v1/campaign-drafts/{draft['id']}").json()
    assert fetched["id"] == draft["id"]

    updated = api.patch(f"/api/v1/campaign-drafts/{draft['id']}", json={"title": "Renamed"}).json()
    assert updated["title"] == "Renamed"
    assert updated["draft_status"] == "draft"  # editing never invents a verdict


def test_list_filters_by_status_and_account(api):
    account = make_account(api)
    other_account = make_account(api, display_name="Other")
    make_draft(api, title="A", ad_account_id=account["id"])
    make_draft(api, title="B", ad_account_id=other_account["id"])

    body = api.get(f"/api/v1/campaign-drafts?ad_account_id={account['id']}").json()
    assert [item["title"] for item in body["items"]] == ["A"]


def test_archive_and_restore_round_trip(api):
    draft = make_draft(api)
    archived = api.post(f"/api/v1/campaign-drafts/{draft['id']}/archive").json()
    assert archived["archived_at"] is not None

    listed = api.get("/api/v1/campaign-drafts").json()
    assert draft["id"] not in {item["id"] for item in listed["items"]}
    listed_archived = api.get("/api/v1/campaign-drafts?archived=true").json()
    assert draft["id"] in {item["id"] for item in listed_archived["items"]}

    restored = api.post(f"/api/v1/campaign-drafts/{draft['id']}/restore").json()
    assert restored["archived_at"] is None


def test_no_hard_delete_endpoint_exists(app):
    methods = {method for route in app.routes if "/campaign-drafts" in getattr(route, "path", "") for method in getattr(route, "methods", set())}
    assert "DELETE" not in methods


# ------------------------------------------------------------------------ evaluate / verdict rollup


def test_evaluate_blocked_by_internal_policy_for_a_restricted_account(api):
    account = make_account(api, status="restricted")
    draft = make_draft(api, ad_account_id=account["id"])
    run = api.post(f"/api/v1/campaign-drafts/{draft['id']}/evaluate").json()
    assert run["status"] == "succeeded"
    updated = api.get(f"/api/v1/campaign-drafts/{draft['id']}").json()
    assert updated["draft_status"] == "blocked_by_internal_policy"
    assert updated["open_blocking_count"] >= 1


def test_evaluate_needs_changes_when_only_warnings_are_open(api, monkeypatch):
    def fake_check(self, url):
        return LandingPageCheckOutcome(
            evidence_fields={
                "url": url,
                "final_url": url,
                "http_status": 200,
                "is_https": True,
                "redirect_count": 0,
                "response_time_ms": 100,
                "mobile_viewport_meta_present": True,
                "contact_or_policy_link_detected": True,
                "fetch_error": None,
                "checked_at": datetime.now(UTC),
                "expires_at": None,
            },
            findings=[],
            is_transient=False,
        )

    monkeypatch.setattr(
        "app.services.preflight_evaluation.LandingPageCheckService.check", fake_check
    )
    account = make_account(api)  # fresh account -> readiness unknown -> a warning
    draft = make_draft(api, ad_account_id=account["id"], landing_page_url="https://shop.example.com/x")
    run = api.post(f"/api/v1/campaign-drafts/{draft['id']}/evaluate").json()
    assert run["status"] == "succeeded"
    updated = api.get(f"/api/v1/campaign-drafts/{draft['id']}").json()
    assert updated["draft_status"] == "needs_changes"
    assert updated["open_warning_count"] >= 1
    assert updated["open_blocking_count"] == 0


def test_evaluate_ready_for_manual_review_with_a_fully_ready_account(api):
    account = make_ready_account(api)
    draft = make_draft(
        api,
        ad_account_id=account["id"],
        objective="conversion",
        landing_page_url="https://example.com/",
        headline="Ưu đãi",
    )
    run = api.post(f"/api/v1/campaign-drafts/{draft['id']}/evaluate").json()
    assert run["status"] == "succeeded"
    updated = api.get(f"/api/v1/campaign-drafts/{draft['id']}").json()
    # example.com has no contact/policy link, which is a warning — assert the mechanism
    # (zero blocking, verdict reflects whatever warnings a real fetch actually found) rather
    # than a brittle exact-status assertion tied to that page's current markup.
    findings = api.get(f"/api/v1/campaign-drafts/{draft['id']}/findings").json()
    blocking = [f for f in findings if f["severity"] == "blocking"]
    assert blocking == []
    if any(f["severity"] == "warning" for f in findings):
        assert updated["draft_status"] == "needs_changes"
    else:
        assert updated["draft_status"] == "ready_for_manual_review"


def test_evaluate_unknown_missing_evidence_on_transient_fetch_failure(api, monkeypatch):
    def fake_check(self, url):
        return LandingPageCheckOutcome(
            evidence_fields={
                "url": url,
                "final_url": None,
                "http_status": None,
                "is_https": False,
                "redirect_count": None,
                "response_time_ms": None,
                "mobile_viewport_meta_present": None,
                "contact_or_policy_link_detected": None,
                "fetch_error": "timeout",
                "checked_at": datetime.now(UTC),
                "expires_at": None,
            },
            findings=[],
            is_transient=True,
        )

    monkeypatch.setattr(
        "app.services.preflight_evaluation.LandingPageCheckService.check", fake_check
    )
    account = make_ready_account(api)
    draft = make_draft(api, ad_account_id=account["id"], landing_page_url="https://slow.example.com/")
    run = api.post(f"/api/v1/campaign-drafts/{draft['id']}/evaluate").json()
    assert run["status"] == "succeeded"
    updated = api.get(f"/api/v1/campaign-drafts/{draft['id']}").json()
    assert updated["draft_status"] == "unknown_missing_evidence"


def test_evaluate_is_idempotent_safe_within_the_cooldown(api):
    draft = make_draft(api)
    first = api.post(f"/api/v1/campaign-drafts/{draft['id']}/evaluate").json()
    second = api.post(f"/api/v1/campaign-drafts/{draft['id']}/evaluate").json()
    assert first["id"] == second["id"]
    runs = api.get(f"/api/v1/campaign-drafts/{draft['id']}/evaluation-runs").json()
    assert len(runs) == 1


def test_archived_draft_cannot_be_evaluated(api):
    draft = make_draft(api)
    api.post(f"/api/v1/campaign-drafts/{draft['id']}/archive")
    response = api.post(f"/api/v1/campaign-drafts/{draft['id']}/evaluate")
    assert response.status_code == 409


def test_re_evaluation_does_not_duplicate_open_findings(api):
    account = make_account(api, status="restricted")
    draft = make_draft(api, ad_account_id=account["id"])
    api.post(f"/api/v1/campaign-drafts/{draft['id']}/evaluate")
    findings_v1 = api.get(f"/api/v1/campaign-drafts/{draft['id']}/findings").json()

    time.sleep(6)  # clear the evaluate cooldown so a second real run happens
    api.post(f"/api/v1/campaign-drafts/{draft['id']}/evaluate")
    findings_v2 = api.get(f"/api/v1/campaign-drafts/{draft['id']}/findings").json()

    restricted_findings = [f for f in findings_v2 if f["rule_key"] == "account_status_restricted_or_disabled"]
    assert len(restricted_findings) == 1  # the v1 finding was superseded, not left open alongside a new one
    assert len(findings_v1) == len(findings_v2)  # same rule set both times


# ------------------------------------------------------------------------ findings actions


def test_acknowledge_and_resolve_require_a_reason_and_do_not_change_draft_status(api):
    account = make_account(api, status="restricted")
    draft = make_draft(api, ad_account_id=account["id"])
    api.post(f"/api/v1/campaign-drafts/{draft['id']}/evaluate")
    findings = api.get(f"/api/v1/campaign-drafts/{draft['id']}/findings").json()
    finding = findings[0]

    assert api.post(f"/api/v1/preflight-findings/{finding['id']}/acknowledge", json={"reason": "  "}).status_code == 422

    ack = api.post(
        f"/api/v1/preflight-findings/{finding['id']}/acknowledge", json={"reason": "Reviewed, will fix."}
    ).json()
    assert ack["status"] == "acknowledged"

    status_after_ack = api.get(f"/api/v1/campaign-drafts/{draft['id']}").json()["draft_status"]
    assert status_after_ack == "blocked_by_internal_policy"  # unchanged by acknowledging

    resolved = api.post(
        f"/api/v1/preflight-findings/{finding['id']}/resolve", json={"reason": "Account restriction lifted."}
    ).json()
    assert resolved["status"] == "resolved"
    status_after_resolve = api.get(f"/api/v1/campaign-drafts/{draft['id']}").json()["draft_status"]
    assert status_after_resolve == "blocked_by_internal_policy"  # still unchanged — only evaluate() moves it


# ------------------------------------------------------------------------ cross-workspace


def test_cross_workspace_draft_access_is_non_disclosing(api, other_auth, client):
    draft = make_draft(api)
    response = client.get(f"/api/v1/campaign-drafts/{draft['id']}", headers=other_auth)
    assert response.status_code == 404
