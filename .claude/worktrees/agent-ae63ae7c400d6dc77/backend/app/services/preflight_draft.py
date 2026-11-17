"""A6 §6.D `CampaignDraftService` — CRUD/archive/restore for `CampaignDraft`, mirroring
`AdAccountRegistryService`'s shape exactly (A6 guardrail: reuse A1 conventions).

A draft's own `draft_status` is never set here — only `PreflightEvaluationService` (running the
rule engines) is allowed to move it. Create/update always reset a stale draft back to `draft`,
so an edited draft never keeps displaying a verdict that no longer matches its content.
"""
from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import DraftStatus, FindingSeverity, FindingStatus
from app.core.errors import ConflictError
from app.models.entities import AdAccount
from app.models.preflight import CampaignDraft, PreflightFinding
from app.services.audit import AuditLogService
from app.services.base import apply_sort, diff, get_or_404, paginate, snapshot

SORTABLE = {"updated_at", "created_at", "title", "draft_status", "last_evaluated_at"}

#: A finding still "counts" toward the verdict while acknowledged, not only while untouched —
#: mirrors `AccountHealthSignal.is_active` (open+acknowledged), and matches the mini-spec's own
#: "acknowledging a finding does not itself change draft_status" (it would, silently, if
#: acknowledging removed the finding from this count).
ACTIVE_FINDING_STATUSES = (FindingStatus.OPEN, FindingStatus.ACKNOWLEDGED)


@dataclass
class DraftFilters:
    search: str | None = None
    draft_status: str | None = None
    ad_account_id: uuid.UUID | None = None
    has_blocking_findings: bool | None = None
    archived: bool = False
    page: int = 1
    page_size: int = 25
    sort: str = "updated_at"
    sort_direction: str = "desc"


class CampaignDraftService:
    def __init__(self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit

    # ---------------------------------------------------------------- reads
    def get(self, draft_id: uuid.UUID) -> CampaignDraft:
        return get_or_404(self.session, CampaignDraft, draft_id, self.workspace_id, label="Campaign draft")

    def _has_blocking_findings_exists(self):
        return (
            sa.select(PreflightFinding.id)
            .where(
                PreflightFinding.draft_id == CampaignDraft.id,
                PreflightFinding.severity == FindingSeverity.BLOCKING,
                PreflightFinding.status.in_(ACTIVE_FINDING_STATUSES),
                PreflightFinding.archived_at.is_(None),
            )
            .exists()
        )

    def list(self, filters: DraftFilters) -> tuple[Sequence[CampaignDraft], int]:
        stmt = sa.select(CampaignDraft).where(CampaignDraft.workspace_id == self.workspace_id)
        stmt = (
            stmt.where(CampaignDraft.archived_at.is_not(None))
            if filters.archived
            else stmt.where(CampaignDraft.archived_at.is_(None))
        )
        if filters.search:
            needle = f"%{filters.search.strip()}%"
            stmt = stmt.where(
                sa.or_(CampaignDraft.title.ilike(needle), CampaignDraft.primary_copy.ilike(needle))
            )
        if filters.draft_status:
            stmt = stmt.where(CampaignDraft.draft_status == DraftStatus(filters.draft_status))
        if filters.ad_account_id:
            stmt = stmt.where(CampaignDraft.ad_account_id == filters.ad_account_id)
        if filters.has_blocking_findings is not None:
            condition = self._has_blocking_findings_exists()
            stmt = stmt.where(condition if filters.has_blocking_findings else sa.not_(condition))

        stmt = apply_sort(stmt, CampaignDraft, filters.sort, filters.sort_direction, SORTABLE)
        return paginate(self.session, stmt, page=filters.page, page_size=filters.page_size)

    def open_finding_counts(self, draft_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, dict[str, int]]:
        """`{blocking: N, warning: N}` per draft, counting only active (open/acknowledged)
        findings — the same population the verdict rollup itself treats as still outstanding."""
        result: dict[uuid.UUID, dict[str, int]] = {
            draft_id: {"blocking": 0, "warning": 0} for draft_id in draft_ids
        }
        if not draft_ids:
            return result
        rows = self.session.execute(
            sa.select(
                PreflightFinding.draft_id, PreflightFinding.severity, sa.func.count()
            )
            .where(
                PreflightFinding.draft_id.in_(draft_ids),
                PreflightFinding.status.in_(ACTIVE_FINDING_STATUSES),
                PreflightFinding.archived_at.is_(None),
                PreflightFinding.severity.in_((FindingSeverity.BLOCKING, FindingSeverity.WARNING)),
            )
            .group_by(PreflightFinding.draft_id, PreflightFinding.severity)
        ).all()
        for draft_id, severity, count in rows:
            key = "blocking" if severity == FindingSeverity.BLOCKING else "warning"
            result[draft_id][key] = count
        return result

    # ------------------------------------------------------------- mutations
    def create(self, payload: dict[str, Any], *, actor_id: uuid.UUID) -> CampaignDraft:
        payload = dict(payload)
        if payload.get("ad_account_id"):
            get_or_404(self.session, AdAccount, payload["ad_account_id"], self.workspace_id, label="Ad account")

        draft = CampaignDraft(
            workspace_id=self.workspace_id,
            draft_status=DraftStatus.DRAFT,
            created_by=actor_id,
            **payload,
        )
        self.session.add(draft)
        self.session.flush()
        self.audit.record(
            action="preflight_draft.created",
            entity_type="campaign_draft",
            entity_id=draft.id,
            after=snapshot(draft),
        )
        return draft

    def update(self, draft: CampaignDraft, payload: dict[str, Any], *, actor_id: uuid.UUID) -> CampaignDraft:
        if draft.archived_at is not None:
            raise ConflictError("This draft is archived. Restore it before making changes.")
        if payload.get("ad_account_id"):
            get_or_404(self.session, AdAccount, payload["ad_account_id"], self.workspace_id, label="Ad account")

        before = snapshot(draft)
        for key, value in payload.items():
            setattr(draft, key, value)
        # Edited content invalidates any prior verdict — the operator must re-run the check.
        draft.draft_status = DraftStatus.DRAFT
        draft.updated_by = actor_id
        self.session.flush()
        after = snapshot(draft)
        changed = diff(before, after)
        if changed:
            self.audit.record(
                action="preflight_draft.updated",
                entity_type="campaign_draft",
                entity_id=draft.id,
                before={k: before.get(k) for k in changed},
                after=changed,
            )
        return draft

    def archive(self, draft: CampaignDraft) -> CampaignDraft:
        if draft.archived_at is not None:
            raise ConflictError("This draft is already archived.")
        before = snapshot(draft)
        draft.archived_at = datetime.now(UTC)
        self.session.flush()
        self.audit.record(
            action="preflight_draft.archived",
            entity_type="campaign_draft",
            entity_id=draft.id,
            before={"archived_at": before.get("archived_at")},
            after={"archived_at": draft.archived_at.isoformat()},
        )
        return draft

    def restore(self, draft: CampaignDraft) -> CampaignDraft:
        if draft.archived_at is None:
            raise ConflictError("This draft is not archived.")
        before = snapshot(draft)
        draft.archived_at = None
        self.session.flush()
        self.audit.record(
            action="preflight_draft.restored",
            entity_type="campaign_draft",
            entity_id=draft.id,
            before={"archived_at": before.get("archived_at")},
            after={"archived_at": None},
        )
        return draft
