"""AssignmentService (A9 Step 4) — grants and revokes a non-owner member's visibility into a
Business Manager or ad account. Duplicate-*active*-row prevention is a service-layer check here,
not a DB constraint (see `docs/AUDIT_BEFORE_BUILD_A9.md`/`TEST_LOG.md` Step 3 entry for why: a
partial unique index would only be enforceable on Postgres).
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import AssignmentStatus, WorkspaceMemberStatus, WorkspaceRole
from app.core.errors import ConflictError, ValidationError
from app.models.entities import AdAccount, BusinessManager, WorkspaceMember
from app.models.team import MemberAdAccountAssignment, MemberBusinessManagerAssignment
from app.services.audit import AuditLogService
from app.services.base import snapshot


class AssignmentService:
    def __init__(self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit

    def _require_assignable_member(self, member: WorkspaceMember) -> None:
        if member.workspace_id != self.workspace_id:
            raise ValidationError("The member does not belong to this workspace.")
        if member.archived_at is not None or member.status != WorkspaceMemberStatus.ACTIVE:
            raise ConflictError("Only an active member can receive a scope assignment.")
        if member.role == WorkspaceRole.OWNER:
            raise ValidationError("The owner already has global access and needs no assignment.")

    def assign_business_manager(
        self, member: WorkspaceMember, business_manager: BusinessManager, *, actor_id: uuid.UUID
    ) -> MemberBusinessManagerAssignment:
        self._require_assignable_member(member)
        if business_manager.workspace_id != self.workspace_id:
            raise ValidationError("The Business Manager does not belong to this workspace.")

        existing = self.session.execute(
            sa.select(MemberBusinessManagerAssignment).where(
                MemberBusinessManagerAssignment.workspace_id == self.workspace_id,
                MemberBusinessManagerAssignment.member_id == member.id,
                MemberBusinessManagerAssignment.business_manager_id == business_manager.id,
                MemberBusinessManagerAssignment.status == AssignmentStatus.ACTIVE,
                MemberBusinessManagerAssignment.archived_at.is_(None),
            )
        ).scalar_one_or_none()
        if existing is not None:
            raise ConflictError("This member already has an active assignment to this Business Manager.")

        row = MemberBusinessManagerAssignment(
            workspace_id=self.workspace_id,
            member_id=member.id,
            business_manager_id=business_manager.id,
            assigned_by=actor_id,
            assigned_at=datetime.now(UTC),
        )
        self.session.add(row)
        self.session.flush()
        self.audit.record(
            action="bm_assignment.created",
            entity_type="member_business_manager_assignment",
            entity_id=row.id,
            after=snapshot(row),
        )
        return row

    def assign_ad_account(
        self, member: WorkspaceMember, ad_account: AdAccount, *, actor_id: uuid.UUID
    ) -> MemberAdAccountAssignment:
        self._require_assignable_member(member)
        if ad_account.workspace_id != self.workspace_id:
            raise ValidationError("The ad account does not belong to this workspace.")

        existing = self.session.execute(
            sa.select(MemberAdAccountAssignment).where(
                MemberAdAccountAssignment.workspace_id == self.workspace_id,
                MemberAdAccountAssignment.member_id == member.id,
                MemberAdAccountAssignment.ad_account_id == ad_account.id,
                MemberAdAccountAssignment.status == AssignmentStatus.ACTIVE,
                MemberAdAccountAssignment.archived_at.is_(None),
            )
        ).scalar_one_or_none()
        if existing is not None:
            raise ConflictError("This member already has an active assignment to this ad account.")

        row = MemberAdAccountAssignment(
            workspace_id=self.workspace_id,
            member_id=member.id,
            ad_account_id=ad_account.id,
            assigned_by=actor_id,
            assigned_at=datetime.now(UTC),
        )
        self.session.add(row)
        self.session.flush()
        self.audit.record(
            action="ad_account_assignment.created",
            entity_type="member_ad_account_assignment",
            entity_id=row.id,
            after=snapshot(row),
        )
        return row

    def revoke(
        self,
        assignment: MemberBusinessManagerAssignment | MemberAdAccountAssignment,
        *,
        reason: str,
        actor_id: uuid.UUID,
    ) -> MemberBusinessManagerAssignment | MemberAdAccountAssignment:
        if assignment.status != AssignmentStatus.ACTIVE:
            return assignment
        before = snapshot(assignment)
        assignment.status = AssignmentStatus.REVOKED
        assignment.revoked_at = datetime.now(UTC)
        assignment.revoked_by = actor_id
        assignment.revoke_reason = reason[:200]
        self.session.flush()
        entity_type = (
            "member_business_manager_assignment"
            if isinstance(assignment, MemberBusinessManagerAssignment)
            else "member_ad_account_assignment"
        )
        self.audit.record(
            action="assignment.revoked",
            entity_type=entity_type,
            entity_id=assignment.id,
            before=before,
            after=snapshot(assignment),
        )
        return assignment

    def list_business_manager_assignments(self, member: WorkspaceMember) -> list[MemberBusinessManagerAssignment]:
        return list(
            self.session.execute(
                sa.select(MemberBusinessManagerAssignment)
                .where(
                    MemberBusinessManagerAssignment.workspace_id == self.workspace_id,
                    MemberBusinessManagerAssignment.member_id == member.id,
                )
                .order_by(MemberBusinessManagerAssignment.created_at.desc())
            ).scalars().all()
        )

    def list_ad_account_assignments(self, member: WorkspaceMember) -> list[MemberAdAccountAssignment]:
        return list(
            self.session.execute(
                sa.select(MemberAdAccountAssignment)
                .where(
                    MemberAdAccountAssignment.workspace_id == self.workspace_id,
                    MemberAdAccountAssignment.member_id == member.id,
                )
                .order_by(MemberAdAccountAssignment.created_at.desc())
            ).scalars().all()
        )
