from __future__ import annotations

from datetime import UTC, datetime

import sqlalchemy as sa
from fastapi import APIRouter

from app.api.deps import Ctx
from app.core.config import get_settings
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

    return SystemStatusOut(
        application=settings.app_name,
        version=settings.app_version,
        environment=settings.environment,
        api_status="healthy",
        database_status=database_status,
        database_migration_revision=revision,
        worker_status="not_configured",
        redis_status="not_configured",
        last_readiness_recalculation_at=last_recalculation,
        account_count=int(account_count),
        server_time=datetime.now(UTC),
    )
