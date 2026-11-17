"""Audit history: every mutation is recorded, immutable, redacted and workspace-scoped."""
from __future__ import annotations

from tests.conftest import login


def test_every_mutation_produces_an_audit_record(api):
    account = api.post(
        "/api/v1/ad-accounts", json={"display_name": "Audited", "external_account_id": "act_a"}
    ).json()
    api.patch(f"/api/v1/ad-accounts/{account['id']}", json={"display_name": "Audited renamed"})
    api.post(f"/api/v1/ad-accounts/{account['id']}/archive")
    api.post(f"/api/v1/ad-accounts/{account['id']}/restore")

    logs = api.get("/api/v1/audit-logs").json()["items"]
    actions = [entry["action"] for entry in logs]
    for expected in (
        "ad_account.created",
        "ad_account.updated",
        "ad_account.archived",
        "ad_account.restored",
        "readiness_checklist.initialised",
    ):
        assert expected in actions, actions


def test_audit_records_carry_actor_action_entity_and_request_id(api):
    account = api.post("/api/v1/ad-accounts", json={"display_name": "Traced"}).json()
    entry = next(
        row
        for row in api.get("/api/v1/audit-logs").json()["items"]
        if row["action"] == "ad_account.created"
    )
    assert entry["entity_type"] == "ad_account"
    assert entry["entity_id"] == account["id"]
    assert entry["actor_id"] is not None
    assert entry["actor_email"].endswith("@example.com")
    assert entry["request_id"]
    assert entry["created_at"]


def test_update_audit_records_only_the_changed_fields(api):
    account = api.post("/api/v1/ad-accounts", json={"display_name": "Before"}).json()
    api.patch(f"/api/v1/ad-accounts/{account['id']}", json={"display_name": "After"})
    entry = next(
        row
        for row in api.get("/api/v1/audit-logs?action=ad_account.updated").json()["items"]
    )
    assert entry["before_json"] == {"display_name": "Before"}
    assert entry["after_json"] == {"display_name": "After"}


def test_readiness_change_is_audited_with_reason_codes(api):
    account = api.post("/api/v1/ad-accounts", json={"display_name": "R"}).json()
    api.post(
        f"/api/v1/ad-accounts/{account['id']}/events",
        json={"event_type": "x", "severity": "critical", "summary": "Critical thing"},
    )
    entries = api.get("/api/v1/audit-logs?action=readiness_changed").json()["items"]
    assert entries
    assert "unresolved_critical_event" in entries[0]["metadata_json"]["reason_codes"]


def test_account_audit_timeline_includes_children(api):
    account = api.post("/api/v1/ad-accounts", json={"display_name": "Deep"}).json()
    api.patch(
        f"/api/v1/ad-accounts/{account['id']}/readiness/checklist/admin_access_reviewed",
        json={"review_status": "completed"},
    )
    api.post(
        f"/api/v1/ad-accounts/{account['id']}/events",
        json={"event_type": "note", "severity": "info", "summary": "Observed"},
    )
    timeline = api.get(f"/api/v1/ad-accounts/{account['id']}/audit-logs").json()["items"]
    actions = {entry["action"] for entry in timeline}
    assert "ad_account.created" in actions
    assert "readiness_checklist_item.reviewed" in actions
    assert "account_event.created" in actions


def test_archiving_an_account_keeps_its_audit_history_visible(api):
    account = api.post("/api/v1/ad-accounts", json={"display_name": "Kept"}).json()
    api.post(f"/api/v1/ad-accounts/{account['id']}/archive")
    timeline = api.get(f"/api/v1/ad-accounts/{account['id']}/audit-logs").json()
    assert timeline["total"] >= 2


def test_audit_history_is_workspace_scoped(client, api, other_owner):
    api.post("/api/v1/ad-accounts", json={"display_name": "Private"})
    intruder = login(client, other_owner["user"].email, other_owner["password"])
    # `login()` itself now writes one `session.created` row (A9) in the *intruder's own*
    # workspace, so the list is no longer empty — the actual invariant under test is that the
    # owner's mutation never appears in it, not that logging in produces zero audit history.
    timeline = client.get("/api/v1/audit-logs", headers=intruder).json()
    actions = {entry["action"] for entry in timeline["items"]}
    assert "ad_account.created" not in actions
    assert actions == {"session.created"}


def test_audit_logs_have_no_mutation_endpoint(app):
    audit_paths = [
        route.path
        for route in app.routes
        if "audit-logs" in getattr(route, "path", "")
        and getattr(route, "methods", set()) - {"GET", "HEAD", "OPTIONS"}
    ]
    assert audit_paths == []
