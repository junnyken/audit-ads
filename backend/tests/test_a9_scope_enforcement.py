"""A9 Step 7 — the scope retrofit, proven against the real routes.

Before A9 every active member of any role could read every Business Manager and ad account in
the workspace (`READ_ROLES = frozenset(WorkspaceRole)` — see `docs/AUDIT_BEFORE_BUILD_A9.md`
§7). These tests are the evidence that this is no longer true, and — just as important — that
the owner's own access is completely unchanged.
"""
from __future__ import annotations

from datetime import UTC, datetime

import pytest
import sqlalchemy as sa

from app.core.enums import WorkspaceRole
from app.core.security import hash_password
from app.models.entities import User, WorkspaceMember
from tests.conftest import login


@pytest.fixture()
def member_headers(client, db_session, owner):
    """A real signed-in `operator` (the existing `buyer` role) with no assignments at all."""
    user = User(
        email="scoped@example.com",
        full_name="Scoped Member",
        password_hash=hash_password("correct-horse-battery"),
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()
    db_session.add(
        WorkspaceMember(
            workspace_id=owner["workspace"].id, user_id=user.id, role=WorkspaceRole.BUYER
        )
    )
    db_session.commit()
    return login(client, "scoped@example.com", "correct-horse-battery")


def _member_id(db_session, email: str) -> str:
    row = db_session.execute(
        sa.select(WorkspaceMember).join(User, User.id == WorkspaceMember.user_id).where(User.email == email)
    ).scalar_one()
    return str(row.id)


# ------------------------------------------------------------------------------- the owner


def test_the_owner_still_sees_everything_with_no_assignments(api):
    """The retrofit must be a complete no-op for the owner — no assignment rows exist anywhere
    in this test, and the owner still sees every account."""
    api.post("/api/v1/ad-accounts", json={"display_name": "One"})
    api.post("/api/v1/ad-accounts", json={"display_name": "Two"})

    body = api.get("/api/v1/ad-accounts").json()
    assert body["total"] == 2


# ------------------------------------------------------------------------------ a member


def test_an_unassigned_member_sees_no_accounts_at_all(api, client, member_headers):
    api.post("/api/v1/ad-accounts", json={"display_name": "Owner's account"})

    body = client.get("/api/v1/ad-accounts", headers=member_headers).json()
    assert body["total"] == 0
    assert body["items"] == []


def test_an_unassigned_member_gets_404_not_403_on_a_real_account(api, client, member_headers):
    account = api.post("/api/v1/ad-accounts", json={"display_name": "Private"}).json()

    response = client.get(f"/api/v1/ad-accounts/{account['id']}", headers=member_headers)
    assert response.status_code == 404, response.text
    # Non-disclosure: the message must not confirm the record exists or name it.
    assert "Private" not in response.text


def test_assigning_an_account_makes_exactly_that_one_visible(api, client, db_session, member_headers):
    mine = api.post("/api/v1/ad-accounts", json={"display_name": "Assigned"}).json()
    api.post("/api/v1/ad-accounts", json={"display_name": "Not assigned"})

    api.patch("/api/v1/team/seat-plan", json={"seat_limit": 5})
    member_id = _member_id(db_session, "scoped@example.com")
    assigned = api.post(
        f"/api/v1/team/members/{member_id}/ad-account-assignments",
        json={"ad_account_id": mine["id"]},
    )
    assert assigned.status_code == 200, assigned.text

    body = client.get("/api/v1/ad-accounts", headers=member_headers).json()
    assert body["total"] == 1
    assert body["items"][0]["display_name"] == "Assigned"
    assert client.get(f"/api/v1/ad-accounts/{mine['id']}", headers=member_headers).status_code == 200


def test_a_bm_assignment_pulls_in_that_bms_accounts(api, client, db_session, member_headers):
    bm = api.post("/api/v1/business-managers", json={"name": "Agency BM"}).json()
    under_bm = api.post(
        "/api/v1/ad-accounts", json={"display_name": "Under the BM", "business_manager_id": bm["id"]}
    ).json()
    api.post("/api/v1/ad-accounts", json={"display_name": "Unrelated"})

    api.patch("/api/v1/team/seat-plan", json={"seat_limit": 5})
    member_id = _member_id(db_session, "scoped@example.com")
    api.post(
        f"/api/v1/team/members/{member_id}/business-manager-assignments",
        json={"business_manager_id": bm["id"]},
    )

    body = client.get("/api/v1/ad-accounts", headers=member_headers).json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == under_bm["id"]


def test_revoking_the_assignment_takes_the_account_away_again(api, client, db_session, member_headers):
    account = api.post("/api/v1/ad-accounts", json={"display_name": "Temporary"}).json()
    api.patch("/api/v1/team/seat-plan", json={"seat_limit": 5})
    member_id = _member_id(db_session, "scoped@example.com")
    assignment = api.post(
        f"/api/v1/team/members/{member_id}/ad-account-assignments",
        json={"ad_account_id": account["id"]},
    ).json()

    assert client.get(f"/api/v1/ad-accounts/{account['id']}", headers=member_headers).status_code == 200

    api.post(f"/api/v1/team/assignments/{assignment['id']}/revoke", json={"reason": "Rotated off."})

    # A bookmarked link goes non-disclosing the moment access is revoked (A9 §G.8).
    assert client.get(f"/api/v1/ad-accounts/{account['id']}", headers=member_headers).status_code == 404
    assert client.get("/api/v1/ad-accounts", headers=member_headers).json()["total"] == 0


def test_scope_covers_the_derived_routes_too_not_just_the_registry(api, client, db_session, member_headers):
    """Readiness, events and the rest resolve the account through the same registry
    chokepoint, so they inherit the scope rather than each needing their own check."""
    account = api.post("/api/v1/ad-accounts", json={"display_name": "Private"}).json()
    account_id = account["id"]

    for path in (
        f"/api/v1/ad-accounts/{account_id}/readiness",
        f"/api/v1/ad-accounts/{account_id}/readiness/checklist",
        f"/api/v1/ad-accounts/{account_id}/events",
    ):
        response = client.get(path, headers=member_headers)
        assert response.status_code == 404, f"{path} -> {response.status_code}"


def test_audit_history_keeps_its_own_role_gate_ahead_of_scope(api, client, member_headers):
    """`operator`/`buyer` was excluded from `AUDIT_READ_ROLES` back in A1 and still is — that
    role gate fires before any scope check, so the answer is `403`, not `404`. A9 does not
    quietly widen who may read audit history."""
    account = api.post("/api/v1/ad-accounts", json={"display_name": "Private"}).json()
    response = client.get(f"/api/v1/ad-accounts/{account['id']}/audit-logs", headers=member_headers)
    assert response.status_code == 403


def test_a_viewer_who_may_read_audit_still_only_sees_assigned_accounts(api, client, db_session, owner):
    """The role gate passing is not the same as the resource being in scope — a `viewer` gets
    past `AUDIT_READ_ROLES` and is then still stopped by the assignment scope."""
    user = User(
        email="viewer@example.com",
        full_name="Viewer",
        password_hash=hash_password("correct-horse-battery"),
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()
    db_session.add(
        WorkspaceMember(
            workspace_id=owner["workspace"].id, user_id=user.id, role=WorkspaceRole.VIEWER
        )
    )
    db_session.commit()
    headers = login(client, "viewer@example.com", "correct-horse-battery")

    account = api.post("/api/v1/ad-accounts", json={"display_name": "Private"}).json()
    response = client.get(f"/api/v1/ad-accounts/{account['id']}/audit-logs", headers=headers)
    assert response.status_code == 404, response.text


def test_a_scoped_member_cannot_mutate_an_unassigned_account(api, client, member_headers):
    account = api.post("/api/v1/ad-accounts", json={"display_name": "Private"}).json()

    response = client.patch(
        f"/api/v1/ad-accounts/{account['id']}", headers=member_headers, json={"notes": "mine now"}
    )
    assert response.status_code == 404


# ------------------------------------------------------------------------------- alerts


def test_a_member_sees_no_alerts_for_accounts_outside_their_scope(api, client, db_session, member_headers):
    """Alerts carry an `ad_account_id`, so they inherit the same scope as the account. An alert
    with *no* account link is not shown to a non-owner at all — it cannot be proven in scope,
    and the spec's rule for that case is to deny rather than guess."""
    from app.core.enums import AlertSeverity, AlertSourceType, AlertStatus
    from app.models.alerts import Alert

    account = api.post("/api/v1/ad-accounts", json={"display_name": "Private"}).json()
    now = datetime.now(UTC)
    linked = Alert(
        workspace_id=owner_workspace_id(db_session),
        ad_account_id=account["id"],
        source_type=AlertSourceType.HEALTH_SIGNAL,
        source_entity_type="account_health_signal",
        alert_key="scope-test-linked",
        category="account_health",
        title="Linked alert",
        severity=AlertSeverity.WARNING,
        status=AlertStatus.OPEN,
        first_observed_at=now,
        last_observed_at=now,
    )
    db_session.add(linked)
    db_session.commit()

    body = client.get("/api/v1/alerts", headers=member_headers).json()
    assert body["total"] == 0

    detail = client.get(f"/api/v1/alerts/{linked.id}", headers=member_headers)
    assert detail.status_code == 404


def owner_workspace_id(db_session):
    from app.models.entities import Workspace

    return db_session.execute(sa.select(Workspace.id)).scalars().first()


# --------------------------------------------------------------- Meta operations (A7/A8)


def test_meta_operations_are_owner_only(api, client, member_headers):
    """A9 §6: managing Meta connections and queueing an A7/A8 operation are owner-only by
    default. A member with a mutation-capable role (`operator`/`buyer`) is still refused."""
    for method, path in (
        ("get", "/api/v1/meta-connections"),
        ("get", "/api/v1/account-creation-batches/00000000-0000-0000-0000-000000000000"),
        ("get", "/api/v1/access-share-batches/00000000-0000-0000-0000-000000000000"),
        ("get", "/api/v1/pixel-share-batches/00000000-0000-0000-0000-000000000000"),
    ):
        response = getattr(client, method)(path, headers=member_headers)
        assert response.status_code == 403, f"{path} -> {response.status_code}"

    created = client.post(
        "/api/v1/meta-connections", headers=member_headers, json={"label": "x", "environment": "fake"}
    )
    assert created.status_code == 403

    # …and the owner is unaffected.
    assert api.get("/api/v1/meta-connections").status_code == 200

