"""O3 — `PATCH /meta-connections/{id}/automation`: the owner's named switch, per connection.

One of two switches (the other is the release's cadence). These tests pin what the switch may
never do: turn on for fake data, turn import on without discovery, act for another workspace,
be flipped by a non-owner, or change anything without an audit row naming the real person.
"""
from __future__ import annotations

import sqlalchemy as sa

from app.core.enums import WorkspaceRole
from app.models.entities import AuditLog, User, WorkspaceMember
from app.models.meta_operations import MetaConnection
from tests.conftest import login
from tests.o3_helpers import automate, connection


def test_a_new_connection_starts_with_both_switches_off(api):
    conn = connection(api)
    assert conn["auto_discovery_enabled"] is False
    assert conn["auto_import_enabled"] is False
    assert conn["automation"]["auto_discovery_enabled"] is False
    assert conn["automation"]["auto_import_enabled"] is False
    assert conn["automation"]["enabled_by"] is None and conn["automation"]["enabled_at"] is None


def test_the_owner_switches_a_production_connection_on_and_the_audit_names_them(
    api, db_session, owner, sweep_env
):
    conn = connection(api)

    response = automate(api, conn)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["automation"]["auto_discovery_enabled"] is True
    assert body["automation"]["auto_import_enabled"] is True
    assert body["automation"]["enabled_by"] == str(owner["user"].id)
    assert body["automation"]["enabled_at"]
    assert body["automation"]["eligible"] is True and body["automation"]["ineligible_reason"] is None
    rows = db_session.execute(
        sa.select(AuditLog).where(AuditLog.action == "meta_connection.automation_changed")
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].actor_id == owner["user"].id, "the real person, never the system"
    assert rows[0].before_json["auto_discovery_enabled"] is False
    assert rows[0].after_json["auto_import_enabled"] is True


def test_a_fake_or_sandbox_connection_can_never_be_switched_on(api, db_session):
    for environment in ("fake", "sandbox"):
        conn = connection(api, environment=environment, label=environment)
        for discovery, imports in ((True, False), (True, True)):
            response = automate(api, conn, discovery=discovery, imports=imports)
            assert response.status_code == 409, (environment, response.text)
        stored = db_session.get(MetaConnection, conn["id"])
        db_session.refresh(stored)
        assert stored.auto_discovery_enabled is False and stored.auto_import_enabled is False
        assert conn["automation"]["eligible"] is False
        assert conn["automation"]["ineligible_reason"] == "not_production"


def test_switching_off_is_always_allowed(api):
    conn = connection(api, environment="fake")
    response = automate(api, conn, discovery=False, imports=False)
    assert response.status_code == 200
    assert response.json()["automation"]["enabled_by"] is None


def test_import_cannot_be_on_without_discovery(api):
    conn = connection(api)
    response = automate(api, conn, discovery=False, imports=True)
    assert response.status_code == 422


def test_switching_both_off_clears_who_and_when_but_keeps_the_history(api, db_session, sweep_env):
    conn = connection(api)
    automate(api, conn)
    body = automate(api, conn, discovery=False, imports=False).json()
    assert body["automation"]["enabled_by"] is None and body["automation"]["enabled_at"] is None
    rows = db_session.execute(
        sa.select(AuditLog).where(AuditLog.action == "meta_connection.automation_changed")
    ).scalars().all()
    assert len(rows) == 2


def test_eligibility_follows_the_reader_credential(api, monkeypatch):
    """No reader configured: the switch can be set (the release may add one), but the card says
    the sweep could not read this connection, and why."""
    from app.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "meta_access_token", "")
    monkeypatch.setattr(settings, "meta_access_tokens_by_business", {})
    # A developer's `backend/.env` may name a server Business Manager; this test needs none.
    monkeypatch.setattr(settings, "meta_business_id", "")
    conn = connection(api)
    assert conn["automation"]["eligible"] is False
    assert conn["automation"]["ineligible_reason"] == "reader_not_configured"
    no_bm = connection(api, bm="", label="No BM")
    assert no_bm["automation"]["ineligible_reason"] == "business_manager_not_configured"


def test_the_body_is_strict(api):
    conn = connection(api)
    response = api.patch(
        f"/api/v1/meta-connections/{conn['id']}/automation",
        json={"auto_discovery_enabled": True, "auto_import_enabled": False, "workspace_id": "x"},
    )
    assert response.status_code == 422
    response = api.patch(
        f"/api/v1/meta-connections/{conn['id']}/automation",
        json={"auto_discovery_enabled": True, "auto_import_enabled": False, "access_token": "x"},
    )
    assert response.status_code in (400, 422)


def test_another_workspaces_connection_is_not_disclosed(api, client, other_auth):
    conn = connection(api)
    response = client.patch(
        f"/api/v1/meta-connections/{conn['id']}/automation",
        json={"auto_discovery_enabled": True, "auto_import_enabled": True},
        headers=other_auth,
    )
    assert response.status_code == 404


def test_only_the_owner_may_switch_automation(api, client, db_session, owner):
    conn = connection(api)
    from app.core.security import hash_password

    user = User(email="admin@example.com", full_name="Admin", password_hash=hash_password("pw-admin-123"), is_active=True)
    db_session.add(user)
    db_session.flush()
    db_session.add(WorkspaceMember(workspace_id=owner["workspace"].id, user_id=user.id, role=WorkspaceRole.ADMIN))
    db_session.commit()
    headers = login(client, "admin@example.com", "pw-admin-123")

    response = client.patch(
        f"/api/v1/meta-connections/{conn['id']}/automation",
        json={"auto_discovery_enabled": True, "auto_import_enabled": True},
        headers=headers,
    )

    assert response.status_code in (403, 404)


def test_reading_and_switching_make_no_provider_call(api, sweep_env):
    conn = connection(api)
    provider = sweep_env["provider"]
    provider.calls.clear()
    automate(api, conn)
    api.get("/api/v1/meta-connections")
    api.get(f"/api/v1/meta-connections/{conn['id']}")
    assert provider.calls == []
    assert sweep_env["built"] == []


def test_no_automation_field_carries_a_credential(api, sweep_env):
    conn = connection(api)
    body = automate(api, conn).json()
    text = repr(body).lower()
    assert "placeholder-reader-for-tests" not in text
    assert not any("token" in key for key in body["automation"])
