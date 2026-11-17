"""One place that A1 routers call after a mutation to keep health in step.

Health evaluation is a consequence of an A1 change, never a precondition of it: this always
uses the savepoint-isolated `evaluate_account_safe`, so a broken rule can never stop an
operator from recording what they observed.
"""
from __future__ import annotations

from app.core.enums import EvaluationTrigger
from app.models.entities import AdAccount
from app.models.health import HealthEvaluationRun
from app.services.health_service import AccountHealthEvaluationService


def trigger_health(
    ctx, account: AdAccount, trigger: EvaluationTrigger, *, reference_id: str | None = None
) -> HealthEvaluationRun:
    service = AccountHealthEvaluationService(
        ctx.session, ctx.workspace_id, ctx.audit, ctx.actor_id
    )
    return service.evaluate_account_safe(
        account, trigger=trigger, trigger_reference_id=reference_id
    )
