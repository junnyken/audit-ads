"""InvitationService (A9 Step 4).

`accept_invitation()` is a module-level function, not a method on `InvitationService`: unlike
create/revoke/resend, which all act on a workspace the caller already knows, accepting a token
is how the workspace gets *discovered* in the first place — there is no `workspace_id` to
construct a service instance with until the token itself is looked up.

Resolved design (confirmed with the product owner — this codebase has no self-registration
endpoint at all, `User` rows were only ever created once by `app/bootstrap.py` before this):
if the invited email already belongs to a `User`, accepting requires being authenticated as
that user first (log in via the existing `/auth/login`, then accept with that bearer token) —
`accept_invitation()` is refused, not silently allowed to hijack an existing account, when no
matching authenticated user is supplied. If the email is brand new, `accept_invitation()`
creates the `User` itself, from a password supplied in the same call — accepting an invitation
*is* how a brand-new employee registers.

Only the token *hash* (`hash_token`) is ever persisted — the raw token
(`generate_token`) exists for exactly one return value, right after creation, and nowhere else
(A9 guardrail 16).

**Spec gap, resolved:** the mini-spec's "Create invitation" flow (§8.C) accepts optional initial
BM/ad-account assignments as input, to be "applied transactionally only after valid acceptance"
— but `WorkspaceInvitation`'s own schema (§8.A.2) has no field to hold that choice between
create and accept. Rather than add an undocumented column to bridge it, initial assignments are
out of scope for `create()`: the owner assigns BM/account access through `AssignmentService`
after the member becomes active — same result, one extra call instead of one bundled payload.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import InvitationStatus, WorkspaceMemberStatus
from app.core.errors import AuthenticationError, ConflictError, NotFoundError, ValidationError
from app.core.security import hash_password
from app.models.entities import User, WorkspaceMember
from app.models.team import WorkspaceInvitation
from app.services.audit import AuditLogService
from app.services.base import snapshot
from app.services.seat_plan import SeatPlanService
from app.services.workspace import A9_ROLE_TO_WORKSPACE_ROLE

#: "Unless existing security policy differs" (spec §8.A.2) — no such policy exists in this
#: codebase yet, so this is a service-level constant, matching `MAX_RETRIES`/`LEASE_TIMEOUT` in
#: `meta_batch.py` rather than a new settings field for one number.
INVITATION_EXPIRY = timedelta(days=7)


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


def normalize_email(email: str) -> str:
    return email.strip().lower()


class InvitationService:
    def __init__(self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit

    def _mark_expired_if_needed(self, invitation: WorkspaceInvitation) -> WorkspaceInvitation:
        if invitation.status == InvitationStatus.PENDING and invitation.expires_at <= datetime.now(UTC):
            invitation.status = InvitationStatus.EXPIRED
            self.session.flush()
        return invitation

    def get(self, invitation_id: uuid.UUID) -> WorkspaceInvitation:
        row = self.session.execute(
            sa.select(WorkspaceInvitation).where(
                WorkspaceInvitation.id == invitation_id,
                WorkspaceInvitation.workspace_id == self.workspace_id,
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFoundError("Invitation not found.")
        return self._mark_expired_if_needed(row)

    def list_all(self) -> list[WorkspaceInvitation]:
        rows = self.session.execute(
            sa.select(WorkspaceInvitation)
            .where(WorkspaceInvitation.workspace_id == self.workspace_id)
            .order_by(WorkspaceInvitation.created_at.desc())
        ).scalars().all()
        return [self._mark_expired_if_needed(row) for row in rows]

    def create(self, *, email: str, role: str, actor_id: uuid.UUID) -> tuple[WorkspaceInvitation, str]:
        if role not in A9_ROLE_TO_WORKSPACE_ROLE:
            raise ValidationError(
                "Role must be one of: " + ", ".join(sorted(A9_ROLE_TO_WORKSPACE_ROLE))
            )
        normalized = normalize_email(email)

        already_a_member = self.session.execute(
            sa.select(sa.literal(True)).where(
                sa.exists().where(
                    WorkspaceMember.workspace_id == self.workspace_id,
                    WorkspaceMember.archived_at.is_(None),
                    WorkspaceMember.status == WorkspaceMemberStatus.ACTIVE,
                    WorkspaceMember.user_id == User.id,
                    User.email == normalized,
                )
            )
        ).scalar_one_or_none()
        if already_a_member:
            raise ConflictError("This person is already an active member of this workspace.")

        # Default: revoke/supersede any existing pending invitation for the same email
        # (spec §8.A.2 — no policy in this codebase supports multiple simultaneous ones).
        existing_pending = self.session.execute(
            sa.select(WorkspaceInvitation).where(
                WorkspaceInvitation.workspace_id == self.workspace_id,
                WorkspaceInvitation.email_normalized == normalized,
                WorkspaceInvitation.status == InvitationStatus.PENDING,
            )
        ).scalars().all()
        for row in existing_pending:
            self._revoke(row, reason="Superseded by a new invitation.", actor_id=actor_id)

        raw_token = generate_token()
        invitation = WorkspaceInvitation(
            workspace_id=self.workspace_id,
            email_normalized=normalized,
            invited_role=role,
            token_hash=hash_token(raw_token),
            token_last_four=raw_token[-4:],
            expires_at=datetime.now(UTC) + INVITATION_EXPIRY,
            sent_at=datetime.now(UTC),
            created_by=actor_id,
        )
        self.session.add(invitation)
        self.session.flush()
        self.audit.record(
            action="invitation.created",
            entity_type="workspace_invitation",
            entity_id=invitation.id,
            # Never the raw token or its hash — `token_last_four` only, matching the schema's
            # own display-safe field (guardrail 16/25).
            after={"email": normalized, "role": role, "token_last_four": invitation.token_last_four},
        )
        return invitation, raw_token

    def revoke(self, invitation: WorkspaceInvitation, *, reason: str, actor_id: uuid.UUID) -> WorkspaceInvitation:
        invitation = self._mark_expired_if_needed(invitation)
        if invitation.status != InvitationStatus.PENDING:
            raise ConflictError(f"Only a pending invitation can be revoked (this one is {invitation.status.value}).")
        return self._revoke(invitation, reason=reason, actor_id=actor_id)

    def _revoke(self, invitation: WorkspaceInvitation, *, reason: str, actor_id: uuid.UUID) -> WorkspaceInvitation:
        before = snapshot(invitation)
        invitation.status = InvitationStatus.REVOKED
        invitation.revoked_at = datetime.now(UTC)
        invitation.revoked_by = actor_id
        invitation.revoke_reason = reason[:200]
        self.session.flush()
        self.audit.record(
            action="invitation.revoked",
            entity_type="workspace_invitation",
            entity_id=invitation.id,
            before=before,
            after=snapshot(invitation),
        )
        return invitation

    def resend(self, invitation: WorkspaceInvitation, *, actor_id: uuid.UUID) -> tuple[WorkspaceInvitation, str]:
        invitation = self._mark_expired_if_needed(invitation)
        if invitation.status not in (InvitationStatus.PENDING, InvitationStatus.EXPIRED):
            raise ConflictError(
                f"Only a pending or expired invitation can be resent (this one is {invitation.status.value})."
            )
        self._revoke(invitation, reason="Superseded by resend.", actor_id=actor_id)
        new_invitation, raw_token = self.create(
            email=invitation.email_normalized, role=invitation.invited_role, actor_id=actor_id
        )
        self.audit.record(
            action="invitation.resent",
            entity_type="workspace_invitation",
            entity_id=new_invitation.id,
            metadata={"superseded_invitation_id": str(invitation.id)},
        )
        return new_invitation, raw_token


def accept_invitation(
    session: Session,
    *,
    raw_token: str,
    authenticated_user: User | None,
    new_account_password: str | None = None,
    new_account_full_name: str = "",
) -> tuple[WorkspaceMember, User]:
    """The workspace is discovered from the token itself — see the module docstring for why this
    isn't a method on `InvitationService`.

    - `authenticated_user` given: must be the exact user the invitation was sent to. Anyone
      already signed in as someone else is refused, not silently switched.
    - `authenticated_user=None`: the email must be brand new. An existing account can never be
      claimed this way — `accept_invitation()` refuses it and tells the caller to sign in first,
      rather than let a stranger who merely knows a real employee's email address try a
      password against their account (or worse, silently overwrite it).
    """
    invitation = session.execute(
        sa.select(WorkspaceInvitation).where(WorkspaceInvitation.token_hash == hash_token(raw_token))
    ).scalar_one_or_none()
    if invitation is None:
        raise NotFoundError("This invitation link is not valid.")
    if invitation.status == InvitationStatus.PENDING and invitation.expires_at <= datetime.now(UTC):
        invitation.status = InvitationStatus.EXPIRED
        session.flush()
    if invitation.status != InvitationStatus.PENDING:
        raise ConflictError(f"This invitation is {invitation.status.value} and can no longer be accepted.")

    existing_user = session.execute(
        sa.select(User).where(User.email == invitation.email_normalized)
    ).scalar_one_or_none()

    if existing_user is not None:
        if authenticated_user is None or authenticated_user.id != existing_user.id:
            raise AuthenticationError(
                "An account already exists for this email. Sign in, then accept the invitation."
            )
        target_user = existing_user
    else:
        if authenticated_user is not None:
            raise ConflictError("This invitation was not sent to your account.")
        if not new_account_password or len(new_account_password) < 8:
            raise ValidationError("A password of at least 8 characters is required to accept this invitation.")
        target_user = User(
            email=invitation.email_normalized,
            full_name=new_account_full_name.strip() or invitation.email_normalized.split("@")[0],
            password_hash=hash_password(new_account_password),
        )
        session.add(target_user)
        session.flush()

    workspace_id = invitation.workspace_id
    audit = AuditLogService(session, workspace_id, target_user.id)
    SeatPlanService(session, workspace_id, audit).require_available_seat()

    target_role = A9_ROLE_TO_WORKSPACE_ROLE[invitation.invited_role]
    existing_membership = session.execute(
        sa.select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == target_user.id
        )
    ).scalar_one_or_none()

    if existing_membership is not None:
        # A previously deactivated/archived member accepting a fresh invitation — reactivate
        # the same row rather than violate the workspace_id+user_id unique constraint.
        before = snapshot(existing_membership)
        existing_membership.status = WorkspaceMemberStatus.ACTIVE
        existing_membership.archived_at = None
        existing_membership.role = target_role
        session.flush()
        audit.record(
            action="member.reactivated",
            entity_type="workspace_member",
            entity_id=existing_membership.id,
            before=before,
            after=snapshot(existing_membership),
            metadata={"via": "invitation_accept"},
        )
        member = existing_membership
    else:
        member = WorkspaceMember(
            workspace_id=workspace_id,
            user_id=target_user.id,
            role=target_role,
            status=WorkspaceMemberStatus.ACTIVE,
        )
        session.add(member)
        session.flush()
        audit.record(
            action="member.created",
            entity_type="workspace_member",
            entity_id=member.id,
            after=snapshot(member),
            metadata={"via": "invitation_accept"},
        )

    before = snapshot(invitation)
    invitation.status = InvitationStatus.ACCEPTED
    invitation.accepted_at = datetime.now(UTC)
    invitation.accepted_by_user_id = target_user.id
    session.flush()
    audit.record(
        action="invitation.accepted",
        entity_type="workspace_invitation",
        entity_id=invitation.id,
        before=before,
        after=snapshot(invitation),
    )
    return member, target_user
