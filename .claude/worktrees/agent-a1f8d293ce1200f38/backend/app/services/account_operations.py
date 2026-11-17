"""MINI-SPEC A7 — Account Operations Intelligence.

Pure read-side aggregation over A1 (registry/readiness), A2 (health) and A3 (alerts). No new
table, no new write path: every number here is computed at read time from records those phases
already own. A7 never duplicates SQL against another phase's table blindly — it reads the same
rows those phases already expose (readiness via `ReadinessRollupService`, health via a direct
`AccountHealthSnapshot` batch query, alerts via `Alert` + the existing `ACTIVE_ALERT_STATUSES`).

Spend has no source yet (mini-spec A7 §"Data source"): every spend-shaped field below is
`None`, rendered as "Not available" — never a fabricated zero. A8 is where a real spend source
gets wired in; this module already has the shape ready for it.
"""
from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.enums import ACTIVE_ALERT_STATUSES, ActivityStatus, AlertSeverity
from app.models.alerts import Alert
from app.models.entities import AdAccount, BusinessManager
from app.models.health import AccountHealthSnapshot
from app.services.audit import AuditLogService
from app.services.base import apply_sort, paginate
from app.services.registry import AccountFilters
from app.services.rollup import ReadinessRollupService

SORTABLE = {"updated_at", "created_at", "display_name", "status", "last_activity_at"}


def _activity_status(last_activity_at: datetime | None, *, now: datetime, stale_after_days: int) -> ActivityStatus:
    if last_activity_at is None:
        return ActivityStatus.UNKNOWN
    if last_activity_at >= now - timedelta(days=stale_after_days):
        return ActivityStatus.ACTIVE_RECENTLY
    return ActivityStatus.STALE


@dataclass
class AccountOperationsRow:
    account: AdAccount
    business_manager_name: str | None
    readiness_status: str
    health_status: str
    activity_status: ActivityStatus
    data_freshness: str
    open_alert_count: int
    open_critical_alert_count: int
    #: Always None in v1 — no spend source exists yet (A7 principle: never fabricate a zero).
    spend_today: None = field(default=None)
    spend_last_7_days: None = field(default=None)
    spend_current_month: None = field(default=None)


