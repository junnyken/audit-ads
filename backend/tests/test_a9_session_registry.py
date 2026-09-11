"""A9 Step 2 — SessionRegistryService and the dashboard session-revocation boundary it adds to
`app/api/deps.py`. Every dashboard JWT now carries a `session_id` claim tied to a `DeviceSession`
row, re-checked on every request — this is what actually makes "revoke a device" true rather
than cosmetic (see `docs/AUDIT_BEFORE_BUILD_A9.md` §4)."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.core.errors import ConflictError, NotFoundError
from app.services.audit import AuditLogService
from app.services.session_registry import SessionRegistryService, default_label, hash_ip

# ------------------------------------------------------------------------------------------ unit


def test_default_label_combines_browser_and_os():
    assert default_label("Chrome", "Windows") == "Chrome on Windows"


def test_default_label_falls_back_when_one_side_is_unknown():
    assert default_label("Chrome", None) == "Chrome"
    assert default_label(None, "Windows") == "Windows"
    assert default_label(None, None) == "Unknown browser"


def test_hash_ip_is_never_the_raw_address():
    hashed = hash_ip("203.0.113.7")
    assert hashed is not None
    assert "203.0.113.7" not in hashed
    assert len(hashed) == 64  # sha256 hex digest


def test_hash_ip_of_none_is_none():
    assert hash_ip(None) is None


# ------------------------------------------------------------------------------------- service


@pytest.fixture()
def audit(session, workspace, owner):
    return AuditLogService(session, workspace.id, owner["user"].id)


@pytest.fixture()
def registry(session, workspace, audit):
    return SessionRegistryService(session, workspace.id, audit)


def _make(registry, owner, *, minutes_from_now: int = 60):
    return registry.create(
        user_id=owner["user"].id,
        expires_at=datetime.now(UTC) + timedelta(minutes=minutes_from_now),
        user_agent="Mozilla/5.0 (Windows NT 10.0) Chrome/128.0",
        ip="203.0.113.7",
    )


def test_create_parses_coarse_browser_and_os_from_the_user_agent(registry, owner):
    row = _make(registry, owner)
    assert row.browser_family == "Chrome"
    assert row.os_family == "Windows"
    assert row.label == "Chrome on Windows"
    assert row.ip_hash is not None and row.ip_hash != "203.0.113.7"
    assert row.is_active is True


def test_get_active_returns_none_for_a_revoked_session(registry, owner):
    row = _make(registry, owner)
    registry.revoke_own(row.id, user_id=owner["user"].id, current_session_id=None)
    assert registry.get_active(row.id) is None


def test_get_active_returns_none_for_an_expired_session(registry, owner):
    row = _make(registry, owner, minutes_from_now=-1)
    assert registry.get_active(row.id) is None


def test_get_active_returns_none_for_a_session_in_another_workspace(session, owner, other_owner):
    audit = AuditLogService(session, owner["workspace"].id, owner["user"].id)
    mine = SessionRegistryService(session, owner["workspace"].id, audit)
    row = _make(mine, owner)

    other_audit = AuditLogService(session, other_owner["workspace"].id, other_owner["user"].id)
    theirs = SessionRegistryService(session, other_owner["workspace"].id, other_audit)
    assert theirs.get_active(row.id) is None


def test_touch_updates_last_seen_but_is_throttled(registry, owner):
    row = _make(registry, owner)
    original = row.last_seen_at
    registry.touch(row)
    assert row.last_seen_at == original  # too soon — throttle window not elapsed

    row.last_seen_at = datetime.now(UTC) - timedelta(minutes=6)
    stale = row.last_seen_at
    registry.touch(row)
    assert row.last_seen_at > stale


def test_revoke_own_current_session_is_refused(registry, owner):
    row = _make(registry, owner)
    with pytest.raises(ConflictError):
        registry.revoke_own(row.id, user_id=owner["user"].id, current_session_id=row.id)
    assert registry.get_active(row.id) is not None  # untouched


def test_revoke_own_someone_elses_session_is_not_found(session, owner, other_owner):
    other_audit = AuditLogService(session, other_owner["workspace"].id, other_owner["user"].id)
    theirs = SessionRegistryService(session, other_owner["workspace"].id, other_audit)
    their_row = _make(theirs, other_owner)

    my_audit = AuditLogService(session, owner["workspace"].id, owner["user"].id)
    mine = SessionRegistryService(session, owner["workspace"].id, my_audit)
    with pytest.raises(NotFoundError):
        mine.revoke_own(their_row.id, user_id=owner["user"].id, current_session_id=None)


def test_logout_other_devices_keeps_current_and_revokes_the_rest(registry, owner):
    current = _make(registry, owner)
    other_one = _make(registry, owner)
    other_two = _make(registry, owner)

    revoked_count = registry.logout_other_devices(user_id=owner["user"].id, current_session_id=current.id)

    assert revoked_count == 2
    assert registry.get_active(current.id) is not None
    assert registry.get_active(other_one.id) is None
    assert registry.get_active(other_two.id) is None


def test_revoke_all_for_member_revokes_every_active_session_no_exceptions(registry, owner):
    """Used by member deactivation (a later A9 step) — unlike logout-other-devices, there is
    no "current session" to spare here."""
    a = _make(registry, owner)
    b = _make(registry, owner)
    count = registry.revoke_all_for_member(owner["user"].id, reason="Member deactivated.", actor_id=None)
    assert count == 2
    assert registry.get_active(a.id) is None
    assert registry.get_active(b.id) is None


# ----------------------------------------------------------------------------------------- API


def test_login_response_never_exposes_the_device_session_id(api):
    """The token carries `session_id` internally, but the login response body itself is
    just the bearer token — never a separate field an operator could copy/paste/log."""
    body = api.get("/api/v1/security/sessions/me").json()
    assert isinstance(body, list) and len(body) == 1
    assert body[0]["is_current"] is True
    for forbidden in ("token", "hash", "ip", "user_agent"):
        assert forbidden not in {k.lower() for k in body[0]}


def test_a_second_login_creates_a_second_session_and_both_are_visible(client, owner):
    from tests.conftest import login

    login(client, owner["user"].email, owner["password"])
    second = login(client, owner["user"].email, owner["password"])

    body = client.get("/api/v1/security/sessions/me", headers=second).json()
    assert len(body) == 2
    current_flags = [row["is_current"] for row in body]
    assert current_flags.count(True) == 1  # only the second (current) call's own session


def test_revoking_another_active_session_denies_its_next_request(client, owner):
    from tests.conftest import login

    first = login(client, owner["user"].email, owner["password"])
    second = login(client, owner["user"].email, owner["password"])

    sessions = client.get("/api/v1/security/sessions/me", headers=second).json()
    other = next(row for row in sessions if not row["is_current"])

    revoke = client.post(f"/api/v1/security/sessions/{other['id']}/revoke", headers=second)
    assert revoke.status_code == 200, revoke.text

    denied = client.get("/api/v1/ad-accounts", headers=first)
    assert denied.status_code == 401


def test_revoking_the_current_session_via_the_device_endpoint_is_refused(api):
    sessions = api.get("/api/v1/security/sessions/me").json()
    current = next(row for row in sessions if row["is_current"])

    response = api.post(f"/api/v1/security/sessions/{current['id']}/revoke")
    assert response.status_code == 409


def test_logout_other_devices_via_api_keeps_the_caller_signed_in(client, owner):
    from tests.conftest import login

    first = login(client, owner["user"].email, owner["password"])
    second = login(client, owner["user"].email, owner["password"])

    result = client.post("/api/v1/security/sessions/logout-other-devices", headers=second)
    assert result.status_code == 200, result.text
    assert result.json()["revoked_count"] == 1

    # `second` (the caller) still works; `first` (the other device) does not.
    assert client.get("/api/v1/ad-accounts", headers=second).status_code == 200
    assert client.get("/api/v1/ad-accounts", headers=first).status_code == 401


def test_a_token_from_a_different_workspace_cannot_reach_this_workspaces_session(
    session, api, other_auth, client
):
    """Cross-workspace non-disclosure applies to the session registry too — not just to
    domain resources."""
    my_sessions = api.get("/api/v1/security/sessions/me").json()
    mine = my_sessions[0]["id"]

    response = client.post(f"/api/v1/security/sessions/{mine}/revoke", headers=other_auth)
    assert response.status_code == 404
