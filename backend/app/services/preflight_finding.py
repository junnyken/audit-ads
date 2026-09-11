"""A6 §6.D `PreflightFindingService` — operator actions on one finding. Mirrors A2's
`HealthSignalActionService`: neither action mutates `draft_status` (mini-spec §6.E rule);
only a fresh evaluation run does that.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.core.enums import FindingStatus
from app.core.errors import ConflictError, ValidationError
from app.models.preflight import PreflightFinding
from app.services.audit import AuditLogService
from app.services.base import get_or_404, snapshot

ACTIVE_STATUSES = (FindingStatus.OPEN, FindingStatus.ACKNOWLEDGED)


def _require_reason(value: str | None) -> str:
    text = (value or "").strip()
    if not text:
        raise ValidationError("A reason is required.", details={"field": "reason"})
    return text


class PreflightFindingService:
    def __init__(
        self,
        session: Session,
        workspace_id: uuid.UUID,
        audit: AuditLogService,
        actor_id: uuid.UUID | None,
    ) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit
        self.actor_id = actor_id

    def get(self, finding_id: uuid.UUID) -> PreflightFinding:
        return get_or_404(
            self.session, PreflightFinding, finding_id, self.workspace_id, label="Preflight finding"
        )

    def acknowledge(self, finding: PreflightFinding, *, reason: str) -> PreflightFinding:
        text = _require_reason(reason)
        if finding.status != FindingStatus.OPEN:
            raise ConflictError(f"Only an open finding can be acknowledged; this one is {finding.status.value}.")
        before = snapshot(finding)
        finding.status = FindingStatus.ACKNOWLEDGED
        finding.resolution_reason = text
        self.session.flush()
        self.audit.record(
            action="preflight_finding.acknowledged",
            entity_type="preflight_finding",
            entity_id=finding.id,
            before=before,
            after=snapshot(finding),
        )
        return finding

    def resolve(self, finding: PreflightFinding, *, reason: str) -> PreflightFinding:
        text = _require_reason(reason)
        if finding.status not in ACTIVE_STATUSES:
            raise ConflictError(
                f"Only an open or acknowledged finding can be resolved; this one is {finding.status.value}."
            )
        before = snapshot(finding)
        finding.status = FindingStatus.RESOLVED
        finding.resolved_at = datetime.now(UTC)
        finding.resolved_by = self.actor_id
        finding.resolution_reason = text
        self.session.flush()
        self.audit.record(
            action="preflight_finding.resolved",
            entity_type="preflight_finding",
            entity_id=finding.id,
            before=before,
            after=snapshot(finding),
        )
        return finding
