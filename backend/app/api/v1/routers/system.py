from __future__ import annotations

from datetime import UTC, datetime

import sqlalchemy as sa
from fastapi import APIRouter

from app.api.deps import Ctx
from app.core.config import get_settings
from app.core.enums import OperationalRunKind
from app.models.alerts import Alert, NotificationDelivery
from app.models.entities import AdAccount
from app.schemas.audit import SystemStatusOut

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/status", response_model=SystemStatusOut)
def system_status(ctx: Ctx) -> SystemStatusOut:
    """Operational status only.

    Deliberately excludes hostnames, connection strings, environment variables and any
    credential-bearing value (A1 §F). Redis and worker report "not_configured" because A1
    introduces neither — saying "healthy" about something that does not exist would be a lie
    the operator could act on.
    """
    settings = get_settings()

    try:
        ctx.session.execute(sa.text("SELECT 1"))
        database_status = "reachable"
    except Exception:  # pragma: no cover - depends on live infrastructure
        database_status = "unreachable"

    revision = None
    try:
        revision = ctx.session.execute(sa.text("SELECT version_num FROM alembic_version")).scalar()
    except Exception:  # pragma: no cover - table absent before the first migration
        ctx.session.rollback()

    account_count = ctx.session.execute(
        sa.select(sa.func.count())
        .select_from(AdAccount)
        .where(AdAccount.workspace_id == ctx.workspace_id, AdAccount.archived_at.is_(None))
    ).scalar_one()

    last_recalculation = ctx.session.execute(
        sa.select(sa.func.max(AdAccount.readiness_evaluated_at)).where(
            AdAccount.workspace_id == ctx.workspace_id
        )
    ).scalar()

    open_alerts = int(
        ctx.session.execute(
            sa.select(sa.func.count())
            .select_from(Alert)
            .where(
                Alert.workspace_id == ctx.workspace_id,
                Alert.status.in_(["open", "acknowledged", "suppressed"]),
                Alert.archived_at.is_(None),
            )
        ).scalar_one()
    )
    due_deliveries = int(
        ctx.session.execute(
            sa.select(sa.func.count())
            .select_from(NotificationDelivery)
            .where(
                NotificationDelivery.workspace_id == ctx.workspace_id,
                NotificationDelivery.status == "pending",
                NotificationDelivery.scheduled_for <= sa.func.now(),
            )
        ).scalar_one()
    )
    failed_final = int(
        ctx.session.execute(
            sa.select(sa.func.count())
            .select_from(NotificationDelivery)
            .where(
                NotificationDelivery.workspace_id == ctx.workspace_id,
                NotificationDelivery.status == "failed_final",
            )
        ).scalar_one()
    )
    last_notification = ctx.session.execute(
        sa.select(sa.func.max(NotificationDelivery.sent_at)).where(
            NotificationDelivery.workspace_id == ctx.workspace_id
        )
    ).scalar()

    # A4: the dispatcher is a real process now, so reporting a flat "not_configured" would be a
    # lie the operator could act on. Derived from its recorded runs, because this API cannot see
    # the container — and "never_run" stays distinct from "stale".
    from datetime import timedelta

    from app.services.operations import OperationalRunService, staleness

    last_dispatch = OperationalRunService(ctx.session).latest(OperationalRunKind.DISPATCH)
    dispatcher_state = staleness(
        last_dispatch.started_at if last_dispatch else None,
        limit=timedelta(minutes=settings.dispatcher_stale_after_minutes),
    )
    worker_status = {
        "current": "running",
        "stale": "stale",
        "never": "not_configured",
    }[dispatcher_state]

    return SystemStatusOut(
        application=settings.app_name,
        version=settings.app_version,
        release_version=settings.release_version,
        environment=settings.environment,
        api_status="healthy",
        database_status=database_status,
        database_migration_revision=revision,
        worker_status=worker_status,
        redis_status="not_configured",
        last_readiness_recalculation_at=last_recalculation,
        account_count=int(account_count),
        server_time=datetime.now(UTC),
        # A3 counters. Capability booleans and counts only: no token, no chat id, no payload.
        notification_transport=settings.notification_transport,
        telegram_transport_configured=settings.telegram_transport_configured,
        open_alert_count=open_alerts,
        due_delivery_count=due_deliveries,
        failed_final_delivery_count=failed_final,
        last_successful_notification_at=last_notification,
    )
