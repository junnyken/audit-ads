"""A2 security, authorization and regression tests (MINI-SPEC A2 §10.1, §10.4)."""
from __future__ import annotations

import pathlib
import re

import sqlalchemy as sa

from app.models.entities import AdAccount, AuditLog
from app.models.health import AccountHealthSignal
from tests.conftest import login
from tests.test_health_api import active, health
from tests.test_readiness_api import make_ready_account

BACKEND_APP = pathlib.Path(__file__).resolve().parents[1] / "app"


def warning_signal(api, account_id):
    return next(s for s in active(api, account_id) if s["rule_key"] == "warning_account_event_open")


def with_warning(api):
    account = make_ready_account(api)
    api.post(
        f"/api/v1/ad-accounts/{account['id']}/events",
        json={"event_type": "x", "severity": "warning", "summary": "Warning."},
    )
    return account, warning_signal(api, account["id"])


# ------------------------------------------------------------------------- secrets
def test_acknowledge_payload_carrying_a_secret_field_is_refused(api):
    _, signal = with_warning(api)
    response = api.post(
        f"/api/v1/account-health/signals/{signal['id']}/acknowledge",
        json={"note": "Seen.", "session_token": "abc"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "forbidden_field"


def test_resolve_payload_carrying_a_secret_field_is_refused(api):
    _, signal = with_warning(api)
    response = api.post(
        f"/api/v1/account-health/signals/{signal['id']}/resolve",
        json={"reason": "Done.", "password": "hunter2hunter2"},
    )
    assert response.json()["error"]["code"] == "forbidden_field"


def test_resolve_evidence_reference_rejects_a_credential_shaped_value(api):
    _, signal = with_warning(api)
    response = api.post(
        f"/api/v1/account-health/signals/{signal['id']}/resolve",
        json={"reason": "Done.", "evidence_reference": "http://user:pw@vault.example.com/x"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["details"]["field"] == "evidence_reference"


def test_signal_evidence_never_persists_a_credential_like_key(api, db_session):
    account = make_ready_account(api)
    api.patch(f"/api/v1/ad-accounts/{account['id']}", json={"status": "restricted"})
    api.post(
        f"/api/v1/ad-accounts/{account['id']}/events",
        json={"event_type": "x", "severity": "critical", "summary": "Observed."},
    )
    banned = ("password", "cookie", "token", "secret", "credential", "authorization", "session")
    rows = db_session.execute(sa.select(AccountHealthSignal)).scalars().all()
    assert rows
    for row in rows:
        for key in row.evidence_json or {}:
            assert not any(fragment in key.lower() for fragment in banned), key


def test_health_audit_rows_carry_no_credential_like_key(api, db_session):
    account, signal = with_warning(api)
    api.post(f"/api/v1/account-health/signals/{signal['id']}/acknowledge", json={"note": "Seen."})
    banned = ("password", "cookie", "token", "secret", "credential", "authorization", "session")
    rows = db_session.execute(
        sa.select(AuditLog).where(AuditLog.entity_type == "account_health_signal")
    ).scalars().all()
    assert rows
    for row in rows:
        for payload in (row.before_json, row.after_json, row.metadata_json):
            for key in payload or {}:
                assert not any(fragment in key.lower() for fragment in banned), key


# ------------------------------------------------------------------ authorization
def test_cross_workspace_health_access_does_not_disclose_existence(client, api, other_owner):
    account, signal = with_warning(api)
    intruder = login(client, other_owner["user"].email, other_owner["password"])

    assert client.get(f"/api/v1/ad-accounts/{account['id']}/health", headers=intruder).status_code == 404
    assert client.get(f"/api/v1/account-health/signals/{signal['id']}", headers=intruder).status_code == 404
    assert (
        client.post(
            f"/api/v1/account-health/signals/{signal['id']}/acknowledge",
            headers=intruder,
            json={"note": "Mine now."},
        ).status_code
        == 404
    )
    assert client.get("/api/v1/account-health", headers=intruder).json()["total"] == 0
    assert client.get("/api/v1/account-health/summary", headers=intruder).json()["total_active"] == 0
    assert client.get("/api/v1/account-health/evaluation-runs", headers=intruder).json()["total"] == 0


def test_workspace_id_in_the_request_cannot_override_membership_scope(client, api, other_owner):
    account, _ = with_warning(api)
    intruder = login(client, other_owner["user"].email, other_owner["password"])
    victim_workspace = api.get("/api/v1/auth/me").json()["workspace"]["id"]

    assert (
        client.get(
            f"/api/v1/account-health?workspace_id={victim_workspace}", headers=intruder
        ).json()["total"]
        == 0
    )
    forced = client.post(
        f"/api/v1/ad-accounts/{account['id']}/health/recalculate",
        headers=intruder,
        json={"workspace_id": victim_workspace},
    )
    assert forced.status_code == 404


def test_health_endpoints_require_authentication(client):
    for path in (
        "/api/v1/account-health",
        "/api/v1/account-health/summary",
        "/api/v1/account-health/rules",
        "/api/v1/account-health/evaluation-runs",
    ):
        assert client.get(path).status_code == 401


def test_backfill_is_refused_for_a_read_only_role(client, api, db_session, owner):
    from app.core.enums import WorkspaceRole
    from app.models.entities import WorkspaceMember

    membership = db_session.execute(
        sa.select(WorkspaceMember).where(WorkspaceMember.user_id == owner["user"].id)
    ).scalar_one()
    membership.role = WorkspaceRole.VIEWER
    db_session.commit()

    headers = login(client, owner["user"].email, owner["password"])
    response = client.post("/api/v1/account-health/backfill", headers=headers, json={"confirm": True})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "not_authorized"


# -------------------------------------------------------------------- regressions
def test_health_evaluation_never_changes_readiness(api, db_session):
    account = make_ready_account(api)
    row = db_session.get(AdAccount, account["id"])
    db_session.refresh(row)
    before_status, before_stamp = row.readiness_status, row.readiness_evaluated_at

    for _ in range(3):
        api.post(f"/api/v1/ad-accounts/{account['id']}/health/recalculate")
    db_session.expire_all()
    row = db_session.get(AdAccount, account["id"])
    assert row.readiness_status == before_status
    assert row.readiness_evaluated_at == before_stamp, "health must not restamp readiness"


def test_no_health_path_can_turn_unknown_readiness_into_operationally_ready(api):
    account = api.post("/api/v1/ad-accounts", json={"display_name": "Incomplete"}).json()
    assert account["readiness_status"] == "unknown"
    api.post(f"/api/v1/ad-accounts/{account['id']}/health/recalculate")
    api.post("/api/v1/account-health/backfill", json={"confirm": True, "batch_size": 5})
    assert api.get(f"/api/v1/ad-accounts/{account['id']}").json()["readiness_status"] == "unknown"


def test_no_health_response_claims_safety_or_approval(api):
    account = make_ready_account(api)
    bodies = [
        api.get(f"/api/v1/ad-accounts/{account['id']}/health").text,
        api.get("/api/v1/account-health").text,
        api.get("/api/v1/account-health/summary").text,
        api.get("/api/v1/account-health/rules").text,
    ]
    affirmative = re.compile(
        r"\b(is safe|are safe|safe account|protected from|unbanned|is approved|will be approved"
        r"|immune|cannot be restricted|no ban risk|ban risk|trust score|safety score)\b",
        re.IGNORECASE,
    )
    for body in bodies:
        assert not affirmative.search(body), body[:400]


def test_clear_signals_is_always_worded_as_a_configured_check(api):
    account = make_ready_account(api)
    body = api.get(f"/api/v1/ad-accounts/{account['id']}/health").json()
    assert body["health_status"] == "clear_signals"
    assert "No current issues found by configured checks" in body["status_description"]


def test_no_numeric_risk_or_safety_score_field_exists(api):
    account = make_ready_account(api)
    payloads = [
        api.get(f"/api/v1/ad-accounts/{account['id']}/health").json(),
        api.get("/api/v1/account-health").json(),
        api.get("/api/v1/account-health/summary").json(),
    ]
    banned = ("score", "risk", "probability", "confidence")

    def walk(node):
        if isinstance(node, dict):
            for key, value in node.items():
                assert not any(word in key.lower() for word in banned), key
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    for payload in payloads:
        walk(payload)


def test_a2_adds_no_delete_endpoint(app):
    methods = {method for route in app.routes for method in getattr(route, "methods", set())}
    assert "DELETE" not in methods


def test_backend_contains_no_outbound_http_or_browser_dependency():
    """A2 must not contact a platform or start a browser. This is structural, not a promise."""
    forbidden = re.compile(
        r"^\s*(import|from)\s+(requests|httpx|aiohttp|urllib\.request|selenium|playwright"
        r"|pyppeteer|undetected_chromedriver)\b",
        re.MULTILINE,
    )
    offenders = [
        path.relative_to(BACKEND_APP).as_posix()
        for path in BACKEND_APP.rglob("*.py")
        if forbidden.search(path.read_text())
    ]
    assert offenders == [], offenders


def test_health_signal_actions_do_not_mutate_a1_checklist_data(api, db_session):
    from app.models.entities import ReadinessChecklistItem

    account = api.post("/api/v1/ad-accounts", json={"display_name": "Watched"}).json()
    signal = next(
        s for s in active(api, account["id"]) if s["rule_key"] == "mandatory_readiness_evidence_missing"
    )
    before = {
        item.item_key: (item.review_status, item.evidence_status)
        for item in db_session.execute(
            sa.select(ReadinessChecklistItem).where(
                ReadinessChecklistItem.ad_account_id == account["id"]
            )
        ).scalars().all()
    }
    api.post(
        f"/api/v1/account-health/signals/{signal['id']}/resolve",
        json={"reason": "Tracked in another system."},
    )
    db_session.expire_all()
    after = {
        item.item_key: (item.review_status, item.evidence_status)
        for item in db_session.execute(
            sa.select(ReadinessChecklistItem).where(
                ReadinessChecklistItem.ad_account_id == account["id"]
            )
        ).scalars().all()
    }
    assert before == after


def test_a1_pilot_scenarios_are_unchanged_by_a2(api):
    """The three A1 scenarios must land exactly where A1 said they would."""
    ready = make_ready_account(api)
    assert api.get(f"/api/v1/ad-accounts/{ready['id']}").json()["readiness_status"] == "operationally_ready"

    missing_payment = api.post(
        "/api/v1/ad-accounts", json={"display_name": "B", "external_account_id": "b", "status": "active"}
    ).json()
    assert missing_payment["readiness_status"] == "unknown"

    restricted = api.post(
        "/api/v1/ad-accounts",
        json={"display_name": "C", "external_account_id": "c", "status": "restricted"},
    ).json()
    assert restricted["readiness_status"] == "not_ready"
    assert health(api, restricted["id"])["health_status"] == "critical"