class AccountOperationsService:
    def __init__(self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit
        self._settings = get_settings()

    # ---------------------------------------------------------------- shared decoration
    def _decorate(self, accounts: Sequence[AdAccount]) -> list[AccountOperationsRow]:
        if not accounts:
            return []
        now = datetime.now(UTC)
        stale_after = self._settings.data_freshness_stale_after_days

        readiness_by_id = ReadinessRollupService(self.session, self.workspace_id, self.audit).evaluate_many(
            list(accounts)
        )

        health_by_id: dict[uuid.UUID, AccountHealthSnapshot] = {
            row.ad_account_id: row
            for row in self.session.execute(
                sa.select(AccountHealthSnapshot).where(
                    AccountHealthSnapshot.workspace_id == self.workspace_id,
                    AccountHealthSnapshot.ad_account_id.in_([a.id for a in accounts]),
                )
            ).scalars()
        }

        alert_counts: dict[uuid.UUID, dict[str, int]] = {}
        for account_id, severity, count in self.session.execute(
            sa.select(Alert.ad_account_id, Alert.severity, sa.func.count())
            .where(
                Alert.workspace_id == self.workspace_id,
                Alert.ad_account_id.in_([a.id for a in accounts]),
                Alert.status.in_(list(ACTIVE_ALERT_STATUSES)),
            )
            .group_by(Alert.ad_account_id, Alert.severity)
        ).all():
            bucket = alert_counts.setdefault(account_id, {"total": 0, "critical": 0})
            bucket["total"] += count
            if severity == AlertSeverity.CRITICAL:
                bucket["critical"] += count

        bm_names: dict[uuid.UUID, str] = {}
        bm_ids = [a.business_manager_id for a in accounts if a.business_manager_id]
        if bm_ids:
            bm_names = dict(
                self.session.execute(
                    sa.select(BusinessManager.id, BusinessManager.name).where(BusinessManager.id.in_(bm_ids))
                ).all()
            )

        rows = []
        for account in accounts:
            readiness = readiness_by_id.get(str(account.id))
            snapshot = health_by_id.get(account.id)
            counts = alert_counts.get(account.id, {"total": 0, "critical": 0})
            rows.append(
                AccountOperationsRow(
                    account=account,
                    business_manager_name=bm_names.get(account.business_manager_id) if account.business_manager_id else None,
                    readiness_status=readiness.readiness_status if readiness else "unknown",
                    health_status=snapshot.health_status.value if snapshot else "unknown",
                    activity_status=_activity_status(
                        account.last_activity_at, now=now, stale_after_days=stale_after
                    ),
                    data_freshness=(readiness.data_freshness or {}).get("status", "unknown")
                    if readiness
                    else "unknown",
                    open_alert_count=counts["total"],
                    open_critical_alert_count=counts["critical"],
                )
            )
        return rows

    # ---------------------------------------------------------------- account operations table
    def account_table(self, filters: AccountFilters) -> tuple[list[AccountOperationsRow], int]:
        stmt = sa.select(AdAccount).where(AdAccount.workspace_id == self.workspace_id)
        stmt = (
            stmt.where(AdAccount.archived_at.is_not(None))
            if filters.archived
            else stmt.where(AdAccount.archived_at.is_(None))
        )
        if filters.search:
            needle = f"%{filters.search.strip()}%"
            stmt = stmt.where(AdAccount.display_name.ilike(needle))
        if filters.status:
            from app.core.enums import AccountStatus

            stmt = stmt.where(AdAccount.status == AccountStatus(filters.status))
        if filters.business_manager_id:
            stmt = stmt.where(AdAccount.business_manager_id == filters.business_manager_id)

        stmt = apply_sort(stmt, AdAccount, filters.sort, filters.sort_direction, SORTABLE)
        accounts, total = paginate(self.session, stmt, page=filters.page, page_size=filters.page_size)
        return self._decorate(accounts), total

    def account_detail(self, account: AdAccount) -> AccountOperationsRow:
        return self._decorate([account])[0]

    # ---------------------------------------------------------------- workspace overview
    def workspace_overview(self) -> dict:
        accounts = list(
            self.session.execute(
                sa.select(AdAccount).where(
                    AdAccount.workspace_id == self.workspace_id, AdAccount.archived_at.is_(None)
                )
            ).scalars()
        )
        archived_count = self.session.execute(
            sa.select(sa.func.count()).where(
                AdAccount.workspace_id == self.workspace_id, AdAccount.archived_at.is_not(None)
            )
        ).scalar_one()
        rows = self._decorate(accounts)

        status_counts: dict[str, int] = {}
        activity_counts: dict[str, int] = {"unknown": 0, "active_recently": 0, "stale": 0}
        currencies: dict[str, int] = {}
        critical_alert_accounts = 0
        for row in rows:
            status_counts[row.account.status.value] = status_counts.get(row.account.status.value, 0) + 1
            activity_counts[row.activity_status.value] += 1
            if row.account.currency:
                currencies[row.account.currency] = currencies.get(row.account.currency, 0) + 1
            if row.open_critical_alert_count > 0:
                critical_alert_accounts += 1

        return {
            "total_accounts": len(rows),
            "archived_accounts": int(archived_count),
            "by_status": status_counts,
            "by_activity": activity_counts,
            "accounts_with_open_critical_alerts": critical_alert_accounts,
            "currencies_in_use": sorted(currencies.keys()),
            "spend_total_by_currency": None,  # A7 v1: no spend source. Never fabricated as 0.
        }

    # ---------------------------------------------------------------- BM operations
    def business_manager_operations(self) -> list[dict]:
        bms = list(
            self.session.execute(
                sa.select(BusinessManager).where(
                    BusinessManager.workspace_id == self.workspace_id, BusinessManager.archived_at.is_(None)
                )
            ).scalars()
        )
        if not bms:
            return []

        accounts = list(
            self.session.execute(
                sa.select(AdAccount).where(
                    AdAccount.workspace_id == self.workspace_id,
                    AdAccount.archived_at.is_(None),
                    AdAccount.business_manager_id.in_([bm.id for bm in bms]),
                )
            ).scalars()
        )
        rows_by_account = {row.account.id: row for row in self._decorate(accounts)}

        result = []
        for bm in bms:
            bm_rows = [rows_by_account[a.id] for a in accounts if a.business_manager_id == bm.id]
            status_counts: dict[str, int] = {}
            activity_counts: dict[str, int] = {"unknown": 0, "active_recently": 0, "stale": 0}
            open_critical = 0
            open_warning = 0
            last_update: datetime | None = None
            for row in bm_rows:
                status_counts[row.account.status.value] = status_counts.get(row.account.status.value, 0) + 1
                activity_counts[row.activity_status.value] += 1
                open_critical += row.open_critical_alert_count
                open_warning += max(row.open_alert_count - row.open_critical_alert_count, 0)
                candidate = row.account.updated_at
                if last_update is None or candidate > last_update:
                    last_update = candidate

            result.append(
                {
                    "business_manager_id": bm.id,
                    "business_manager_name": bm.name,
                    "account_count": len(bm_rows),
                    "by_status": status_counts,
                    "by_activity": activity_counts,
                    "open_critical_alerts": open_critical,
                    "open_warning_alerts": open_warning,
                    "last_data_update": last_update,
                    "spend_today": None,
                    "spend_last_7_days": None,
                    "spend_current_month": None,
                }
            )
        return result
