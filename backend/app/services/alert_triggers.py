"""The single hook from A2 health evaluation into A3 alert derivation.

Guarded by its own nested SAVEPOINT. A2 already runs inside one so a health failure cannot roll
back the operator's change; A3 nests a second one so an *alert* failure cannot roll back the
health evaluation either. A bug in alert derivation degrades alerting and nothing else.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.core.enums import DeliveryReason
from app.models.entities import AdAccount
from app.services.alert_service import AlertDerivationService
from app.services.audit import AuditLogService
from app.services.notification_service import NotificationPlannerService

logger = logging.getLogger(__name__)


def derive_alerts_safe(
    session: Session,
    workspace_id: uuid.UUID,
    audit: AuditLogService,
    account: AdAccount,
    *,
    health_status: str,
    actor_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Reconcile alerts for one account and plan any deliveries the policy allows.

    Never raises. Returns a summary for the evaluation run so a failure is visible rather than
    silent.
    """
    try:
        with session.begin_nested():
            derivation = AlertDerivationService(session, workspace_id, audit, actor_id)
            result, to_plan = derivation.derive_for_account(account, health_status=health_status)
            planned = 0
            if to_plan:
                policy = derivation.policies.get_or_create()
                planner = NotificationPlannerService(session, workspace_id, audit)
                for alert, reason in to_plan:
                    outcome = planner.plan(
                        alert, policy, account, reason=DeliveryReason(reason)
                    )
                    planned += 1 if outcome.created else 0
            summary = result.to_dict()
            summary["notifications_planned"] = planned
            return summary
    except Exception as exc:  # noqa: BLE001 - alerting must never break health evaluation
        logger.exception(
            "alert_derivation_failed",
            extra={"ad_account_id": str(account.id), "error_type": type(exc).__name__},
        )
        return {"alert_derivation_error": type(exc).__name__}
