"""A9 Step 5 — Team & Seats API + the owner-facing session paths, against a real database and
the real auth stack (no mocked authorization: every "the owner can / a member cannot" assertion
below goes through the actual dependency chain)."""
from __future__ import annotations

import sqlalchemy as sa

from app.models.entities import WorkspaceMember
from tests.conftest import login

# ------------------------------------------------------------------------------------- helpers


def set_seats(api, limit: int = 5):
    response = api.patch("/api/v1/team/seat-plan", json={"seat_limit": limit})
    assert response.status_code == 200, response.text
    return response.json()


def invite(api, email: str = "new@example.com", role: str = "operator"):
    response = api.post("/api/v1/team/invitations", json={"email": email, "role": role})
    assert response.status_code == 200, response.text
    return response.json()


def accept(client, token: str, *, password: str = "a-real-password", headers: dict | None = None):
    return client.post(
        "/api/v1/team/invitations/accept",
        json={"token": token, "password": password},
        headers=headers or {},
    )


def onboard_member(api, client, *, email="member@example.com", role="operator") -> dict[str, str]:
    """Invite + accept through the real endpoints, returning the new member's auth headers."""
    set_seats(api, 5)
    created = invite(api, email=email, role=role)
    response = accept(client, created["invite_link_token"])
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


# --------------------------------------------------------------------------------- seats & summary


def test_summary_reports_unknown_capacity_until_a_plan_is_configured(api):
    body = api.get("/api/v1/team/summary").json()
    assert body["seat_limit"] is None
    assert body["available_seats"] is None
    assert body["active_members"] == 1  # the bootstrap owner
    assert body["pending_invitations"] == 0


def test_seat_plan_can_be_set_and_is_reflected_in_the_summary(api):
    set_seats(api, 3)
    body = api.get("/api/v1/team/summary").json()
    assert body["seat_limit"] == 3
    assert body["available_seats"] == 2


def test_seat_limit_below_active_member_count_is_refused(api):
    set_seats(api, 3)
    response = api.patch("/api/v1/team/seat-plan", json={"seat_limit": 0})
    assert response.status_code == 409


# ------------------------------------------------------------------------------- invite & accept


def test_invite_returns_a_one_time_token_and_lists_as_pending(api):
    created = invite(api)
    assert created["invite_link_token"]
    assert created["invitation"]["status"] == "pending"
    assert created["invitation"]["token_last_four"] == created["invite_link_token"][-4:]

    listed = api.get("/api/v1/team/invitations").json()
    assert len(listed) == 1
    # The raw token is never returned again by any subsequent read.
    assert "invite_link_token" not in listed[0]
    assert created["invite_link_token"] not in str(listed[0])


def test_accept_with_a_new_email_signs_the_member_straight_in(api, client):
    set_seats(api, 5)
    created = invite(api, email="fresh@example.com", role="viewer")
    response = accept(client, created["invite_link_token"])
    assert response.status_code == 200, response.text

    headers = {"Authorization": f"Bearer {response.json()['access_token']}"}
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email"] == "fresh@example.com"
    assert me.json()["role"] == "viewer"

    # And the seat is now consumed.
    assert api.get("/api/v1/team/summary").json()["active_members"] == 2


def test_accepting_an_existing_accounts_invitation_anonymously_is_refused(api, client, other_owner):
    set_seats(api, 5)
    created = invite(api, email=other_owner["user"].email, role="admin")
    response = accept(client, created["invite_link_token"])
    assert response.status_code == 401


def test_an_existing_account_can_accept_while_authenticated(api, client, other_owner):
    set_seats(api, 5)
    created = invite(api, email=other_owner["user"].email, role="admin")
    their_headers = login(client, other_owner["user"].email, other_owner["password"])

    response = accept(client, created["invite_link_token"], headers=their_headers)
    assert response.status_code == 200, response.text
    assert api.get("/api/v1/team/summary").json()["active_members"] == 2


def test_a_used_token_cannot_be_used_twice(api, client):
    set_seats(api, 5)
    created = invite(api, email="fresh@example.com")
    assert accept(client, created["invite_link_token"]).status_code == 200
    assert accept(client, created["invite_link_token"]).status_code == 409


