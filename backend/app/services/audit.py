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
