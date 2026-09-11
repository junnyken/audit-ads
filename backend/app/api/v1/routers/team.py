"""MINI-SPEC A9 Step 5 — Team & Seats API. Every mutation here is owner-only (`OwnerCtx`),
matching the mini-spec's permission matrix (§6) exactly: only the owner invites, changes roles,
assigns scope, or manages another member's sessions.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

import app.schemas.team as s
from app.api.deps import OptionalUser, OwnerCtx
from app.core.config import get_settings
from app.core.errors import NotFoundError
from app.core.security import create_access_token
from app.db.session import get_db
from app.models.entities import AdAccount, BusinessManager, WorkspaceMember
from app.models.team import MemberAdAccountAssignment, MemberBusinessManagerAssignment
from app.services.assignment import AssignmentService
from app.services.audit import AuditLogService
from app.services.base import get_or_404
from app.services.invitation import InvitationService, accept_invitation
from app.services.membership_lifecycle import MembershipLifecycleService
from app.services.scope_authorization import ScopeAuthorizationService
from app.services.seat_plan import SeatPlanService
from app.services.session_registry import SessionRegistryService
from app.services.workspace import WORKSPACE_ROLE_TO_A9_ROLE

router = APIRouter(prefix="/team", tags=["team"])


def _member_out(ctx: OwnerCtx, member: WorkspaceMember) -> s.MemberOut:
    assignments = AssignmentService(ctx.session, ctx.workspace_id, ctx.audit)
    sessions = SessionRegistryService(ctx.session, ctx.workspace_id, ctx.audit)
    active_sessions = sum(1 for row in sessions.list_for_user(member.user_id) if row.is_active)
    bm_count = sum(
        1 for a in assignments.list_business_manager_assignments(member) if a.status.value == "active"
    )
    account_count = sum(
        1 for a in assignments.list_ad_account_assignments(member) if a.status.value == "active"
    )
    return s.MemberOut(
        id=member.id,
        user_id=member.user_id,
        email=member.user.email,
        full_name=member.user.full_name,
        role=WORKSPACE_ROLE_TO_A9_ROLE.get(member.role, member.role.value),
        status=member.status,
        is_archived=member.is_archived,
        assigned_business_manager_count=bm_count,
        assigned_ad_account_count=account_count,
        active_session_count=active_sessions,
        created_at=member.created_at,
    )


def _get_member(ctx: OwnerCtx, member_id: uuid.UUID) -> WorkspaceMember:
    return get_or_404(ctx.session, WorkspaceMember, member_id, ctx.workspace_id, label="Member")


# ------------------------------------------------------------------------------------------ seats


@router.get("/summary", response_model=s.TeamSummaryOut)
def get_summary(ctx: OwnerCtx) -> s.TeamSummaryOut:
    seats = SeatPlanService(ctx.session, ctx.workspace_id, ctx.audit)
    plan = seats.get()
    invitations = InvitationService(ctx.session, ctx.workspace_id, ctx.audit)
    pending = sum(1 for row in invitations.list_all() if row.status.value == "pending")
    return s.TeamSummaryOut(
        seat_limit=plan.seat_limit if plan else None,
        active_members=seats.seat_used(),
        available_seats=seats.seat_available(),
        pending_invitations=pending,
        plan_reference=plan.plan_reference if plan else None,
    )


@router.get("/seat-plan", response_model=s.SeatPlanOut | None)
def get_seat_plan(ctx: OwnerCtx) -> s.SeatPlanOut | None:
    plan = SeatPlanService(ctx.session, ctx.workspace_id, ctx.audit).get()
    return s.SeatPlanOut.model_validate(plan) if plan else None


@router.patch("/seat-plan", response_model=s.SeatPlanOut)
def update_seat_plan(ctx: OwnerCtx, payload: s.SeatPlanUpdateRequest) -> s.SeatPlanOut:
    plan = SeatPlanService(ctx.session, ctx.workspace_id, ctx.audit).create_or_update(
        seat_limit=payload.seat_limit, plan_reference=payload.plan_reference, actor_id=ctx.user.id
    )
    ctx.commit()
    return s.SeatPlanOut.model_validate(plan)


# ---------------------------------------------------------------------------------------- members


@router.get("/members", response_model=list[s.MemberOut])
def list_members(ctx: OwnerCtx) -> list[s.MemberOut]:
    rows = ctx.session.execute(
        sa.select(WorkspaceMember)
        .where(WorkspaceMember.workspace_id == ctx.workspace_id, WorkspaceMember.archived_at.is_(None))
        .order_by(WorkspaceMember.created_at.asc())
    ).scalars().all()
    return [_member_out(ctx, row) for row in rows]


@router.get("/members/{member_id}", response_model=s.MemberOut)
def get_member(ctx: OwnerCtx, member_id: uuid.UUID) -> s.MemberOut:
    return _member_out(ctx, _get_member(ctx, member_id))


@router.patch("/members/{member_id}/role", response_model=s.MemberOut)
def change_role(ctx: OwnerCtx, member_id: uuid.UUID, payload: s.RoleChangeRequest) -> s.MemberOut:
    member = _get_member(ctx, member_id)
    lifecycle = MembershipLifecycleService(ctx.session, ctx.workspace_id, ctx.audit)
    lifecycle.change_role(member, new_role=payload.role, actor_id=ctx.user.id)
    ctx.commit()
    return _member_out(ctx, member)


@router.post("/members/{member_id}/suspend", response_model=s.MemberOut)
def suspend_member(ctx: OwnerCtx, member_id: uuid.UUID, payload: s.ReasonRequest) -> s.MemberOut:
    member = _get_member(ctx, member_id)
    MembershipLifecycleService(ctx.session, ctx.workspace_id, ctx.audit).suspend(
        member, reason=payload.reason, actor_id=ctx.user.id
    )
    ctx.commit()
    return _member_out(ctx, member)


@router.post("/members/{member_id}/unsuspend", response_model=s.MemberOut)
def unsuspend_member(ctx: OwnerCtx, member_id: uuid.UUID) -> s.MemberOut:
    member = _get_member(ctx, member_id)
    MembershipLifecycleService(ctx.session, ctx.workspace_id, ctx.audit).unsuspend(member, actor_id=ctx.user.id)
    ctx.commit()
    return _member_out(ctx, member)


@router.post("/members/{member_id}/deactivate", response_model=s.MemberOut)
def deactivate_member(ctx: OwnerCtx, member_id: uuid.UUID, payload: s.ReasonRequest) -> s.MemberOut:
    member = _get_member(ctx, member_id)
    MembershipLifecycleService(ctx.session, ctx.workspace_id, ctx.audit).deactivate(
        member, reason=payload.reason, actor_id=ctx.user.id
    )
    ctx.commit()
    return _member_out(ctx, member)


@router.post("/members/{member_id}/reactivate", response_model=s.MemberOut)
def reactivate_member(ctx: OwnerCtx, member_id: uuid.UUID) -> s.MemberOut:
    member = _get_member(ctx, member_id)
    MembershipLifecycleService(ctx.session, ctx.workspace_id, ctx.audit).reactivate(member, actor_id=ctx.user.id)
    ctx.commit()
    return _member_out(ctx, member)


@router.post("/members/{member_id}/archive", response_model=s.MemberOut)
def archive_member(ctx: OwnerCtx, member_id: uuid.UUID, payload: s.ReasonRequest) -> s.MemberOut:
    member = _get_member(ctx, member_id)
    MembershipLifecycleService(ctx.session, ctx.workspace_id, ctx.audit).archive(
        member, reason=payload.reason, actor_id=ctx.user.id
    )
    ctx.commit()
    return _member_out(ctx, member)


@router.get("/members/{member_id}/access-preview", response_model=s.AccessPreviewOut)
def access_preview(ctx: OwnerCtx, member_id: uuid.UUID) -> s.AccessPreviewOut:
    member = _get_member(ctx, member_id)
    scope = ScopeAuthorizationService(ctx.session, ctx.workspace_id)
    bm_ids = scope.visible_business_manager_ids(member)
    account_ids = scope.visible_ad_account_ids(member)
    return s.AccessPreviewOut(
        is_owner=bm_ids is None,
        business_manager_ids=sorted(bm_ids) if bm_ids else [],
        ad_account_ids=sorted(account_ids) if account_ids else [],
    )


# ------------------------------------------------------------------------------------ invitations


@router.get("/invitations", response_model=list[s.InvitationOut])
def list_invitations(ctx: OwnerCtx) -> list[s.InvitationOut]:
    rows = InvitationService(ctx.session, ctx.workspace_id, ctx.audit).list_all()
    return [s.InvitationOut.model_validate(row) for row in rows]


@router.post("/invitations", response_model=s.InvitationCreateResponse)
def create_invitation(ctx: OwnerCtx, payload: s.InvitationCreateRequest) -> s.InvitationCreateResponse:
    invitation, raw_token = InvitationService(ctx.session, ctx.workspace_id, ctx.audit).create(
        email=payload.email, role=payload.role, actor_id=ctx.user.id
    )
    ctx.commit()
    return s.InvitationCreateResponse(
        invitation=s.InvitationOut.model_validate(invitation), invite_link_token=raw_token
    )


@router.get("/invitations/{invitation_id}", response_model=s.InvitationOut)
def get_invitation(ctx: OwnerCtx, invitation_id: uuid.UUID) -> s.InvitationOut:
    invitation = InvitationService(ctx.session, ctx.workspace_id, ctx.audit).get(invitation_id)
    return s.InvitationOut.model_validate(invitation)


@router.post("/invitations/{invitation_id}/revoke", response_model=s.InvitationOut)
def revoke_invitation(ctx: OwnerCtx, invitation_id: uuid.UUID, payload: s.ReasonRequest) -> s.InvitationOut:
    invitations = InvitationService(ctx.session, ctx.workspace_id, ctx.audit)
    invitation = invitations.get(invitation_id)
    invitations.revoke(invitation, reason=payload.reason, actor_id=ctx.user.id)
    ctx.commit()
    return s.InvitationOut.model_validate(invitation)


@router.post("/invitations/{invitation_id}/resend", response_model=s.InvitationCreateResponse)
def resend_invitation(ctx: OwnerCtx, invitation_id: uuid.UUID) -> s.InvitationCreateResponse:
    invitations = InvitationService(ctx.session, ctx.workspace_id, ctx.audit)
    invitation = invitations.get(invitation_id)
    new_invitation, raw_token = invitations.resend(invitation, actor_id=ctx.user.id)
    ctx.commit()
    return s.InvitationCreateResponse(
        invitation=s.InvitationOut.model_validate(new_invitation), invite_link_token=raw_token
    )


@router.post("/invitations/accept", response_model=s.InvitationAcceptResponse)
def accept(
    request: Request,
    payload: s.InvitationAcceptRequest,
    authenticated_user: OptionalUser,
    db: Annotated[Session, Depends(get_db)],
) -> s.InvitationAcceptResponse:
    """The one route here that cannot depend on `Ctx`/`OwnerCtx`: there is no established
    workspace yet — this is the endpoint that *discovers* one from the invitation token. It
    also signs the member straight in afterwards, mirroring `auth.login()`'s own session/JWT
    creation (spec §8.C: "Create/reuse server-side device session through existing login flow").
    """
    member, user = accept_invitation(
        db,
        raw_token=payload.token,
        authenticated_user=authenticated_user,
        new_account_password=payload.password,
        new_account_full_name=payload.full_name,
    )

    settings = get_settings()
    expires_at = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)
    audit = AuditLogService(db, member.workspace_id, user.id)
    device_session = SessionRegistryService(db, member.workspace_id, audit).create(
        user_id=user.id,
        expires_at=expires_at,
        user_agent=request.headers.get("user-agent"),
        ip=request.client.host if request.client else None,
    )
    token, expires_at = create_access_token(
        subject=str(user.id),
        workspace_id=str(member.workspace_id),
        role=member.role.value,
        expires_in_minutes=settings.access_token_expire_minutes,
        extra_claims={"session_id": str(device_session.id)},
    )
    db.commit()
    return s.InvitationAcceptResponse(access_token=token, expires_at=expires_at)


# --------------------------------------------------------------------------------- assignments


@router.get("/members/{member_id}/assignments", response_model=s.MemberAssignmentsOut)
def list_assignments(ctx: OwnerCtx, member_id: uuid.UUID) -> s.MemberAssignmentsOut:
    member = _get_member(ctx, member_id)
    assignments = AssignmentService(ctx.session, ctx.workspace_id, ctx.audit)
    return s.MemberAssignmentsOut(
        business_managers=[
            s.AssignmentOut.model_validate(row)
            for row in assignments.list_business_manager_assignments(member)
        ],
        ad_accounts=[
            s.AssignmentOut.model_validate(row) for row in assignments.list_ad_account_assignments(member)
        ],
    )


@router.post("/members/{member_id}/business-manager-assignments", response_model=s.AssignmentOut)
def assign_business_manager(
    ctx: OwnerCtx, member_id: uuid.UUID, payload: s.BusinessManagerAssignmentCreateRequest
) -> s.AssignmentOut:
    member = _get_member(ctx, member_id)
    bm = get_or_404(ctx.session, BusinessManager, payload.business_manager_id, ctx.workspace_id, label="Business Manager")
    row = AssignmentService(ctx.session, ctx.workspace_id, ctx.audit).assign_business_manager(
        member, bm, actor_id=ctx.user.id
    )
    ctx.commit()
    return s.AssignmentOut.model_validate(row)


@router.post("/members/{member_id}/ad-account-assignments", response_model=s.AssignmentOut)
def assign_ad_account(
    ctx: OwnerCtx, member_id: uuid.UUID, payload: s.AdAccountAssignmentCreateRequest
) -> s.AssignmentOut:
    member = _get_member(ctx, member_id)
    account = get_or_404(ctx.session, AdAccount, payload.ad_account_id, ctx.workspace_id, label="Ad account")
    row = AssignmentService(ctx.session, ctx.workspace_id, ctx.audit).assign_ad_account(
        member, account, actor_id=ctx.user.id
    )
    ctx.commit()
    return s.AssignmentOut.model_validate(row)


@router.post("/assignments/{assignment_id}/revoke", response_model=s.AssignmentOut)
def revoke_assignment(ctx: OwnerCtx, assignment_id: uuid.UUID, payload: s.ReasonRequest) -> s.AssignmentOut:
    assignments = AssignmentService(ctx.session, ctx.workspace_id, ctx.audit)
    row = ctx.session.get(MemberBusinessManagerAssignment, assignment_id)
    if row is None or row.workspace_id != ctx.workspace_id:
        row = ctx.session.get(MemberAdAccountAssignment, assignment_id)
    if row is None or row.workspace_id != ctx.workspace_id:
        raise NotFoundError("Assignment not found.")
    assignments.revoke(row, reason=payload.reason, actor_id=ctx.user.id)
    ctx.commit()
    return s.AssignmentOut.model_validate(row)


# ------------------------------------------------------------------------------------- sessions


@router.get("/members/{member_id}/sessions", response_model=list[s.DeviceSessionOut])
def list_member_sessions(ctx: OwnerCtx, member_id: uuid.UUID) -> list[s.DeviceSessionOut]:
    member = _get_member(ctx, member_id)
    rows = SessionRegistryService(ctx.session, ctx.workspace_id, ctx.audit).list_for_user(member.user_id)
    return [s.DeviceSessionOut.model_validate(row) for row in rows]


@router.post("/members/{member_id}/sessions/revoke-all", response_model=s.RevokeSessionResult)
def revoke_all_member_sessions(ctx: OwnerCtx, member_id: uuid.UUID, payload: s.ReasonRequest) -> s.RevokeSessionResult:
    member = _get_member(ctx, member_id)
    count = SessionRegistryService(ctx.session, ctx.workspace_id, ctx.audit).revoke_all_for_member(
        member.user_id, reason=payload.reason, actor_id=ctx.user.id
    )
    ctx.commit()
    return s.RevokeSessionResult(revoked_count=count)
