"""A8 — Bulk Pixel Share via the official Meta API. Reuses A7's exact draft → preview → confirm
→ run shape (`meta_access_share.py` is the closest sibling) — one new operation type,
`share_pixel_access`, gated on its own capability, nothing else new about the engine.
"""
from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import MetaBatchItemStatus
from app.core.errors import ConflictError, ValidationError
from app.models.entities import AdAccount, Pixel
from app.models.meta_operations import MetaConnection, PixelShareBatch, PixelShareBatchItem
from app.services.audit import AuditLogService
from app.services.base import get_or_404, snapshot
from app.services.meta_batch import (
    MAX_RETRIES,
    assert_within_pilot_cap,
    compute_preview_hash,
    is_lease_expired,
)
from app.services.meta_provider import (
    MetaBusinessProvider,
    MetaFailureCode,
    MetaWriteNotEnabled,
    SharePixelRequest,
    SharePixelResult,
)


@dataclass(frozen=True)
class DraftPixelShareItem:
    source_external_pixel_id: str
    target_ad_account_external_id: str


def _item_preview_fields(item: PixelShareBatchItem) -> dict:
    return {
        "source_external_pixel_id": item.source_external_pixel_id,
        "target_ad_account_external_id": item.target_ad_account_external_id,
    }


class PixelShareBatchService:
    def __init__(
        self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService, actor_id: uuid.UUID | None
    ) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit
        self.actor_id = actor_id

    # ---------------------------------------------------------------- reads
    def get(self, batch_id: uuid.UUID) -> PixelShareBatch:
        return get_or_404(self.session, PixelShareBatch, batch_id, self.workspace_id, label="Pixel share batch")

    def get_item(self, item_id: uuid.UUID) -> PixelShareBatchItem:
        return get_or_404(self.session, PixelShareBatchItem, item_id, self.workspace_id, label="Batch item")

    def list_items(self, batch: PixelShareBatch) -> Sequence[PixelShareBatchItem]:
        return (
            self.session.execute(
                sa.select(PixelShareBatchItem)
                .where(PixelShareBatchItem.batch_id == batch.id)
                .order_by(PixelShareBatchItem.created_at)
            )
            .scalars()
            .all()
        )

    def _current_hash(self, batch: PixelShareBatch) -> str:
        return compute_preview_hash(_item_preview_fields(item) for item in self.list_items(batch))

    def _find_local_pixel(self, external_pixel_id: str) -> uuid.UUID | None:
        row = self.session.execute(
            sa.select(Pixel.id).where(
                Pixel.workspace_id == self.workspace_id, Pixel.external_pixel_id == external_pixel_id
            )
        ).first()
        return row[0] if row else None

    def _find_local_account(self, external_account_id: str) -> uuid.UUID | None:
        row = self.session.execute(
            sa.select(AdAccount.id).where(
                AdAccount.workspace_id == self.workspace_id,
                AdAccount.external_account_id == external_account_id,
            )
        ).first()
        return row[0] if row else None

    # ------------------------------------------------------------- draft → preview → confirm
    def create_draft(
        self, *, meta_connection_id: uuid.UUID, items: Sequence[DraftPixelShareItem]
    ) -> PixelShareBatch:
        if not items:
            raise ValidationError("A batch needs at least one pixel share item.", details={"field": "items"})
        connection = get_or_404(
            self.session, MetaConnection, meta_connection_id, self.workspace_id, label="Meta connection"
        )
        capabilities = connection.capabilities_json or {}
        if capabilities.get("share_pixel_access") is False:
            raise ConflictError(
                "This connection's last capability check reports share_pixel_access is not "
                "allowed. Re-check capability before drafting a batch.",
                details={"reason": capabilities.get("reason")},
            )

        batch = PixelShareBatch(
            workspace_id=self.workspace_id,
            meta_connection_id=connection.id,
            preview_hash="",
            created_by=self.actor_id,
        )
        self.session.add(batch)
        self.session.flush()

        for draft_item in items:
            self.session.add(
                PixelShareBatchItem(
                    workspace_id=self.workspace_id,
                    batch_id=batch.id,
                    source_pixel_id=self._find_local_pixel(draft_item.source_external_pixel_id),
                    source_external_pixel_id=draft_item.source_external_pixel_id,
                    target_ad_account_id=self._find_local_account(draft_item.target_ad_account_external_id),
                    target_ad_account_external_id=draft_item.target_ad_account_external_id,
                    idempotency_key=f"pixel-share:{uuid.uuid4()}",
                    status=MetaBatchItemStatus.QUEUED,
                )
            )
        self.session.flush()
        batch.preview_hash = self._current_hash(batch)
        self.session.flush()
        self.audit.record(
            action="meta_pixel_share_batch.drafted",
            entity_type="meta_pixel_share_batch",
            entity_id=batch.id,
            after=snapshot(batch),
            metadata={"item_count": len(items)},
        )
        return batch

    def preview(self, batch: PixelShareBatch) -> dict:
        return {"batch": batch, "items": self.list_items(batch), "preview_hash": self._current_hash(batch)}

    def confirm(self, batch: PixelShareBatch, *, preview_hash: str) -> PixelShareBatch:
        if batch.confirmed_at is not None:
            raise ConflictError("This batch is already confirmed.")
        current = self._current_hash(batch)
        if current != preview_hash:
            raise ConflictError(
                "This batch changed since it was previewed. Preview it again before confirming.",
                details={"code": "preview_mismatch"},
            )
        batch.confirmed_at = datetime.now(UTC)
        self.session.flush()
        self.audit.record(
            action="meta_pixel_share_batch.confirmed",
            entity_type="meta_pixel_share_batch",
            entity_id=batch.id,
            after={"confirmed_at": batch.confirmed_at.isoformat()},
        )
        return batch

    # -------------------------------------------------------------------------------- run
    def _reclaim_expired_leases(self, items: Sequence[PixelShareBatchItem]) -> None:
        for item in items:
            if item.status == MetaBatchItemStatus.RUNNING and is_lease_expired(item.last_attempted_at):
                item.status = MetaBatchItemStatus.QUEUED
                item.retry_count += 1
                if item.retry_count > MAX_RETRIES:
                    item.status = MetaBatchItemStatus.FAILED
                    item.failure_code = "queue_lease_exceeded_retries"
                    item.failure_summary = "The worker processing this item never reported back, repeatedly."
        self.session.flush()

    def run(self, batch: PixelShareBatch, provider: MetaBusinessProvider) -> PixelShareBatch:
        if batch.confirmed_at is None:
            raise ConflictError("Confirm this batch before running it.")

        all_items = self.list_items(batch)
        self._reclaim_expired_leases(all_items)

        queued = [i for i in all_items if i.status == MetaBatchItemStatus.QUEUED]
        assert_within_pilot_cap(provider, len(queued))

        for item in queued:
            item.status = MetaBatchItemStatus.RUNNING
            item.last_attempted_at = datetime.now(UTC)
            self.session.flush()

            request = SharePixelRequest(
                source_external_pixel_id=item.source_external_pixel_id,
                target_ad_account_external_id=item.target_ad_account_external_id,
                idempotency_key=item.idempotency_key,
            )
            try:
                result = provider.share_pixel_access(request)
            except MetaWriteNotEnabled:
                # A refusal is definite, not ambiguous — see the same handler in
                # `meta_account_creation.py` for why `unknown` would be a lie here.
                result = SharePixelResult(
                    status="failed",
                    failure_code=MetaFailureCode.NOT_SUPPORTED,
                    failure_summary="Writes are not enabled for this connection.",
                )
            except Exception as exc:  # noqa: BLE001 - an unexpected provider crash is ambiguous, not a failure
                result = SharePixelResult(
                    status="unknown", failure_code=MetaFailureCode.UNKNOWN_ERROR, failure_summary=str(exc)[:200]
                )
            self._apply_result(item, result)

        self.session.flush()
        return batch

    def _apply_result(self, item: PixelShareBatchItem, result: SharePixelResult) -> None:
        before = snapshot(item)
        if result.status == "succeeded":
            item.status = MetaBatchItemStatus.SUCCEEDED
            item.access_grant_reference = result.access_grant_reference
            item.failure_code = None
            item.failure_summary = None
        elif result.status == "unknown":
            item.status = MetaBatchItemStatus.UNKNOWN
            item.failure_code = result.failure_code.value if result.failure_code else None
            item.failure_summary = result.failure_summary
        else:
            if result.retryable and item.retry_count < MAX_RETRIES:
                item.status = MetaBatchItemStatus.QUEUED
                item.retry_count += 1
            else:
                item.status = MetaBatchItemStatus.FAILED
            item.failure_code = result.failure_code.value if result.failure_code else None
            item.failure_summary = result.failure_summary
        self.session.flush()
        self.audit.record(
            action=f"meta_pixel_share_item.{item.status.value}",
            entity_type="meta_pixel_share_batch_item",
            entity_id=item.id,
            before=before,
            after=snapshot(item),
        )
