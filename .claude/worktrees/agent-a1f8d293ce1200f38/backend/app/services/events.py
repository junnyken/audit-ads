"""AccountEventService (A1 §A, §G.5).

Events are operator-recorded observations, not predictions. Creating or resolving one changes
what the readiness engine can justify, so both paths recalculate readiness in the same
transaction.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import EventSeverity, EventStatus
from app.core.errors import ConflictError, ValidationError
from app.models.entities import AccountEvent, AdAccount
from app.services.audit import AuditLogService
from app.services.base import snapshot


class AccountEventService:
    def __init__(self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit

    def list_for_account(self, ad_account_id: uuid.UUID, *, include_archived: bool = False) -> list[AccountEvent]:
        stmt = sa.select(AccountEvent).where(
            AccountEvent.ad_account_id == ad_account_id,
            AccountEvent.workspace_id == self.workspace_id,
        )
        if not include_archived:
            stmt = stmt.where(AccountEvent.archived_at.is_(None))
        return list(self.session.execute(stmt.order_by(AccountEvent.occurred_at.desc())).scalars().all())

    def create(
        self,
        account: AdAccount,
        *,
        event_type: str,
        severity: EventSeverity,
        source: str,
        occurred_at: datetime | None,
        summary: str,
        evidence_reference: str | None,
    ) -> AccountEvent:
        event = AccountEvent(
            workspace_id=self.workspace_id,
            ad_account_id=account.id,
            event_type=event_type,
            severity=severity,
            source=source or "manual",
            occurred_at=occurred_at or datetime.now(UTC),
            summary=summary,
            evidence_reference=evidence_reference,
            status=EventStatus.OPEN,
        )
        self.session.add(event)
        self.session.flush()
        self.audit.record(
            action="account_event.created",
            entity_type="account_event",
            entity_id=event.id,
            after=snapshot(event),
            metadata={"ad_account_id": str(account.id)},
        )
        return event

    def update(
        self,
        event: AccountEvent,
        *,
        severity: EventSeverity | None,
        status: EventStatus | None,
        summary: str | None,
        evidence_reference: str | None,
    ) -> AccountEvent:
        if status == EventStatus.RESOLVED:
            raise ValidationError(
                "Use the resolve action to close an event so a resolution note is recorded.",
                details={"field": "status"},
            )
        before = snapshot(event)
        if severity is not None:
            event.severity = severity
        if status is not None:
            event.status = status
        if summary is not None:
            event.summary = summary
        if evidence_reference is not None:
            event.evidence_reference = evidence_reference
        self.session.flush()
        self.audit.record(
            action="account_event.updated",
            entity_type="account_event",
            entity_id=event.id,
            before=before,
            after=snapshot(event),
        )
        return event

    def resolve(
        self, event: AccountEvent, *, resolution_note: str, actor_id: uuid.UUID | None
    ) -> AccountEvent:
        if event.status == EventStatus.RESOLVED:
            raise ConflictError("This event is already resolved.")
        if not resolution_note.strip():
            raise ValidationError(
                "A resolution note is required so the audit trail explains why the event closed.",
                details={"field": "resolution_note"},
            )
        before = snapshot(event)
        event.status = EventStatus.RESOLVED
        event.resolved_at = datetime.now(UTC)
        event.resolved_by = actor_id
        event.resolution_note = resolution_note
        self.session.flush()
        self.audit.record(
            action="account_event.resolved",
            entity_type="account_event",
            entity_id=event.id,
            before=before,
            after=snapshot(event),
        )
        return event
