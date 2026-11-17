"""SeatPlanService (A9 Step 4).

`seat_used` is never a stored column — always `count(active WorkspaceMember)` at read time, the
same derive-don't-cache convention this codebase already uses for A7/A8 batch status and A2
health. Evidence-first: a workspace with no configured plan has an *unknown* seat capacity, not
an assumed one — invitations are blocked until an owner explicitly sets a limit, rather than
this service guessing a starting number (CLAUDE.md rule 4).
"""
from __future__ import annotations

import uuid

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import WorkspaceMemberStatus
from app.core.errors import ConflictError, ValidationError
from app.models.entities import WorkspaceMember
from app.models.team import WorkspaceSeatPlan
from app.services.audit import AuditLogService
from app.services.base import diff, snapshot


class SeatPlanService:
    def __init__(self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit

    def get(self) -> WorkspaceSeatPlan | None:
        return self.session.execute(
            sa.select(WorkspaceSeatPlan).where(
                WorkspaceSeatPlan.workspace_id == self.workspace_id,
                WorkspaceSeatPlan.archived_at.is_(None),
            )
        ).scalar_one_or_none()

    def seat_used(self) -> int:
        return self.session.execute(
            sa.select(sa.func.count()).select_from(WorkspaceMember).where(
                WorkspaceMember.workspace_id == self.workspace_id,
                WorkspaceMember.archived_at.is_(None),
                WorkspaceMember.status == WorkspaceMemberStatus.ACTIVE,
            )
        ).scalar_one()

    def seat_available(self) -> int | None:
        plan = self.get()
        if plan is None:
            return None
        return max(plan.seat_limit - self.seat_used(), 0)

    def require_available_seat(self) -> None:
        """Raised by invitation acceptance and reactivation — the one place seat capacity is
        actually enforced, atomically, inside the caller's own transaction."""
        available = self.seat_available()
        if available is None:
            raise ConflictError("This workspace has no seat plan configured yet.")
        if available <= 0:
            raise ConflictError("No seats are available. Increase the seat limit or free one up first.")

    def create_or_update(self, *, seat_limit: int, plan_reference: str | None, actor_id: uuid.UUID) -> WorkspaceSeatPlan:
        if seat_limit < 0:
            raise ValidationError("seat_limit must be a non-negative integer.")
        used = self.seat_used()
        if seat_limit < used:
            raise ConflictError(
                f"seat_limit cannot be reduced below the {used} currently active member(s)."
            )

        plan = self.get()
        if plan is None:
            plan = WorkspaceSeatPlan(
                workspace_id=self.workspace_id,
                seat_limit=seat_limit,
                plan_reference=plan_reference,
                created_by=actor_id,
                updated_by=actor_id,
            )
            self.session.add(plan)
            self.session.flush()
            self.audit.record(
                action="seat_plan.created",
                entity_type="workspace_seat_plan",
                entity_id=plan.id,
                after=snapshot(plan),
            )
            return plan

        before = snapshot(plan)
        plan.seat_limit = seat_limit
        plan.plan_reference = plan_reference
        plan.updated_by = actor_id
        self.session.flush()
        after = snapshot(plan)
        self.audit.record(
            action="seat_plan.updated",
            entity_type="workspace_seat_plan",
            entity_id=plan.id,
            before=before,
            after=after,
            metadata={"changed": list(diff(before, after))},
        )
        return plan