def test_revoked_invitation_token_is_refused(api, client):
    set_seats(api, 5)
    created = invite(api, email="fresh@example.com")
    revoked = api.post(
        f"/api/v1/team/invitations/{created['invitation']['id']}/revoke",
        json={"reason": "Changed my mind."},
    )
    assert revoked.status_code == 200
    assert accept(client, created["invite_link_token"]).status_code == 409


def test_resend_invalidates_the_previous_token(api, client):
    set_seats(api, 5)
    created = invite(api, email="fresh@example.com")
    resent = api.post(f"/api/v1/team/invitations/{created['invitation']['id']}/resend").json()

    assert resent["invite_link_token"] != created["invite_link_token"]
    assert accept(client, created["invite_link_token"]).status_code == 409
    assert accept(client, resent["invite_link_token"]).status_code == 200


# ------------------------------------------------------------------------------ owner-only gating


def test_a_member_cannot_reach_any_team_endpoint(api, client):
    member_headers = onboard_member(api, client)

    for method, path, body in [
        ("get", "/api/v1/team/summary", None),
        ("get", "/api/v1/team/members", None),
        ("get", "/api/v1/team/invitations", None),
        ("patch", "/api/v1/team/seat-plan", {"seat_limit": 99}),
        ("post", "/api/v1/team/invitations", {"email": "x@example.com", "role": "viewer"}),
    ]:
        call = getattr(client, method)
        response = call(path, headers=member_headers, **({"json": body} if body else {}))
        assert response.status_code == 403, f"{method.upper()} {path} -> {response.status_code}"


# ------------------------------------------------------------------------------ member lifecycle


def test_member_list_shows_scoped_counts(api, client):
    onboard_member(api, client)
    rows = api.get("/api/v1/team/members").json()
    assert len(rows) == 2
    member = next(row for row in rows if row["role"] == "operator")
    assert member["status"] == "active"
    assert member["assigned_business_manager_count"] == 0
    assert member["active_session_count"] == 1  # the session created by accepting


def test_role_change_rejects_owner_and_accepts_a_valid_role(api, client, db_session, workspace):
    onboard_member(api, client)
    member = next(row for row in api.get("/api/v1/team/members").json() if row["role"] == "operator")

    assert api.patch(f"/api/v1/team/members/{member['id']}/role", json={"role": "owner"}).status_code == 422
    updated = api.patch(f"/api/v1/team/members/{member['id']}/role", json={"role": "viewer"})
    assert updated.status_code == 200
    assert updated.json()["role"] == "viewer"


def test_the_last_owner_cannot_be_deactivated(api, db_session, owner):
    owner_member = db_session.execute(
        sa.select(WorkspaceMember).where(WorkspaceMember.user_id == owner["user"].id)
    ).scalar_one()
    response = api.post(
        f"/api/v1/team/members/{owner_member.id}/deactivate", json={"reason": "Trying anyway."}
    )
    assert response.status_code == 409


def test_suspending_a_member_denies_their_live_session_immediately(api, client):
    member_headers = onboard_member(api, client)
    assert client.get("/api/v1/auth/me", headers=member_headers).status_code == 200

    member = next(row for row in api.get("/api/v1/team/members").json() if row["role"] == "operator")
    suspended = api.post(
        f"/api/v1/team/members/{member['id']}/suspend", json={"reason": "Policy review."}
    )
    assert suspended.status_code == 200
    assert suspended.json()["status"] == "suspended"

    # The token they were holding a second ago is now dead — server-side, not just in the UI.
    assert client.get("/api/v1/auth/me", headers=member_headers).status_code == 401


def test_deactivate_then_reactivate_moves_the_seat_back_and_forth(api, client):
    onboard_member(api, client)
    member = next(row for row in api.get("/api/v1/team/members").json() if row["role"] == "operator")

    api.post(f"/api/v1/team/members/{member['id']}/deactivate", json={"reason": "Left."})
    assert api.get("/api/v1/team/summary").json()["active_members"] == 1

    reactivated = api.post(f"/api/v1/team/members/{member['id']}/reactivate")
    assert reactivated.status_code == 200
    assert api.get("/api/v1/team/summary").json()["active_members"] == 2


