"""A7 §1 — create ad accounts via the official Meta API (or the fake provider until one is
wired). Draft → preview → confirm → run, sequentially, bounded retry only for the failure codes
the provider itself marks retryable, `unknown` on timeout with no blind retry, and a synced
account that always starts `readiness=unknown, health=unknown` because it is created through
the same registry path every other account uses — never a special-cased "trusted" account.
"""
from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import EvaluationTrigger, MetaBatchItemStatus
from app.core.errors import ConflictError, ValidationError
from app.models.meta_operations import AccountCreationBatch, AccountCreationBatchItem, MetaConnection
from app.services.audit import AuditLogService
from app.services.base import get_or_404, snapshot
from app.services.health_service import AccountHealthEvaluationService
from app.services.meta_batch import (
    MAX_RETRIES,
    assert_within_pilot_cap,
    compute_preview_hash,
    is_lease_expired,
)
from app.services.meta_provider import (
    CreateAccountRequest,
    CreateAccountResult,
    MetaBusinessProvider,
    MetaFailureCode,
    MetaWriteNotEnabled,
)
from app.services.registry import AdAccountRegistryService

ACTIVE_ITEM_STATUSES = (MetaBatchItemStatus.QUEUED, MetaBatchItemStatus.RUNNING)


@dataclass(frozen=True)
class DraftAccountItem:
    name: str
    currency: str
    country: str | None = None
    timezone: str | None = None
    #: Meta's integer timezone identifier — the value its create endpoint actually takes.
    timezone_id: int | None = None


def _item_preview_fields(item: AccountCreationBatchItem) -> dict:
    # `timezone_id` belongs here: it is sent to Meta and lands on a permanent artifact, so a
    # change to it between preview and confirm must invalidate the confirmation. A field that is
    # transmitted but absent from the hash is exactly the gap the hash exists to close.
    return {
        "name": item.name,
        "currency": item.currency,
        "country": item.country,
        "timezone": item.timezone,
        "timezone_id": item.timezone_id,
    }


