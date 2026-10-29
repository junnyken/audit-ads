"""ReadinessRollupService — loads the facts, runs the deterministic engine, persists the result.

Recalculation is synchronous and inside the mutation's transaction (A1 §J, first option): the
work is a handful of indexed reads, and the target VPS has no capacity budget for a broker we
do not need. If evaluation raises, the mutation rolls back with it — a stored readiness state
is therefore never newer than the data it was computed from.
"""
from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import AccountStatus, AssetType, ReadinessStatus, ReferenceStatus
from app.models.entities import (
    AccountAssetLink,
    AccountEvent,
    AdAccount,
    AuditLog,
    BusinessManager,
    PersonalAccountBusinessLink,
    PersonalAccountReference,
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

    def inventory_summary(self, *, visible_ids: set[uuid.UUID] | None = None) -> dict[str, Any]:
        now = datetime.now(UTC)
        cutoff_7d = now - timedelta(days=7)

        vias = list(
            self.session.execute(
                sa.select(PersonalAccountReference.id, PersonalAccountReference.status).where(
                    PersonalAccountReference.workspace_id == self.workspace_id,
                    PersonalAccountReference.archived_at.is_(None),
                )
            ).all()
        )
        active_via_ids = {row.id for row in vias}
        via_active = sum(1 for r in vias if r.status == ReferenceStatus.ACTIVE)
        via_restricted = sum(
            1
            for r in vias
            if r.status in (ReferenceStatus.RESTRICTED, ReferenceStatus.INACTIVE)
        )
        via_unknown = sum(1 for r in vias if r.status == ReferenceStatus.UNKNOWN)

        bms = list(
            self.session.execute(
                sa.select(BusinessManager.id, BusinessManager.status).where(
                    BusinessManager.workspace_id == self.workspace_id,
                    BusinessManager.archived_at.is_(None),
                )
            ).all()
        )
        bm_active = sum(1 for r in bms if r.status == ReferenceStatus.ACTIVE)
        bm_restricted = sum(
            1
            for r in bms
            if r.status in (ReferenceStatus.RESTRICTED, ReferenceStatus.INACTIVE)
        )
        bm_unknown = sum(1 for r in bms if r.status == ReferenceStatus.UNKNOWN)

        bms_with_via: set[uuid.UUID] = set()
        if active_via_ids:
            bms_with_via = {
                row[0]
                for row in self.session.execute(
                    sa.select(PersonalAccountBusinessLink.business_manager_id).where(
                        PersonalAccountBusinessLink.workspace_id == self.workspace_id,
                        PersonalAccountBusinessLink.personal_account_reference_id.in_(active_via_ids),
                        PersonalAccountBusinessLink.unlinked_at.is_(None),
                    )
                ).all()
            }

        acc_stmt = sa.select(AdAccount).where(
            AdAccount.workspace_id == self.workspace_id,
            AdAccount.archived_at.is_(None),
        )
        if visible_ids is not None:
            acc_stmt = acc_stmt.where(AdAccount.id.in_(visible_ids))
        accounts = list(self.session.execute(acc_stmt).scalars().all())

        acc_active = 0
        acc_blocked = 0
        acc_unknown = 0
        by_currency: dict[str, int] = {}
        unassigned_via = 0
        unassigned_bm = 0
        created_7d = 0
        blocked_7d = 0

        for acc in accounts:
            if acc.status == AccountStatus.ACTIVE:
                acc_active += 1
            elif acc.status in (AccountStatus.RESTRICTED, AccountStatus.DISABLED, AccountStatus.WARNING):
                acc_blocked += 1
            else:
                acc_unknown += 1

            curr = (acc.currency or "").strip().upper()
            if curr:
                by_currency[curr] = by_currency.get(curr, 0) + 1

            has_direct_via = acc.personal_account_reference_id in active_via_ids
            has_bm_via = bool(acc.business_manager_id and acc.business_manager_id in bms_with_via)
            if not (has_direct_via or has_bm_via):
                unassigned_via += 1
            if acc.business_manager_id is None:
                unassigned_bm += 1

            created_ts = (
                acc.created_at.replace(tzinfo=UTC)
                if acc.created_at and acc.created_at.tzinfo is None
                else acc.created_at
            )
            updated_ts = (
                acc.updated_at.replace(tzinfo=UTC)
                if acc.updated_at and acc.updated_at.tzinfo is None
                else acc.updated_at
            )
            if created_ts and created_ts >= cutoff_7d:
                created_7d += 1
            if (
                acc.status in (AccountStatus.RESTRICTED, AccountStatus.DISABLED)
                and updated_ts
                and updated_ts >= cutoff_7d
            ):
                blocked_7d += 1

        recovered_logs = list(
            self.session.execute(
                sa.select(AuditLog).where(
                    AuditLog.workspace_id == self.workspace_id,
                    AuditLog.entity_type == "ad_account",
                    AuditLog.action.in_(("ad_account.restored", "ad_account.updated")),
                    AuditLog.created_at >= cutoff_7d,
                )
            ).scalars().all()
        )
        recovered_ids: set[str] = set()
        visible_str = {str(i) for i in visible_ids} if visible_ids is not None else None
        for log in recovered_logs:
            if visible_str is not None and log.entity_id not in visible_str:
                continue
            if log.action == "ad_account.restored":
                recovered_ids.add(log.entity_id)
            elif log.action == "ad_account.updated":
                before_status = (log.before_json or {}).get("status")
                after_status = (log.after_json or {}).get("status")
                if before_status in ("restricted", "disabled", "warning") and after_status == "active":
                    recovered_ids.add(log.entity_id)

        return {
            "via_counts": {
                "total": len(vias),
                "active": via_active,
                "restricted": via_restricted,
                "unknown": via_unknown,
            },
            "bm_counts": {
                "total": len(bms),
                "active": bm_active,
                "restricted": bm_restricted,
                "unknown": bm_unknown,
            },
            "ad_account_counts": {
                "total": len(accounts),
                "active": acc_active,
                "blocked": acc_blocked,
                "unknown": acc_unknown,
                "by_currency": dict(sorted(by_currency.items())),
                "unassigned_via_count": unassigned_via,
                "unassigned_bm_count": unassigned_bm,
            },
            "activity_7d": {
                "created_7d": created_7d,
                "blocked_7d": blocked_7d,
                "recovered_7d": len(recovered_ids),
            },
        }

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
