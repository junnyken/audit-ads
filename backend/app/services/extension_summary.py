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

from app.core.enums import AlertSeverity, AlertStatus
from app.models.alerts import Alert
from app.models.entities import AdAccount, BusinessManager
from app.services.audit import AuditLogService
from app.services.health_presenter import present_snapshot
from app.services.health_service import AccountHealthSnapshotService
from app.services.rollup import ReadinessRollupService

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
