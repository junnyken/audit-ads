"""One bounded read that answers "what should I know about this account right now?" (A5).

It composes the A1 readiness rollup, the A2 health snapshot presenter and the A3 alert counts.
It computes none of them: A5 is a viewport onto existing state, and a second engine that could
disagree with the dashboard would be worse than no extension at all.

Readiness, health and alerts stay three separate values in the response, as they are everywhere
else in this product.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import AlertSeverity, AlertStatus, HealthCategory, SignalStatus
from app.models.alerts import Alert
from app.models.entities import AdAccount, BusinessManager
from app.models.health import AccountHealthSignal
from app.services.audit import AuditLogService
from app.services.health_presenter import present_snapshot
from app.services.health_service import AccountHealthSnapshotService
from app.services.platform_status import status_class
from app.services.rollup import ReadinessRollupService
from app.services.spend_engine import SpendFacts
from app.services.spend_service import build_spend_facts

#: Enough to act on, few enough to read on a popup. The rest stay one click away in the app.
MAX_REASONS = 3

ACTIVE_ALERT_STATUSES = (AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED, AlertStatus.SUPPRESSED)


class ExtensionSummaryService:
    def __init__(self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit

    def build(self, account: AdAccount) -> dict[str, Any]:
        now = datetime.now(UTC)

        # persist=False: a read from a browser extension must never rewrite stored readiness.
        readiness = ReadinessRollupService(self.session, self.workspace_id, self.audit).evaluate(
            account, persist=False
        )
        snapshot = AccountHealthSnapshotService(self.session, self.workspace_id, self.audit).get(
            account.id
        )
        health = present_snapshot(account, snapshot, now=now)

        business_manager_name = None
        if account.business_manager_id:
            business_manager_name = self.session.execute(
                sa.select(BusinessManager.name).where(
                    BusinessManager.id == account.business_manager_id,
                    BusinessManager.workspace_id == self.workspace_id,
                )
            ).scalar()

        counts = self._alert_counts(account.id)
        facts = build_spend_facts(self.session, self.workspace_id, account, now=now)

        return {
            "account": {
                "id": str(account.id),
                "display_name": account.display_name,
                "external_account_id": account.external_account_id,
                "business_manager_name": business_manager_name,
                "owner_label": account.owner_label,
                "status": account.status.value,
                "archived": account.archived_at is not None,
            },
            "readiness": {
                "status": readiness.readiness_status,
                "evaluated_at": readiness.evaluated_at.isoformat(),
                "reasons": [
                    {"code": reason.code, "message": reason.message}
                    for reason in readiness.reasons[:MAX_REASONS]
                ],
                "reason_count": len(readiness.reasons),
            },
            "health": {
                "status": health["health_status"],
                "freshness_status": health["freshness_status"],
                "evaluated_at": health.get("evaluated_at"),
                "top_reasons": [
                    {
                        "severity": reason.get("severity", "unknown"),
                        "message": reason.get("message", ""),
                    }
                    for reason in health.get("summary_reasons", [])[:MAX_REASONS]
                ],
                "counts": health.get("counts", {}),
            },
            "alerts": counts,
            "spend": self._spend_block(account, now, facts),
            # S2: Meta's latest account status from the same stored observations. `None` when no
            # read has carried a status code — never "active" by default.
            "platform_status": self._platform_status_block(facts),
            "dashboard_paths": {
                "account_detail": f"/accounts/{account.id}",
                "account_health": f"/accounts/{account.id}?tab=health",
                "alerts": f"/alerts?ad_account_id={account.id}",
            },
            "disclaimer": (
                "Operational states recorded in this product. They are not a platform decision, "
                "and they do not guarantee that an account cannot be restricted."
            ),
            "generated_at": now.isoformat(),
        }

    def _alert_counts(self, ad_account_id: uuid.UUID) -> dict[str, int]:
        rows = self.session.execute(
            sa.select(Alert.severity, sa.func.count())
            .where(
                Alert.workspace_id == self.workspace_id,
                Alert.ad_account_id == ad_account_id,
                Alert.status.in_(ACTIVE_ALERT_STATUSES),
                Alert.archived_at.is_(None),
            )
            .group_by(Alert.severity)
        ).all()
        by_severity = {severity: int(count) for severity, count in rows}
        return {
            "open_count": sum(by_severity.values()),
            "critical_count": by_severity.get(AlertSeverity.CRITICAL, 0),
            "warning_count": by_severity.get(AlertSeverity.WARNING, 0),
            "info_count": by_severity.get(AlertSeverity.INFO, 0),
        }

    @staticmethod
    def _platform_status_block(facts: SpendFacts) -> dict[str, Any] | None:
        value = facts.platform_status
        if value is None:
            return None
        return {
            "status": value.status.value,
            "status_class": status_class(value.status),
            "account_status_raw": value.account_status_raw,
            "disable_reason": value.disable_reason.value if value.disable_reason else None,
            "disable_reason_raw": value.disable_reason_raw,
            "freshness": value.freshness.value,
            "observed_at": value.observed_at.isoformat(),
            "observation_status": value.observation_status.value,
        }

    def _spend_block(self, account: AdAccount, now: datetime, facts: SpendFacts) -> dict[str, Any]:
        """S1 viewport: stored observations only, never a provider call (`build_spend_facts`).

        A day Meta returned no row for has `spend_raw: None` — never "0". Money stays the raw
        string Meta returned; there is no total and no cross-currency sum.
        """
        complete = None
        if facts.latest_complete_day is not None:
            entry = facts.day(facts.latest_complete_day)
            complete = {
                "date": facts.latest_complete_day.isoformat(),
                "spend_raw": entry.spend_raw if entry is not None and entry.has_row else None,
            }
        partial = None
        if facts.today_partial is not None and facts.today_partial.has_row:
            partial = {
                "date": facts.today_partial.day.isoformat(),
                "spend_raw": facts.today_partial.spend_raw,
                "label": "incomplete_day",
            }
        signal_open = self.session.execute(
            sa.select(sa.func.count())
            .select_from(AccountHealthSignal)
            .where(
                AccountHealthSignal.workspace_id == self.workspace_id,
                AccountHealthSignal.ad_account_id == account.id,
                AccountHealthSignal.category == HealthCategory.SPEND,
                AccountHealthSignal.status.in_((SignalStatus.OPEN, SignalStatus.ACKNOWLEDGED)),
                AccountHealthSignal.archived_at.is_(None),
            )
        ).scalar_one()
        return {
            "freshness": facts.freshness.value,
            "observable": facts.observable,
            "currency": facts.observed_currency,
            "currency_conflict": facts.insights_currency_conflict,
            "observed_at": facts.latest_success.observed_at.isoformat() if facts.latest_success else None,
            "latest_complete_day": complete,
            "today_partial": partial,
            "signal_open": int(signal_open) > 0,
        }
