"""AuditLogService (A1 Guardrail 8/9).

Audit rows are written by the same session as the mutation they describe, so a commit either
persists both or neither. Payloads are redacted before persistence — the audit trail is the
last place a leaked secret should be allowed to live.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.core.context import get_request_id
from app.core.redaction import redact
from app.models.entities import AuditLog


class AuditLogService:
    def __init__(self, session: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID | None) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.actor_id = actor_id

    def record(
        self,
        *,
        action: str,
        entity_type: str,
        entity_id: Any,
        before: dict[str, Any] | None = None,
        after: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> AuditLog:
        entry = AuditLog(
            workspace_id=self.workspace_id,
            actor_id=self.actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id),
            before_json=redact(before) if before else None,
            after_json=redact(after) if after else None,
            metadata_json=redact(metadata) if metadata else None,
            request_id=get_request_id(),
            created_at=datetime.now(UTC),
        )
        self.session.add(entry)
        return entry


#: O3. The actor a scheduled pass writes into every audit row's metadata. Not a user: there is
#: no fake user in this product, and naming a person for work no person did is what the older
#: "first member of the workspace" pattern did (S1/A4 still do — a separate follow-up).
SYSTEM_DISCOVERY_SWEEP_ACTOR = "system:discovery_sweep"
#: O4. The scheduled check of vault reader credentials.
SYSTEM_CREDENTIAL_CHECK_ACTOR = "system:credential_check"


class SystemAuditLogService(AuditLogService):
    """Audit for work the system did on its own (O3's discovery sweep).

    `actor_id` is always NULL — the column has always allowed it — and every row, including the
    ones written deep inside the registry, checklist, health and alert services on the way, gets
    `metadata.actor` and `metadata.operational_run_id`. Rule 3 still holds: same session, same
    transaction, redacted. What changes is only that the row says truthfully who acted.
    """

    def __init__(
        self,
        session: Session,
        workspace_id: uuid.UUID,
        *,
        actor: str,
        operational_run_id: uuid.UUID | None = None,
    ) -> None:
        super().__init__(session, workspace_id, None)
        self.system_actor = actor
        self.operational_run_id = operational_run_id

    def record(self, *, metadata: dict[str, Any] | None = None, **kwargs: Any) -> AuditLog:
        stamped = {
            **(metadata or {}),
            "actor": self.system_actor,
            "operational_run_id": str(self.operational_run_id) if self.operational_run_id else None,
        }
        return super().record(metadata=stamped, **kwargs)
