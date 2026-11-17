"""ReadinessRollupService — loads the facts, runs the deterministic engine, persists the result.

Recalculation is synchronous and inside the mutation's transaction (A1 §J, first option): the
work is a handful of indexed reads, and the target VPS has no capacity budget for a broker we
do not need. If evaluation raises, the mutation rolls back with it — a stored readiness state
is therefore never newer than the data it was computed from.
"""
from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import AssetType, ReadinessStatus
from app.models.entities import (
    AccountAssetLink,
    AccountEvent,
    AdAccount,
    ReadinessChecklistItem,
)
from app.services.audit import AuditLogService
from app.services.checklist import ReadinessChecklistService
from app.services.links import gather_link_facts
from app.services.readiness import AccountLinkFacts, ReadinessResult, evaluate_readiness

logger = logging.getLogger(__name__)


class ReadinessRollupService:
    def __init__(self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit
        self.checklists = ReadinessChecklistService(session, workspace_id, audit)

    def evaluate(self, account: AdAccount, *, persist: bool = True) -> ReadinessResult:
        items = self.checklists.list_items(account.id)
        for item in items:
            self.checklists.recompute_evidence_status(item)

        events = list(
            self.session.execute(
                sa.select(AccountEvent).where(
                    AccountEvent.ad_account_id == account.id,
                    AccountEvent.workspace_id == self.workspace_id,
                    AccountEvent.archived_at.is_(None),
                )
            ).scalars().all()
        )
        facts = gather_link_facts(self.session, account.id)

        try:
            result = evaluate_readiness(account, items, events, facts)
        except Exception:  # pragma: no cover - defensive; surfaces as 500, nothing is persisted
            logger.exception(
                "readiness recalculation failed", extra={"ad_account_id": str(account.id)}
            )
            raise

        if persist:
            previous = account.readiness_status
            account.readiness_status = ReadinessStatus(result.readiness_status)
            account.readiness_evaluated_at = datetime.now(UTC)
            self.session.flush()
            if previous != account.readiness_status:
                self.audit.record(
                    action="ad_account.readiness_changed",
                    entity_type="ad_account",
                    entity_id=account.id,
                    before={"readiness_status": previous.value},
                    after={"readiness_status": account.readiness_status.value},
                    metadata={"reason_codes": [reason.code for reason in result.reasons]},
                )
        return result

    def summary(self) -> dict[str, int]:
        rows = self.session.execute(
            sa.select(AdAccount.readiness_status, AdAccount.archived_at, sa.func.count())
            .where(AdAccount.workspace_id == self.workspace_id)
            .group_by(AdAccount.readiness_status, AdAccount.archived_at)
        ).all()
        counts = {status.value: 0 for status in ReadinessStatus}
        archived = 0
        total_active = 0
        for readiness_status, archived_at, count in rows:
            if archived_at is not None:
                archived += count
                continue
            counts[readiness_status.value] += count
            total_active += count
        counts["archived"] = archived
        counts["total_active"] = total_active
        return counts

    def evaluate_many(self, accounts: list[AdAccount]) -> dict[str, ReadinessResult]:
        """Evaluate a page of accounts with three bulk queries instead of three per account.

        This path is read-only: it never persists, so a list request cannot rewrite stored
        readiness as a side effect of being viewed.
        """
        if not accounts:
            return {}
        ids = [account.id for account in accounts]

        items_by_account: dict[uuid.UUID, list] = {account_id: [] for account_id in ids}
        for item in self.session.execute(
            sa.select(ReadinessChecklistItem).where(
                ReadinessChecklistItem.ad_account_id.in_(ids),
                ReadinessChecklistItem.archived_at.is_(None),
            )
        ).scalars().all():
            items_by_account[item.ad_account_id].append(item)

        events_by_account: dict[uuid.UUID, list] = {account_id: [] for account_id in ids}
        for event in self.session.execute(
            sa.select(AccountEvent).where(
                AccountEvent.ad_account_id.in_(ids), AccountEvent.archived_at.is_(None)
            )
        ).scalars().all():
            events_by_account[event.ad_account_id].append(event)

        links_by_account: dict[uuid.UUID, set] = {account_id: set() for account_id in ids}
        for account_id, asset_type in self.session.execute(
            sa.select(AccountAssetLink.ad_account_id, AccountAssetLink.asset_type).where(
                AccountAssetLink.ad_account_id.in_(ids), AccountAssetLink.unlinked_at.is_(None)
            )
        ).all():
            links_by_account[account_id].add(asset_type)

        results: dict[str, ReadinessResult] = {}
        for account in accounts:
            active = links_by_account.get(account.id, set())
            facts = AccountLinkFacts(
                has_active_page_link=AssetType.PAGE in active,
                has_active_pixel_link=AssetType.PIXEL in active,
                has_active_browser_link=AssetType.BROWSER_PROFILE in active,
                has_active_proxy_link=AssetType.PROXY in active,
                has_active_payment_link=AssetType.PAYMENT_PROFILE in active,
            )
            results[str(account.id)] = evaluate_readiness(
                account,
                items_by_account.get(account.id, []),
                events_by_account.get(account.id, []),
                facts,
            )
        return results
