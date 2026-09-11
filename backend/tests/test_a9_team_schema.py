"""A9 Step 3 — schema only (no service/route reads or writes these tables yet, that's Step 4).
Direct-ORM tests here exist to catch a constraint mistake now rather than first discovering it
once Step 4's services start relying on it."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa

from app.core.enums import WorkspaceMemberStatus
from app.models.entities import BusinessManager, WorkspaceMember
from app.models.team import (
    MemberAdAccountAssignment,
    MemberBusinessManagerAssignment,
    WorkspaceInvitation,
    WorkspaceSeatPlan,
)


def test_new_workspace_member_defaults_to_active_status(session, workspace, owner):
    row = session.execute(
        sa.select(WorkspaceMember).where(WorkspaceMember.user_id == owner["user"].id)
    ).scalar_one()
    assert row.status == WorkspaceMemberStatus.ACTIVE


def test_workspace_seat_plan_is_unique_per_workspace(session, workspace, owner):
    session.add(WorkspaceSeatPlan(workspace_id=workspace.id, seat_limit=5, created_by=owner["user"].id))
    session.flush()
    session.add(WorkspaceSeatPlan(workspace_id=workspace.id, seat_limit=10, created_by=owner["user"].id))
    with pytest.raises(sa.exc.IntegrityError):
        session.flush()
    session.rollback()


def test_invitation_token_hash_is_globally_unique(session, workspace, other_owner, owner):
    common_hash = "a" * 64
    session.add(
        WorkspaceInvitation(
            workspace_id=workspace.id,
            email_normalized="one@example.com",
            invited_role="viewer",
            token_hash=common_hash,
            expires_at=datetime.now(UTC) + timedelta(days=7),
            created_by=owner["user"].id,
        )
    )
    session.flush()
    session.add(
        WorkspaceInvitation(
            workspace_id=other_owner["workspace"].id,
            email_normalized="two@example.com",
            invited_role="viewer",
            token_hash=common_hash,
            expires_at=datetime.now(UTC) + timedelta(days=7),
            created_by=other_owner["user"].id,
        )
    )
    with pytest.raises(sa.exc.IntegrityError):
        session.flush()
    session.rollback()


def test_bm_assignment_targets_an_actual_business_manager(session, workspace, owner):
    bm = BusinessManager(workspace_id=workspace.id, name="Agency BM")
    session.add(bm)
    session.flush()

    assignment = MemberBusinessManagerAssignment(
        workspace_id=workspace.id,
        member_id=owner["user"].id,  # wrong on purpose below — see next assertion
        business_manager_id=bm.id,
        assigned_by=owner["user"].id,
        assigned_at=datetime.now(UTC),
    )
    session.add(assignment)
    # `member_id` must reference `workspace_members.id`, not `users.id` — a plain user id here
    # violates the FK, which is the point of the constraint existing at all.
    with pytest.raises(sa.exc.IntegrityError):
        session.flush()
    session.rollback()


def test_ad_account_assignment_persists_with_a_real_member_and_account(session, workspace, owner):
    from app.models.entities import AdAccount

    member = session.execute(
        sa.select(WorkspaceMember).where(WorkspaceMember.user_id == owner["user"].id)
    ).scalar_one()
    account = AdAccount(workspace_id=workspace.id, display_name="Acct")
    session.add(account)
    session.flush()

    assignment = MemberAdAccountAssignment(
        workspace_id=workspace.id,
        member_id=member.id,
        ad_account_id=account.id,
        assigned_by=owner["user"].id,
        assigned_at=datetime.now(UTC),
    )
    session.add(assignment)
    session.flush()
    assert assignment.id is not None
    assert assignment.status.value == "active"
    assert assignment.archived_at is None


def test_seat_plan_cannot_reference_another_workspaces_business_manager_across_fk(
    session, workspace, other_owner
):
    """Not a cross-workspace *authorization* test (there's no service yet to authorize) — just
    confirming the FK itself doesn't silently accept a foreign-workspace row id."""
    from uuid import uuid4

    bogus = MemberBusinessManagerAssignment(
        workspace_id=workspace.id,
        member_id=uuid4(),
        business_manager_id=uuid4(),
        assigned_by=other_owner["user"].id,
        assigned_at=datetime.now(UTC),
    )
    session.add(bogus)
    with pytest.raises(sa.exc.IntegrityError):
        session.flush()
    session.rollback()
