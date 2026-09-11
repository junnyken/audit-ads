"""A9 Step 4 — SeatPlanService, MembershipLifecycleService, AssignmentService,
ScopeAuthorizationService, InvitationService (including `accept_invitation()`, resolved with
the product owner: an existing account must accept while authenticated as itself; a brand-new
email registers as part of accepting — see `app/services/invitation.py`'s module docstring)."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa

from app.core.enums import AssignmentStatus, InvitationStatus, WorkspaceMemberStatus, WorkspaceRole
from app.core.errors import AuthenticationError, ConflictError, NotFoundError, ValidationError
from app.core.security import hash_password
from app.models.entities import AdAccount, BusinessManager, User, WorkspaceMember
from app.services.assignment import AssignmentService
from app.services.audit import AuditLogService
from app.services.invitation import InvitationService, accept_invitation, hash_token, normalize_email
from app.services.membership_lifecycle import MembershipLifecycleService
from app.services.scope_authorization import ScopeAuthorizationService
from app.services.seat_plan import SeatPlanService
from app.services.session_registry import SessionRegistryService

# ------------------------------------------------------------------------------------- helpers


@pytest.fixture()
def audit(session, workspace, owner):
    return AuditLogService(session, workspace.id, owner["user"].id)


def _make_member(session, workspace, *, email: str, role: WorkspaceRole, status=WorkspaceMemberStatus.ACTIVE) -> WorkspaceMember:
    user = User(email=email, full_name="Team Member", password_hash=hash_password("correct-horse-battery"))
    session.add(user)
    session.flush()
    member = WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=role, status=status)
    session.add(member)
    session.flush()
    return member


# ---------------------------------------------------------------------------------- SeatPlanService


def test_seat_used_counts_only_active_non_archived_members(session, workspace, owner, audit):
    seats = SeatPlanService(session, workspace.id, audit)
    assert seats.seat_used() == 1  # the bootstrap owner

    _make_member(session, workspace, email="a@example.com", role=WorkspaceRole.BUYER)
    assert seats.seat_used() == 2

    suspended = _make_member(
        session, workspace, email="b@example.com", role=WorkspaceRole.VIEWER,
        status=WorkspaceMemberStatus.SUSPENDED,
    )
    assert seats.seat_used() == 2  # suspended still consumes a seat per spec, but this counts ACTIVE only
    assert suspended.status == WorkspaceMemberStatus.SUSPENDED


def test_no_seat_plan_means_unknown_availability_not_a_guessed_default(session, workspace, audit):
    seats = SeatPlanService(session, workspace.id, audit)
    assert seats.get() is None
    assert seats.seat_available() is None
    with pytest.raises(ConflictError):
        seats.require_available_seat()


def test_create_then_update_seat_plan(session, workspace, owner, audit):
    seats = SeatPlanService(session, workspace.id, audit)
    plan = seats.create_or_update(seat_limit=5, plan_reference="starter", actor_id=owner["user"].id)
    assert plan.seat_limit == 5
    assert seats.seat_available() == 4  # 5 - 1 (bootstrap owner)

    updated = seats.create_or_update(seat_limit=10, plan_reference=None, actor_id=owner["user"].id)
    assert updated.id == plan.id  # same row, updated in place
    assert updated.seat_limit == 10


def test_seat_limit_cannot_go_negative(session, workspace, owner, audit):
    seats = SeatPlanService(session, workspace.id, audit)
    with pytest.raises(ValidationError):
        seats.create_or_update(seat_limit=-1, plan_reference=None, actor_id=owner["user"].id)


def test_seat_limit_cannot_drop_below_active_member_count(session, workspace, owner, audit):
    seats = SeatPlanService(session, workspace.id, audit)
    _make_member(session, workspace, email="a@example.com", role=WorkspaceRole.BUYER)
    seats.create_or_update(seat_limit=5, plan_reference=None, actor_id=owner["user"].id)
    with pytest.raises(ConflictError):
        seats.create_or_update(seat_limit=1, plan_reference=None, actor_id=owner["user"].id)


# --------------------------------------------------------------------------- MembershipLifecycleService


def test_change_role_maps_a9_vocabulary_to_the_existing_enum(session, workspace, owner, audit):
    member = _make_member(session, workspace, email="a@example.com", role=WorkspaceRole.VIEWER)
    lifecycle = MembershipLifecycleService(session, workspace.id, audit)
    updated = lifecycle.change_role(member, new_role="operator", actor_id=owner["user"].id)
    assert updated.role == WorkspaceRole.BUYER


def test_change_role_rejects_an_unknown_role_name(session, workspace, owner, audit):
    member = _make_member(session, workspace, email="a@example.com", role=WorkspaceRole.VIEWER)
    lifecycle = MembershipLifecycleService(session, workspace.id, audit)
    with pytest.raises(ValidationError):
        lifecycle.change_role(member, new_role="owner", actor_id=owner["user"].id)


def test_cannot_downgrade_the_last_active_owner(session, workspace, owner, audit):
    row = session.execute(
        sa.select(WorkspaceMember).where(WorkspaceMember.user_id == owner["user"].id)
    ).scalar_one()
    lifecycle = MembershipLifecycleService(session, workspace.id, audit)
    with pytest.raises(ConflictError):
        lifecycle.change_role(row, new_role="viewer", actor_id=owner["user"].id)


def test_downgrading_an_owner_is_fine_when_another_owner_remains(session, workspace, owner, audit):
    second_owner = _make_member(session, workspace, email="owner2@example.com", role=WorkspaceRole.OWNER)
    lifecycle = MembershipLifecycleService(session, workspace.id, audit)
    updated = lifecycle.change_role(second_owner, new_role="admin", actor_id=owner["user"].id)
    assert updated.role == WorkspaceRole.ADMIN


def test_suspend_revokes_every_active_session_and_blocks_the_last_owner(session, workspace, owner, audit):
    lifecycle = MembershipLifecycleService(session, workspace.id, audit)
    with pytest.raises(ConflictError):
        row = session.execute(
            sa.select(WorkspaceMember).where(WorkspaceMember.user_id == owner["user"].id)
        ).scalar_one()
        lifecycle.suspend(row, reason="test", actor_id=owner["user"].id)

    member = _make_member(session, workspace, email="a@example.com", role=WorkspaceRole.VIEWER)
    registry = SessionRegistryService(session, workspace.id, audit)
    live_session = registry.create(
        user_id=member.user_id, expires_at=datetime.now(UTC) + timedelta(hours=1), user_agent=None, ip=None
    )
    lifecycle.suspend(member, reason="Policy violation.", actor_id=owner["user"].id)
    assert member.status == WorkspaceMemberStatus.SUSPENDED
    assert registry.get_active(live_session.id) is None


def test_unsuspend_only_works_from_suspended(session, workspace, owner, audit):
    member = _make_member(session, workspace, email="a@example.com", role=WorkspaceRole.VIEWER)
    lifecycle = MembershipLifecycleService(session, workspace.id, audit)
    with pytest.raises(ConflictError):
        lifecycle.unsuspend(member, actor_id=owner["user"].id)

    lifecycle.suspend(member, reason="x", actor_id=owner["user"].id)
    lifecycle.unsuspend(member, actor_id=owner["user"].id)
    assert member.status == WorkspaceMemberStatus.ACTIVE


def test_deactivate_releases_the_seat_and_revokes_sessions(session, workspace, owner, audit):
    member = _make_member(session, workspace, email="a@example.com", role=WorkspaceRole.VIEWER)
    seats = SeatPlanService(session, workspace.id, audit)
    assert seats.seat_used() == 2

    registry = SessionRegistryService(session, workspace.id, audit)
    live_session = registry.create(
        user_id=member.user_id, expires_at=datetime.now(UTC) + timedelta(hours=1), user_agent=None, ip=None
    )
    lifecycle = MembershipLifecycleService(session, workspace.id, audit)
    lifecycle.deactivate(member, reason="Left the team.", actor_id=owner["user"].id)

    assert member.status == WorkspaceMemberStatus.DEACTIVATED
    assert seats.seat_used() == 1  # released
    assert registry.get_active(live_session.id) is None


def test_reactivate_requires_an_available_seat(session, workspace, owner, audit):
    member = _make_member(session, workspace, email="a@example.com", role=WorkspaceRole.VIEWER)
    seats = SeatPlanService(session, workspace.id, audit)
    seats.create_or_update(seat_limit=2, plan_reference=None, actor_id=owner["user"].id)

    lifecycle = MembershipLifecycleService(session, workspace.id, audit)
    lifecycle.deactivate(member, reason="x", actor_id=owner["user"].id)

    # Fill the freed seat with someone else before trying to bring the first member back.
    _make_member(session, workspace, email="b@example.com", role=WorkspaceRole.VIEWER)
    with pytest.raises(ConflictError):
        lifecycle.reactivate(member, actor_id=owner["user"].id)


def test_archive_sets_archived_at_and_blocks_the_last_owner(session, workspace, owner, audit):
    lifecycle = MembershipLifecycleService(session, workspace.id, audit)
    owner_row = session.execute(
        sa.select(WorkspaceMember).where(WorkspaceMember.user_id == owner["user"].id)
    ).scalar_one()
    with pytest.raises(ConflictError):
        lifecycle.archive(owner_row, reason="test", actor_id=owner["user"].id)

    member = _make_member(session, workspace, email="a@example.com", role=WorkspaceRole.VIEWER)
    lifecycle.archive(member, reason="Left the company.", actor_id=owner["user"].id)
    assert member.archived_at is not None


# --------------------------------------------------------------------------------- AssignmentService


def test_assign_and_revoke_business_manager(session, workspace, owner, audit):
    member = _make_member(session, workspace, email="a@example.com", role=WorkspaceRole.BUYER)
    bm = BusinessManager(workspace_id=workspace.id, name="Agency BM")
    session.add(bm)
    session.flush()

    assignments = AssignmentService(session, workspace.id, audit)
    row = assignments.assign_business_manager(member, bm, actor_id=owner["user"].id)
    assert row.status == AssignmentStatus.ACTIVE

    with pytest.raises(ConflictError):  # duplicate active
        assignments.assign_business_manager(member, bm, actor_id=owner["user"].id)

    assignments.revoke(row, reason="No longer needed.", actor_id=owner["user"].id)
    assert row.status == AssignmentStatus.REVOKED

    # Revoked, so assigning again is allowed.
    again = assignments.assign_business_manager(member, bm, actor_id=owner["user"].id)
    assert again.id != row.id


def test_cannot_assign_the_owner_or_an_inactive_member(session, workspace, owner, audit):
    bm = BusinessManager(workspace_id=workspace.id, name="Agency BM")
    session.add(bm)
    session.flush()
    assignments = AssignmentService(session, workspace.id, audit)

    owner_row = session.execute(
        sa.select(WorkspaceMember).where(WorkspaceMember.user_id == owner["user"].id)
    ).scalar_one()
    with pytest.raises(ValidationError):
        assignments.assign_business_manager(owner_row, bm, actor_id=owner["user"].id)

    suspended = _make_member(
        session, workspace, email="a@example.com", role=WorkspaceRole.VIEWER,
        status=WorkspaceMemberStatus.SUSPENDED,
    )
    with pytest.raises(ConflictError):
        assignments.assign_business_manager(suspended, bm, actor_id=owner["user"].id)


def test_cannot_assign_a_resource_from_another_workspace(session, workspace, other_owner, owner, audit):
    member = _make_member(session, workspace, email="a@example.com", role=WorkspaceRole.BUYER)
    foreign_bm = BusinessManager(workspace_id=other_owner["workspace"].id, name="Someone else's BM")
    session.add(foreign_bm)
    session.flush()

    assignments = AssignmentService(session, workspace.id, audit)
    with pytest.raises(ValidationError):
        assignments.assign_business_manager(member, foreign_bm, actor_id=owner["user"].id)


def test_assign_ad_account_directly(session, workspace, owner, audit):
    member = _make_member(session, workspace, email="a@example.com", role=WorkspaceRole.BUYER)
    account = AdAccount(workspace_id=workspace.id, display_name="Acct")
    session.add(account)
    session.flush()

    assignments = AssignmentService(session, workspace.id, audit)
    row = assignments.assign_ad_account(member, account, actor_id=owner["user"].id)
    assert row.status == AssignmentStatus.ACTIVE
    assert assignments.list_ad_account_assignments(member) == [row]


# --------------------------------------------------------------------------- ScopeAuthorizationService


def test_owner_can_view_everything_with_no_assignments_at_all(session, workspace, owner):
    owner_row = session.execute(
        sa.select(WorkspaceMember).where(WorkspaceMember.user_id == owner["user"].id)
    ).scalar_one()
    bm = BusinessManager(workspace_id=workspace.id, name="Agency BM")
    account = AdAccount(workspace_id=workspace.id, display_name="Acct")
    session.add_all([bm, account])
    session.flush()

    scope = ScopeAuthorizationService(session, workspace.id)
    assert scope.can_view_business_manager(owner_row, bm.id) is True
    assert scope.can_view_ad_account(owner_row, account) is True
    assert scope.visible_business_manager_ids(owner_row) is None
    assert scope.visible_ad_account_ids(owner_row) is None


def test_non_owner_with_no_assignment_sees_nothing(session, workspace, owner, audit):
    member = _make_member(session, workspace, email="a@example.com", role=WorkspaceRole.VIEWER)
    bm = BusinessManager(workspace_id=workspace.id, name="Agency BM")
    account = AdAccount(workspace_id=workspace.id, display_name="Acct")
    session.add_all([bm, account])
    session.flush()

    scope = ScopeAuthorizationService(session, workspace.id)
    assert scope.can_view_business_manager(member, bm.id) is False
    assert scope.can_view_ad_account(member, account) is False
    assert scope.visible_business_manager_ids(member) == set()
    assert scope.visible_ad_account_ids(member) == set()


def test_bm_assignment_grants_the_bm_and_its_linked_ad_accounts(session, workspace, owner, audit):
    member = _make_member(session, workspace, email="a@example.com", role=WorkspaceRole.BUYER)
    bm = BusinessManager(workspace_id=workspace.id, name="Agency BM")
    session.add(bm)
    session.flush()
    account = AdAccount(workspace_id=workspace.id, display_name="Acct", business_manager_id=bm.id)
    unrelated_account = AdAccount(workspace_id=workspace.id, display_name="Other")
    session.add_all([account, unrelated_account])
    session.flush()

    AssignmentService(session, workspace.id, audit).assign_business_manager(member, bm, actor_id=owner["user"].id)

    scope = ScopeAuthorizationService(session, workspace.id)
    assert scope.can_view_business_manager(member, bm.id) is True
    assert scope.can_view_ad_account(member, account) is True  # via the BM
    assert scope.can_view_ad_account(member, unrelated_account) is False
    assert scope.visible_ad_account_ids(member) == {account.id}


def test_direct_ad_account_assignment_grants_only_that_account(session, workspace, owner, audit):
    member = _make_member(session, workspace, email="a@example.com", role=WorkspaceRole.BUYER)
    bm = BusinessManager(workspace_id=workspace.id, name="Agency BM")
    session.add(bm)
    session.flush()
    account = AdAccount(workspace_id=workspace.id, display_name="Acct", business_manager_id=bm.id)
    session.add(account)
    session.flush()

    AssignmentService(session, workspace.id, audit).assign_ad_account(member, account, actor_id=owner["user"].id)

    scope = ScopeAuthorizationService(session, workspace.id)
    assert scope.can_view_ad_account(member, account) is True
    assert scope.can_view_business_manager(member, bm.id) is False  # no BM assignment, only the account


def test_revoked_assignment_no_longer_grants_access(session, workspace, owner, audit):
    member = _make_member(session, workspace, email="a@example.com", role=WorkspaceRole.BUYER)
    bm = BusinessManager(workspace_id=workspace.id, name="Agency BM")
    session.add(bm)
    session.flush()

    assignments = AssignmentService(session, workspace.id, audit)
    row = assignments.assign_business_manager(member, bm, actor_id=owner["user"].id)
    scope = ScopeAuthorizationService(session, workspace.id)
    assert scope.can_view_business_manager(member, bm.id) is True

    assignments.revoke(row, reason="x", actor_id=owner["user"].id)
    assert scope.can_view_business_manager(member, bm.id) is False


# ------------------------------------------------------------------------------------ InvitationService


def test_create_invitation_returns_a_raw_token_never_persisted(session, workspace, owner, audit):
    from app.models.entities import AuditLog

    invitations = InvitationService(session, workspace.id, audit)
    invitation, raw_token = invitations.create(email="New@Example.com ", role="operator", actor_id=owner["user"].id)

    assert invitation.email_normalized == "new@example.com"
    assert invitation.invited_role == "operator"
    assert invitation.status == InvitationStatus.PENDING
    assert invitation.token_hash == hash_token(raw_token)
    assert invitation.token_hash != raw_token
    assert invitation.token_last_four == raw_token[-4:]

    # This session is `autoflush=False` (project-wide, `app/db/session.py`) — a real request
    # gets this for free from `ApiContext.commit()`; a direct service-level test has to ask.
    session.flush()
    rows = session.execute(
        sa.select(AuditLog).where(AuditLog.entity_type == "workspace_invitation")
    ).scalars().all()
    assert rows
    for row in rows:
        for payload in (row.before_json, row.after_json, row.metadata_json):
            if payload:
                assert raw_token not in str(payload)
                assert invitation.token_hash not in str(payload)


def test_create_invitation_rejects_an_unknown_role(session, workspace, owner, audit):
    invitations = InvitationService(session, workspace.id, audit)
    with pytest.raises(ValidationError):
        invitations.create(email="a@example.com", role="owner", actor_id=owner["user"].id)


def test_create_invitation_rejects_an_existing_active_member(session, workspace, owner, audit):
    invitations = InvitationService(session, workspace.id, audit)
    with pytest.raises(ConflictError):
        invitations.create(email=owner["user"].email, role="viewer", actor_id=owner["user"].id)


def test_a_second_invitation_to_the_same_email_supersedes_the_first(session, workspace, owner, audit):
    invitations = InvitationService(session, workspace.id, audit)
    first, _ = invitations.create(email="a@example.com", role="viewer", actor_id=owner["user"].id)
    second, _ = invitations.create(email="a@example.com", role="operator", actor_id=owner["user"].id)

    session.refresh(first)
    assert first.status == InvitationStatus.REVOKED
    assert first.revoke_reason == "Superseded by a new invitation."
    assert second.status == InvitationStatus.PENDING


def test_revoke_requires_pending_status(session, workspace, owner, audit):
    invitations = InvitationService(session, workspace.id, audit)
    invitation, _ = invitations.create(email="a@example.com", role="viewer", actor_id=owner["user"].id)
    invitations.revoke(invitation, reason="Changed my mind.", actor_id=owner["user"].id)
    with pytest.raises(ConflictError):
        invitations.revoke(invitation, reason="Again?", actor_id=owner["user"].id)


def test_resend_invalidates_the_old_token_and_issues_a_fresh_one(session, workspace, owner, audit):
    invitations = InvitationService(session, workspace.id, audit)
    original, original_token = invitations.create(email="a@example.com", role="viewer", actor_id=owner["user"].id)

    resent, new_token = invitations.resend(original, actor_id=owner["user"].id)

    assert new_token != original_token
    assert resent.id != original.id
    session.refresh(original)
    assert original.status == InvitationStatus.REVOKED
    assert resent.status == InvitationStatus.PENDING

    # The old raw token no longer resolves to anything acceptable.
    assert invitations.get(original.id).status == InvitationStatus.REVOKED


def test_expired_invitation_is_lazily_marked_on_read(session, workspace, owner, audit):
    invitations = InvitationService(session, workspace.id, audit)
    invitation, _ = invitations.create(email="a@example.com", role="viewer", actor_id=owner["user"].id)
    invitation.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    session.flush()

    refreshed = invitations.get(invitation.id)
    assert refreshed.status == InvitationStatus.EXPIRED


def test_normalize_email_strips_and_lowercases():
    assert normalize_email("  Foo@Bar.COM ") == "foo@bar.com"


# ------------------------------------------------------------------------------------ accept_invitation


def test_accept_with_a_brand_new_email_registers_and_joins(session, workspace, owner, audit):
    seats = SeatPlanService(session, workspace.id, audit)
    seats.create_or_update(seat_limit=5, plan_reference=None, actor_id=owner["user"].id)
    invitations = InvitationService(session, workspace.id, audit)
    invitation, raw_token = invitations.create(email="new@example.com", role="operator", actor_id=owner["user"].id)

    member, user = accept_invitation(
        session, raw_token=raw_token, authenticated_user=None, new_account_password="a-real-password",
    )

    assert user.email == "new@example.com"
    assert member.role == WorkspaceRole.BUYER
    assert member.status == WorkspaceMemberStatus.ACTIVE
    session.refresh(invitation)
    assert invitation.status == InvitationStatus.ACCEPTED
    assert invitation.accepted_by_user_id == user.id
    assert seats.seat_used() == 2  # bootstrap owner + the new member


def test_accept_with_a_new_email_requires_a_real_password(session, workspace, owner, audit):
    seats = SeatPlanService(session, workspace.id, audit)
    seats.create_or_update(seat_limit=5, plan_reference=None, actor_id=owner["user"].id)
    invitations = InvitationService(session, workspace.id, audit)
    _, raw_token = invitations.create(email="new@example.com", role="viewer", actor_id=owner["user"].id)

    with pytest.raises(ValidationError):
        accept_invitation(session, raw_token=raw_token, authenticated_user=None, new_account_password="short")


def test_accept_for_an_existing_account_email_without_authentication_is_refused(session, workspace, owner, audit):
    """Nobody gets to claim an existing account just by knowing its email and an invitation
    link — this is the core protection the product-owner-confirmed design exists for."""
    seats = SeatPlanService(session, workspace.id, audit)
    seats.create_or_update(seat_limit=5, plan_reference=None, actor_id=owner["user"].id)
    other = User(email="existing@example.com", full_name="Existing", password_hash=hash_password("whatever-1"))
    session.add(other)
    session.flush()

    invitations = InvitationService(session, workspace.id, audit)
    _, raw_token = invitations.create(email="existing@example.com", role="viewer", actor_id=owner["user"].id)

    with pytest.raises(AuthenticationError):
        accept_invitation(session, raw_token=raw_token, authenticated_user=None, new_account_password="whatever-2")


def test_accept_as_an_authenticated_existing_user_joins_a_second_workspace(
    session, workspace, owner, other_owner, audit
):
    existing_user = other_owner["user"]  # already owns a workspace of their own
    seats = SeatPlanService(session, workspace.id, audit)
    seats.create_or_update(seat_limit=5, plan_reference=None, actor_id=owner["user"].id)
    invitations = InvitationService(session, workspace.id, audit)
    _, raw_token = invitations.create(email=existing_user.email, role="admin", actor_id=owner["user"].id)

    member, user = accept_invitation(session, raw_token=raw_token, authenticated_user=existing_user)

    assert user.id == existing_user.id
    assert member.workspace_id == workspace.id
    assert member.role == WorkspaceRole.ADMIN


def test_accept_as_the_wrong_authenticated_user_is_refused(session, workspace, other_owner, owner, audit):
    seats = SeatPlanService(session, workspace.id, audit)
    seats.create_or_update(seat_limit=5, plan_reference=None, actor_id=owner["user"].id)
    invitations = InvitationService(session, workspace.id, audit)
    _, raw_token = invitations.create(email="new@example.com", role="viewer", actor_id=owner["user"].id)

    with pytest.raises(ConflictError):
        accept_invitation(session, raw_token=raw_token, authenticated_user=other_owner["user"])


def test_accept_requires_an_available_seat(session, workspace, owner, audit):
    invitations = InvitationService(session, workspace.id, audit)
    _, raw_token = invitations.create(email="new@example.com", role="viewer", actor_id=owner["user"].id)
    # No seat plan configured at all — accept must not silently assume capacity.
    with pytest.raises(ConflictError):
        accept_invitation(session, raw_token=raw_token, authenticated_user=None, new_account_password="a-real-password")


def test_accept_rejects_an_unknown_token(session):
    with pytest.raises(NotFoundError):
        accept_invitation(session, raw_token="not-a-real-token", authenticated_user=None, new_account_password="a-real-password")


def test_accept_rejects_an_already_accepted_token(session, workspace, owner, audit):
    seats = SeatPlanService(session, workspace.id, audit)
    seats.create_or_update(seat_limit=5, plan_reference=None, actor_id=owner["user"].id)
    invitations = InvitationService(session, workspace.id, audit)
    _, raw_token = invitations.create(email="new@example.com", role="viewer", actor_id=owner["user"].id)
    accept_invitation(session, raw_token=raw_token, authenticated_user=None, new_account_password="a-real-password")

    with pytest.raises(ConflictError):
        accept_invitation(session, raw_token=raw_token, authenticated_user=None, new_account_password="a-real-password")


def test_accepting_reactivates_a_previously_deactivated_member_instead_of_duplicating(
    session, workspace, owner, audit
):
    seats = SeatPlanService(session, workspace.id, audit)
    seats.create_or_update(seat_limit=5, plan_reference=None, actor_id=owner["user"].id)

    invitations = InvitationService(session, workspace.id, audit)
    first_invitation, first_token = invitations.create(email="rehire@example.com", role="viewer", actor_id=owner["user"].id)
    member, user = accept_invitation(
        session, raw_token=first_token, authenticated_user=None, new_account_password="a-real-password"
    )
    member_id = member.id

    MembershipLifecycleService(session, workspace.id, audit).deactivate(member, reason="Left.", actor_id=owner["user"].id)
    assert seats.seat_used() == 1

    second_invitation, second_token = invitations.create(email="rehire@example.com", role="operator", actor_id=owner["user"].id)
    reactivated, same_user = accept_invitation(session, raw_token=second_token, authenticated_user=user)

    assert reactivated.id == member_id  # same row, not a duplicate
    assert same_user.id == user.id
    assert reactivated.status == WorkspaceMemberStatus.ACTIVE
    assert reactivated.role == WorkspaceRole.BUYER
    assert seats.seat_used() == 2
