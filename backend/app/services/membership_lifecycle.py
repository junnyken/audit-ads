"""MembershipLifecycleService (A9 Step 4) — role change, suspend/unsuspend, deactivate/
reactivate, archive. All of it enforces "the workspace never ends with zero active owners"
(guardrail 14) and revokes every server-side dashboard session on suspend/deactivate/archive
(guardrail 7) through `SessionRegistryService`, the same registry Step 2 built.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import WorkspaceMemberStatus, WorkspaceRole
from app.core.errors import ConflictError, ValidationError
from app.models.entities import WorkspaceMember
from app.services.audit import AuditLogService
from app.services.base import snapshot
from app.services.seat_plan import SeatPlanService
from app.services.session_registry import SessionRegistryService
from app.services.workspace import A9_ROLE_TO_WORKSPACE_ROLE


class MembershipLifecycleService:
    def __init__(self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit
        self.seats = SeatPlanService(session, workspace_id, audit)
        self.sessions = SessionRegistryService(session, workspace_id, audit)

    def _active_owner_count(self, *, excluding: uuid.UUID | None = None) -> int:
        stmt = sa.select(sa.func.count()).select_from(WorkspaceMember).where(
            WorkspaceMember.workspace_id == self.workspace_id,
            WorkspaceMember.archived_at.is_(None),
            WorkspaceMember.status == WorkspaceMemberStatus.ACTIVE,
            WorkspaceMember.role == WorkspaceRole.OWNER,
        )
        if excluding is not None:
            stmt = stmt.where(WorkspaceMember.id != excluding)
        return self.session.execute(stmt).scalar_one()

    def _require_another_active_owner(self, member: WorkspaceMember, *, action: str) -> None:
        """Guardrail 14/15: the last active owner can't be downgraded, suspended, deactivated
        or archived through A9 — not even by themself."""
        if member.role != WorkspaceRole.OWNER:
            return
        if self._active_owner_count(excluding=member.id) == 0:
            raise ConflictError(f"{action} would leave the workspace with no active owner.")

    def change_role(self, member: WorkspaceMember, *, new_role: str, actor_id: uuid.UUID) -> WorkspaceMember:
        target = A9_ROLE_TO_WORKSPACE_ROLE.get(new_role)
        if target is None:
            raise ValidationError(
                "Role must be one of: " + ", ".join(sorted(A9_ROLE_TO_WORKSPACE_ROLE))
            )
        self._require_another_active_owner(member, action="Changing this member's role")

        before = snapshot(member)
        member.role = target
        self.session.flush()
        after = snapshot(member)
        self.audit.record(
            action="member.role_changed",
            entity_type="workspace_member",
            entity_id=member.id,
            before=before,
            after=after,
        )
        return member

    def suspend(self, member: WorkspaceMember, *, reason: str, actor_id: uuid.UUID) -> WorkspaceMember:
        self._require_another_active_owner(member, action="Suspending this member")
        before = snapshot(member)
        member.status = WorkspaceMemberStatus.SUSPENDED
        self.session.flush()
        self.audit.record(
            action="member.suspended",
            entity_type="workspace_member",
            entity_id=member.id,
            before=before,
            after=snapshot(member),
            metadata={"reason": reason[:200]},
        )
        # Guardrail 7: suspended is one of the states that must deny access immediately, not
        # just block future logins — every session this member currently holds is revoked now.
        self.sessions.revoke_all_for_member(member.user_id, reason=reason, actor_id=actor_id)
        return member

    def unsuspend(self, member: WorkspaceMember, *, actor_id: uuid.UUID) -> WorkspaceMember:
        if member.status != WorkspaceMemberStatus.SUSPENDED:
            raise ConflictError("Only a suspended member can be unsuspended.")
        before = snapshot(member)
        member.status = WorkspaceMemberStatus.ACTIVE
        self.session.flush()
        self.audit.record(
            action="member.unsuspended",
            entity_type="workspace_member",
            entity_id=member.id,
            before=before,
            after=snapshot(member),
        )
        return member

    def deactivate(self, member: WorkspaceMember, *, reason: str, actor_id: uuid.UUID) -> WorkspaceMember:
        self._require_another_active_owner(member, action="Deactivating this member")
        before = snapshot(member)
        member.status = WorkspaceMemberStatus.DEACTIVATED
        self.session.flush()
        self.audit.record(
            action="member.deactivated",
            entity_type="workspace_member",
            entity_id=member.id,
            before=before,
            after=snapshot(member),
            metadata={"reason": reason[:200]},
        )
        self.sessions.revoke_all_for_member(member.user_id, reason=reason, actor_id=actor_id)
        return member

    def reactivate(self, member: WorkspaceMember, *, actor_id: uuid.UUID) -> WorkspaceMember:
        if member.status != WorkspaceMemberStatus.DEACTIVATED:
            raise ConflictError("Only a deactivated member can be reactivated.")
        self.seats.require_available_seat()
        before = snapshot(member)
        member.status = WorkspaceMemberStatus.ACTIVE
        self.session.flush()
        self.audit.record(
            action="member.reactivated",
            entity_type="workspace_member",
            entity_id=member.id,
            before=before,
            after=snapshot(member),
        )
        return member

    def archive(self, member: WorkspaceMember, *, reason: str, actor_id: uuid.UUID) -> WorkspaceMember:
        self._require_another_active_owner(member, action="Archiving this member")
        before = snapshot(member)
        member.archived_at = datetime.now(UTC)
        self.session.flush()
        self.audit.record(
            action="member.archived",
            entity_type="workspace_member",
            entity_id=member.id,
            before=before,
            after=snapshot(member),
            metadata={"reason": reason[:200]},
        )
        self.sessions.revoke_all_for_member(member.user_id, reason=reason, actor_id=actor_id)
        return member