# ---------------------------------------------------------------------------------- assignments


def test_assign_and_revoke_scope_through_the_api(api, client):
    onboard_member(api, client)
    member = next(row for row in api.get("/api/v1/team/members").json() if row["role"] == "operator")
    bm = api.post("/api/v1/business-managers", json={"name": "Agency BM"})
    assert bm.status_code in (200, 201), bm.text
    bm_id = bm.json()["id"]

    created = api.post(
        f"/api/v1/team/members/{member['id']}/business-manager-assignments",
        json={"business_manager_id": bm_id},
    )
    assert created.status_code == 200, created.text
    assert created.json()["status"] == "active"

    duplicate = api.post(
        f"/api/v1/team/members/{member['id']}/business-manager-assignments",
        json={"business_manager_id": bm_id},
    )
    assert duplicate.status_code == 409

    preview = api.get(f"/api/v1/team/members/{member['id']}/access-preview").json()
    assert preview["is_owner"] is False
    assert preview["business_manager_ids"] == [bm_id]

    revoked = api.post(
        f"/api/v1/team/assignments/{created.json()['id']}/revoke", json={"reason": "No longer needed."}
    )
    assert revoked.status_code == 200
    assert revoked.json()["status"] == "revoked"
    assert api.get(f"/api/v1/team/members/{member['id']}/access-preview").json()["business_manager_ids"] == []


def test_access_preview_for_the_owner_says_owner(api, db_session, owner):
    owner_member = db_session.execute(
        sa.select(WorkspaceMember).where(WorkspaceMember.user_id == owner["user"].id)
    ).scalar_one()
    preview = api.get(f"/api/v1/team/members/{owner_member.id}/access-preview").json()
    assert preview["is_owner"] is True


# ------------------------------------------------------------------------- owner-facing sessions


def test_owner_can_list_and_revoke_a_members_sessions(api, client):
    member_headers = onboard_member(api, client)
    member = next(row for row in api.get("/api/v1/team/members").json() if row["role"] == "operator")

    sessions = api.get(f"/api/v1/team/members/{member['id']}/sessions").json()
    assert len(sessions) == 1
    session_id = sessions[0]["id"]

    # Revoking someone else's session requires a reason.
    assert api.post(f"/api/v1/security/sessions/{session_id}/revoke").status_code == 422

    revoked = api.post(
        f"/api/v1/security/sessions/{session_id}/revoke", json={"reason": "Lost laptop."}
    )
    assert revoked.status_code == 200
    assert client.get("/api/v1/auth/me", headers=member_headers).status_code == 401


def test_a_member_cannot_revoke_the_owners_session(api, client, auth):
    member_headers = onboard_member(api, client)
    owner_sessions = api.get("/api/v1/security/sessions/me").json()
    owner_session_id = owner_sessions[0]["id"]

    response = client.post(
        f"/api/v1/security/sessions/{owner_session_id}/revoke",
        json={"reason": "I would like to not be supervised."},
        headers=member_headers,
    )
    assert response.status_code == 403
    assert api.get("/api/v1/security/sessions/me").json()  # owner still signed in


def test_revoke_all_member_sessions(api, client):
    member_headers = onboard_member(api, client)
    member = next(row for row in api.get("/api/v1/team/members").json() if row["role"] == "operator")

    result = api.post(
        f"/api/v1/team/members/{member['id']}/sessions/revoke-all", json={"reason": "Offboarding."}
    )
    assert result.status_code == 200
    assert result.json()["revoked_count"] == 1
    assert client.get("/api/v1/auth/me", headers=member_headers).status_code == 401


# ------------------------------------------------------------------------------ cross-workspace


def test_team_endpoints_are_non_disclosing_across_workspaces(api, client, other_auth):
    onboard_member(api, client)
    member = next(row for row in api.get("/api/v1/team/members").json() if row["role"] == "operator")

    # `other_auth` is an owner — of a *different* workspace. It must not see this member at all.
    response = client.get(f"/api/v1/team/members/{member['id']}", headers=other_auth)
    assert response.status_code == 404