class AccountCreationBatchService:
    def __init__(
        self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService, actor_id: uuid.UUID | None
    ) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit
        self.actor_id = actor_id

    # ---------------------------------------------------------------- reads
    def get(self, batch_id: uuid.UUID) -> AccountCreationBatch:
        return get_or_404(
            self.session, AccountCreationBatch, batch_id, self.workspace_id, label="Account creation batch"
        )

    def get_item(self, item_id: uuid.UUID) -> AccountCreationBatchItem:
        return get_or_404(
            self.session, AccountCreationBatchItem, item_id, self.workspace_id, label="Batch item"
        )

    def list_items(self, batch: AccountCreationBatch) -> Sequence[AccountCreationBatchItem]:
        return (
            self.session.execute(
                sa.select(AccountCreationBatchItem)
                .where(AccountCreationBatchItem.batch_id == batch.id)
                .order_by(AccountCreationBatchItem.created_at)
            )
            .scalars()
            .all()
        )

    def _current_hash(self, batch: AccountCreationBatch) -> str:
        return compute_preview_hash(_item_preview_fields(item) for item in self.list_items(batch))

    # ------------------------------------------------------------- draft → preview → confirm
    def create_draft(
        self,
        *,
        meta_connection_id: uuid.UUID,
        business_manager_external_id: str,
        items: Sequence[DraftAccountItem],
    ) -> AccountCreationBatch:
        if not items:
            raise ValidationError("A batch needs at least one ad account.", details={"field": "items"})
        connection = get_or_404(
            self.session, MetaConnection, meta_connection_id, self.workspace_id, label="Meta connection"
        )
        capabilities = connection.capabilities_json or {}
        if capabilities.get("create_ad_account") is False:
            raise ConflictError(
                "This connection's last capability check reports create_ad_account is not "
                "allowed. Re-check capability before drafting a batch.",
                details={"reason": capabilities.get("reason")},
            )

        batch = AccountCreationBatch(
            workspace_id=self.workspace_id,
            meta_connection_id=connection.id,
            business_manager_external_id=business_manager_external_id,
            preview_hash="",
            created_by=self.actor_id,
        )
        self.session.add(batch)
        self.session.flush()

        for draft_item in items:
            self.session.add(
                AccountCreationBatchItem(
                    workspace_id=self.workspace_id,
                    batch_id=batch.id,
                    name=draft_item.name,
                    currency=draft_item.currency,
                    country=draft_item.country,
                    timezone=draft_item.timezone,
                    timezone_id=draft_item.timezone_id,
                    idempotency_key=f"create:{uuid.uuid4()}",
                    status=MetaBatchItemStatus.QUEUED,
                )
            )
        self.session.flush()
        batch.preview_hash = self._current_hash(batch)
        self.session.flush()
        self.audit.record(
            action="meta_account_creation_batch.drafted",
            entity_type="meta_account_creation_batch",
            entity_id=batch.id,
            after=snapshot(batch),
            metadata={"item_count": len(items)},
        )
        return batch

    def preview(self, batch: AccountCreationBatch) -> dict:
        return {"batch": batch, "items": self.list_items(batch), "preview_hash": self._current_hash(batch)}

    def confirm(self, batch: AccountCreationBatch, *, preview_hash: str) -> AccountCreationBatch:
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
            action="meta_account_creation_batch.confirmed",
            entity_type="meta_account_creation_batch",
            entity_id=batch.id,
            after={"confirmed_at": batch.confirmed_at.isoformat()},
        )
        return batch

    # -------------------------------------------------------------------------------- run
    def _reclaim_expired_leases(self, items: Sequence[AccountCreationBatchItem]) -> None:
        for item in items:
            if item.status == MetaBatchItemStatus.RUNNING and is_lease_expired(item.last_attempted_at):
                item.status = MetaBatchItemStatus.QUEUED
                item.retry_count += 1
                if item.retry_count > MAX_RETRIES:
                    item.status = MetaBatchItemStatus.FAILED
                    item.failure_code = "queue_lease_exceeded_retries"
                    item.failure_summary = "The worker processing this item never reported back, repeatedly."
        self.session.flush()

    def run(self, batch: AccountCreationBatch, provider: MetaBusinessProvider) -> AccountCreationBatch:
        if batch.confirmed_at is None:
            raise ConflictError("Confirm this batch before running it.")

        all_items = self.list_items(batch)
        self._reclaim_expired_leases(all_items)
        registry = AdAccountRegistryService(self.session, self.workspace_id, self.audit)
        health = AccountHealthEvaluationService(self.session, self.workspace_id, self.audit, self.actor_id)

        queued = [i for i in all_items if i.status == MetaBatchItemStatus.QUEUED]
        # Checked before the first item, so an oversized live batch is refused whole rather than
        # part-executed — a created ad account cannot be un-created.
        assert_within_pilot_cap(provider, len(queued))

        for item in queued:
            item.status = MetaBatchItemStatus.RUNNING
            item.last_attempted_at = datetime.now(UTC)
            self.session.flush()

            request = CreateAccountRequest(
                business_manager_external_id=batch.business_manager_external_id,
                name=item.name,
                currency=item.currency,
                country=item.country,
                timezone=item.timezone,
                timezone_id=item.timezone_id,
                idempotency_key=item.idempotency_key,
            )
            try:
                result = provider.create_ad_account(request)
            except MetaWriteNotEnabled:
                # A refusal is not an ambiguity. Nothing left this process, so `unknown` — the
                # state that means "this may have succeeded server-side, go check Meta" — would
                # send an operator hunting for an account that was never requested. The blanket
                # handler below used to swallow this, defeating the very reason
                # `MetaWriteNotEnabled` is an exception rather than a failed result.
                result = CreateAccountResult(
                    status="failed",
                    failure_code=MetaFailureCode.NOT_SUPPORTED,
                    failure_summary="Writes are not enabled for this connection.",
                )
            except Exception as exc:  # noqa: BLE001 - an unexpected provider crash is ambiguous, not a failure
                result = CreateAccountResult(
                    status="unknown", failure_code=MetaFailureCode.UNKNOWN_ERROR, failure_summary=str(exc)[:200]
                )
            self._apply_result(item, result, registry=registry, health=health)

        self.session.flush()
        return batch

    def _apply_result(
        self,
        item: AccountCreationBatchItem,
        result: CreateAccountResult,
        *,
        registry: AdAccountRegistryService,
        health: AccountHealthEvaluationService,
    ) -> None:
        before = snapshot(item)
        if result.status == "succeeded":
            item.status = MetaBatchItemStatus.SUCCEEDED
            item.external_account_id = result.external_account_id
            item.failure_code = None
            item.failure_summary = None
            # Synced through the same create path every account goes through — readiness and
            # health both start at `unknown` for the same reason any freshly-registered account
            # does (A7 guardrail: never fabricated as ready just because creation succeeded).
            account = registry.create(
                {
                    "display_name": item.name,
                    "external_account_id": result.external_account_id,
                    "currency": item.currency,
                    "country": item.country,
                }
            )
            health.evaluate_account_safe(
                account, trigger=EvaluationTrigger.ACCOUNT_MUTATION, trigger_reference_id=str(item.id)
            )
            item.synced_ad_account_id = account.id
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
            action=f"meta_account_creation_item.{item.status.value}",
            entity_type="meta_account_creation_batch_item",
            entity_id=item.id,
            before=before,
            after=snapshot(item),
        )

    # ------------------------------------------------------------------------- reconciliation
    def reconcile(self, item: AccountCreationBatchItem, provider: MetaBusinessProvider) -> AccountCreationBatchItem:
        if item.status != MetaBatchItemStatus.UNKNOWN:
            raise ConflictError(f"Only an unknown-status item can be reconciled; this one is {item.status.value}.")
        registry = AdAccountRegistryService(self.session, self.workspace_id, self.audit)
        health = AccountHealthEvaluationService(self.session, self.workspace_id, self.audit, self.actor_id)
        result = provider.reconcile_create(item.idempotency_key)
        if result is None:
            item.last_attempted_at = datetime.now(UTC)
            self.session.flush()
            self.audit.record(
                action="meta_account_creation_item.reconciliation_inconclusive",
                entity_type="meta_account_creation_batch_item",
                entity_id=item.id,
                after={"idempotency_key": item.idempotency_key},
            )
            return item
        self._apply_result(item, result, registry=registry, health=health)
        return item
