"""MINI-SPEC A9 domain model — Team Seats, BM/Ad-Account Assignment & Device Session Security.

`DeviceSession` (Step 2) is a dashboard (`web`) session registry only — it never touches or
migrates A5's `ExtensionInstallation`, which already implements the same "row + revoked_at,
re-checked every request" pattern for extension sessions separately
(see `docs/AUDIT_BEFORE_BUILD_A9.md` §4).

`WorkspaceSeatPlan`, `WorkspaceInvitation`, `MemberBusinessManagerAssignment` and
`MemberAdAccountAssignment` (Step 3) are schema only at this point — no service or route reads
or writes them yet; that is Step 4. `WorkspaceMember.status` is added in `app/models/entities.py`
alongside these, since it extends an existing A1 table rather than being a new one.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.core.enums import AssignmentStatus, DeviceSessionType, InvitationStatus, SeatPlanStatus
from app.db.base import Archivable, Base, Timestamped, UUIDPrimaryKey
from app.models.entities import _enum


class DeviceSession(UUIDPrimaryKey, Timestamped, Base):
    """A dashboard JWT's server-side counterpart. The token carries this row's id (`session_id`
    claim); every dashboard request re-loads and re-checks it, so revoking is effective on the
    very next request rather than whenever the token happens to expire (A9 guardrail 5/8)."""

    __tablename__ = "device_sessions"
    __table_args__ = (sa.Index("ix_device_sessions_ws_user", "workspace_id", "user_id"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    session_type: Mapped[DeviceSessionType] = mapped_column(
        _enum(DeviceSessionType, "device_session_type"),
        nullable=False,
        default=DeviceSessionType.WEB,
    )
    #: Operator-facing label, e.g. "Chrome on Windows". Coarse metadata only — never a security
    #: identity, never a full user-agent string, never a fingerprint (A9 guardrail 21/22).
    label: Mapped[str] = mapped_column(sa.String(120), nullable=False, default="")
    browser_family: Mapped[str | None] = mapped_column(sa.String(60))
    os_family: Mapped[str | None] = mapped_column(sa.String(60))
    #: Salted hash only — the raw IP is never persisted or returned (A9 guardrail 20).
    ip_hash: Mapped[str | None] = mapped_column(sa.String(64))
    last_seen_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")
    )
    revoked_reason: Mapped[str | None] = mapped_column(sa.String(200))

    @property
    def is_active(self) -> bool:
        if self.revoked_at is not None:
            return False
        return self.expires_at > datetime.now(UTC)


class WorkspaceSeatPlan(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """Capacity only — never a billing engine (A9 §4/§8.A.1). `seat_used` is deliberately not a
    column here: it is always computed live from `count(active WorkspaceMember)`, the same
    derive-don't-cache convention this codebase already uses for A7/A8 batch status."""

    __tablename__ = "workspace_seat_plans"
    __table_args__ = (sa.UniqueConstraint("workspace_id"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    seat_limit: Mapped[int] = mapped_column(sa.Integer(), nullable=False)
    plan_reference: Mapped[str | None] = mapped_column(sa.String(120))
    plan_status: Mapped[SeatPlanStatus] = mapped_column(
        _enum(SeatPlanStatus, "seat_plan_status"), nullable=False, default=SeatPlanStatus.ACTIVE
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")
    )


class WorkspaceInvitation(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """Only the token *hash* is ever persisted (A9 guardrail 16) — the raw token exists for one
    response, right after `secrets.token_urlsafe()` generates it, and nowhere else afterward."""

    __tablename__ = "workspace_invitations"
    __table_args__ = (
        sa.UniqueConstraint("token_hash"),
        sa.Index("ix_workspace_invitations_ws_email", "workspace_id", "email_normalized"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    email_normalized: Mapped[str] = mapped_column(sa.String(320), nullable=False)
    #: Only admin/operator/viewer — `owner` can never be invited through A9 (guardrail 13).
    invited_role: Mapped[str] = mapped_column(sa.String(20), nullable=False)
    status: Mapped[InvitationStatus] = mapped_column(
        _enum(InvitationStatus, "invitation_status"), nullable=False, default=InvitationStatus.PENDING
    )
    token_hash: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    token_last_four: Mapped[str | None] = mapped_column(sa.String(4))
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    accepted_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")
    )
    revoked_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")
    )
    revoke_reason: Mapped[str | None] = mapped_column(sa.String(200))
    created_by: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )


class MemberBusinessManagerAssignment(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """Grants a non-owner member visibility into one Business Manager (and, per
    `ScopeAuthorizationService`'s rules, every ad account linked to it). Duplicate *active*
    rows for the same member/BM are a service-layer check (Step 4), not a DB constraint — a
    partial unique index would only be enforceable on Postgres, and this project's enum/index
    conventions are deliberately kept portable."""

    __tablename__ = "member_business_manager_assignments"
    __table_args__ = (
        sa.Index("ix_member_bm_assignments_ws_member", "workspace_id", "member_id"),
        sa.Index("ix_member_bm_assignments_bm", "business_manager_id"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspace_members.id", ondelete="RESTRICT"), nullable=False
    )
    business_manager_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("business_managers.id", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[AssignmentStatus] = mapped_column(
        _enum(AssignmentStatus, "assignment_status"), nullable=False, default=AssignmentStatus.ACTIVE
    )
    assigned_by: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    assigned_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")
    )
    revoke_reason: Mapped[str | None] = mapped_column(sa.String(200))


class MemberAdAccountAssignment(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """Grants a non-owner member visibility into exactly one ad account — independent of, and
    additive with, any `MemberBusinessManagerAssignment` covering the same account's BM
    (`ScopeAuthorizationService` takes the union, per A9 §6.1 rule 6)."""

    __tablename__ = "member_ad_account_assignments"
    __table_args__ = (
        sa.Index("ix_member_account_assignments_ws_member", "workspace_id", "member_id"),
        sa.Index("ix_member_account_assignments_account", "ad_account_id"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspace_members.id", ondelete="RESTRICT"), nullable=False
    )
    ad_account_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("ad_accounts.id", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[AssignmentStatus] = mapped_column(
        _enum(AssignmentStatus, "assignment_status"), nullable=False, default=AssignmentStatus.ACTIVE
    )
    assigned_by: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    assigned_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")
    )
    revoke_reason: Mapped[str | None] = mapped_column(sa.String(200))
