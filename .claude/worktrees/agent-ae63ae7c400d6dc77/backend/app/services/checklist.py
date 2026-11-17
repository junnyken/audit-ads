"""ReadinessChecklistService and ReadinessEvidenceService (A1 §C, §E).

`initialise` is idempotent: it inserts only the item keys an account is missing, so calling it
again after a redeploy or a spec change never resets an existing review.

Derived items (an active link, a review timestamp) exist as rows for display and history, but
their state is computed by the readiness engine. Refusing to hand-mark them is what stops
"browser reference assigned" from being ticked while no reference is assigned.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import ChecklistReviewStatus, EvidenceStatus
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.models.entities import AdAccount, ReadinessChecklistItem, ReadinessEvidence
from app.services.audit import AuditLogService
from app.services.base import snapshot
from app.services.checklist_config import DEFAULT_CHECKLIST, DEFAULT_CHECKLIST_BY_KEY


class ReadinessChecklistService:
    def __init__(self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit

    def list_items(self, ad_account_id: uuid.UUID) -> list[ReadinessChecklistItem]:
        stmt = sa.select(ReadinessChecklistItem).where(
            ReadinessChecklistItem.ad_account_id == ad_account_id,
            ReadinessChecklistItem.workspace_id == self.workspace_id,
            ReadinessChecklistItem.archived_at.is_(None),
        )
        return list(self.session.execute(stmt).scalars().all())

    def initialise(self, account: AdAccount) -> list[ReadinessChecklistItem]:
        """Create any missing default items. Safe to call repeatedly."""
        existing = {item.item_key for item in self.list_items(account.id)}
        created: list[ReadinessChecklistItem] = []
        for definition in DEFAULT_CHECKLIST:
            if definition.item_key in existing:
                continue
            item = ReadinessChecklistItem(
                workspace_id=self.workspace_id,
                ad_account_id=account.id,
                item_key=definition.item_key,
                label=definition.label,
                category=definition.category,
                is_mandatory=definition.is_mandatory,
                evidence_status=EvidenceStatus.MISSING,
                review_status=ChecklistReviewStatus.NOT_REVIEWED,
            )
            self.session.add(item)
            created.append(item)
        if created:
            self.session.flush()
            self.audit.record(
                action="readiness_checklist.initialised",
                entity_type="ad_account",
                entity_id=account.id,
                after={"created_item_keys": [item.item_key for item in created]},
            )
        return created

    def get_item(self, ad_account_id: uuid.UUID, item_key: str) -> ReadinessChecklistItem:
        stmt = sa.select(ReadinessChecklistItem).where(
            ReadinessChecklistItem.ad_account_id == ad_account_id,
            ReadinessChecklistItem.workspace_id == self.workspace_id,
            ReadinessChecklistItem.item_key == item_key,
        )
        item = self.session.execute(stmt).scalar_one_or_none()
        if item is None:
            raise NotFoundError(
                "Checklist item was not found for this account.", details={"item_key": item_key}
            )
        return item

    def update_review(
        self,
        item: ReadinessChecklistItem,
        *,
        review_status: ChecklistReviewStatus | None,
        notes: str | None,
        expires_at: datetime | None,
        waiver_reason: str | None,
        actor_id: uuid.UUID | None,
    ) -> ReadinessChecklistItem:
        definition = DEFAULT_CHECKLIST_BY_KEY.get(item.item_key)
        if definition and definition.derived_from and review_status is not None:
            raise ConflictError(
                f"'{item.label}' is derived from recorded facts and cannot be marked by hand. "
                "Change the underlying mapping or review timestamp instead.",
                details={"item_key": item.item_key, "derived_from": definition.derived_from},
            )
        if review_status == ChecklistReviewStatus.WAIVED and not (waiver_reason or "").strip():
            raise ValidationError(
                "A waiver requires a written reason.", details={"field": "waiver_reason"}
            )

        before = snapshot(item)
        if review_status is not None:
            item.review_status = review_status
            item.reviewed_at = datetime.now(UTC)
            item.reviewed_by = actor_id
        if notes is not None:
            item.notes = notes
        if expires_at is not None:
            item.expires_at = expires_at
        if waiver_reason is not None:
            item.waiver_reason = waiver_reason
        self.session.flush()
        self.audit.record(
            action="readiness_checklist_item.reviewed",
            entity_type="readiness_checklist_item",
            entity_id=item.id,
            before=before,
            after=snapshot(item),
            metadata={"ad_account_id": str(item.ad_account_id), "item_key": item.item_key},
        )
        return item

    def recompute_evidence_status(self, item: ReadinessChecklistItem) -> ReadinessChecklistItem:
        """Derive the item's evidence status from its live evidence rows.

        Precedence is worst-first: a rejected or expired artefact is never hidden behind a
        newer 'provided' one, because the operator still has to deal with it.
        """
        now = datetime.now(UTC)
        rows = list(
            self.session.execute(
                sa.select(ReadinessEvidence).where(
                    ReadinessEvidence.checklist_item_id == item.id,
                    ReadinessEvidence.archived_at.is_(None),
                )
            ).scalars().all()
        )
        statuses = set()
        for row in rows:
            status = row.status
            expires_at = row.expires_at
            if expires_at is not None and expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=UTC)
            if status == EvidenceStatus.VERIFIED and expires_at is not None and expires_at <= now:
                status = EvidenceStatus.EXPIRED
            statuses.add(status)

        if EvidenceStatus.REJECTED in statuses:
            resolved = EvidenceStatus.REJECTED
        elif EvidenceStatus.EXPIRED in statuses and EvidenceStatus.VERIFIED not in statuses:
            resolved = EvidenceStatus.EXPIRED
        elif EvidenceStatus.VERIFIED in statuses:
            resolved = EvidenceStatus.VERIFIED
        elif EvidenceStatus.PROVIDED in statuses:
            resolved = EvidenceStatus.PROVIDED
        else:
            resolved = EvidenceStatus.MISSING

        if resolved != item.evidence_status:
            item.evidence_status = resolved
            self.session.flush()
        return item


class ReadinessEvidenceService:
    def __init__(self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit

    def list_for_item(self, checklist_item_id: uuid.UUID) -> list[ReadinessEvidence]:
        stmt = sa.select(ReadinessEvidence).where(
            ReadinessEvidence.checklist_item_id == checklist_item_id,
            ReadinessEvidence.workspace_id == self.workspace_id,
        )
        return list(self.session.execute(stmt.order_by(ReadinessEvidence.provided_at.desc())).scalars().all())

    def add(
        self,
        item: ReadinessChecklistItem,
        *,
        evidence_type: str,
        summary: str,
        storage_reference: str | None,
        external_url: str | None,
        expires_at: datetime | None,
        status: EvidenceStatus,
        actor_id: uuid.UUID | None,
    ) -> ReadinessEvidence:
        now = datetime.now(UTC)
        evidence = ReadinessEvidence(
            workspace_id=self.workspace_id,
            checklist_item_id=item.id,
            evidence_type=evidence_type,
            storage_reference=storage_reference,
            external_url=external_url,
            summary=summary,
            provided_at=now,
            provided_by=actor_id,
            expires_at=expires_at,
            status=status,
        )
        if status == EvidenceStatus.VERIFIED:
            evidence.verified_at = now
            evidence.verified_by = actor_id
        self.session.add(evidence)
        self.session.flush()
        self.audit.record(
            action="readiness_evidence.created",
            entity_type="readiness_evidence",
            entity_id=evidence.id,
            after=snapshot(evidence),
            metadata={"checklist_item_id": str(item.id), "item_key": item.item_key},
        )
        return evidence

    def update(
        self,
        evidence: ReadinessEvidence,
        *,
        status: EvidenceStatus | None,
        summary: str | None,
        expires_at: datetime | None,
        actor_id: uuid.UUID | None,
    ) -> ReadinessEvidence:
        before = snapshot(evidence)
        if status is not None:
            evidence.status = status
            if status == EvidenceStatus.VERIFIED:
                evidence.verified_at = datetime.now(UTC)
                evidence.verified_by = actor_id
        if summary is not None:
            evidence.summary = summary
        if expires_at is not None:
            evidence.expires_at = expires_at
        self.session.flush()
        self.audit.record(
            action="readiness_evidence.updated",
            entity_type="readiness_evidence",
            entity_id=evidence.id,
            before=before,
            after=snapshot(evidence),
        )
        return evidence

    def archive(self, evidence: ReadinessEvidence) -> ReadinessEvidence:
        if evidence.archived_at is not None:
            raise ConflictError("This evidence record is already archived.")
        before = snapshot(evidence)
        evidence.archived_at = datetime.now(UTC)
        self.session.flush()
        self.audit.record(
            action="readiness_evidence.archived",
            entity_type="readiness_evidence",
            entity_id=evidence.id,
            before=before,
            after=snapshot(evidence),
        )
        return evidence
