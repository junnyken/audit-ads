"""Operational endpoints (A4).

Every route here is authenticated, and the ones that reveal deployment detail or can cause an
external side effect are owner-only. The public liveness endpoint stays in ``main.py`` and
stays free of infrastructure detail.

Nothing in this module returns a secret, a hostname, a connection string, a path or a raw chat
id. Configuration is reported as findings and booleans; the destination of a test message is
reported masked.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, Query

from app.api.deps import Ctx, WriteCtx
from app.core.config import get_settings
from app.core.enums import (
    DeliveryStatus,
    OperationalRunKind,
    OperationalRunStatus,
    WorkspaceRole,
)
from app.core.errors import AuthorizationError, ValidationError
from app.models.alerts import NotificationDelivery
from app.models.operations import OperationalRun
from app.schemas.operations import (
    ConfigurationReportOut,
    OperationalRunOut,
    OperationsOverviewOut,
    TestSendExecuteRequest,
    TestSendPreviewOut,
    TestSendResultOut,
)
from app.services.alert_service import AlertPolicyService
from app.services.operations import (
    THRESHOLDS,
    OperationalRunService,
    collect_host_metrics,
    evaluate_thresholds,
    staleness,
)
from app.services.telegram_transport import build_transport
from app.services.test_send import TestSendService

router = APIRouter(prefix="/operations", tags=["operations"])


def _require_owner(ctx) -> None:
    if ctx.membership.role != WorkspaceRole.OWNER:
        raise AuthorizationError("Only the workspace owner can view or change operational state.")


def _run_payload(run: OperationalRun | None) -> dict[str, Any] | None:
    if run is None:
        return None
    return {
        "id": str(run.id),
        "kind": run.kind.value,
        "status": run.status.value,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "duration_ms": run.duration_ms,
        "summary": run.summary_json or {},
        "error_code": run.error_code,
        "release_version": run.release_version,
    }


@router.get("/overview", response_model=OperationsOverviewOut)
def operations_overview(ctx: Ctx) -> dict[str, Any]:
    """The operator's single screen: release, database, dispatcher, backup, host.

    Every "unknown"/"never" here is deliberate. A dispatcher that has never run is a different
    problem from one that ran and failed, and collapsing them into a green tick is how an
    outbox quietly stops delivering.
    """
    settings = get_settings()
    runs = OperationalRunService(ctx.session)
    now = datetime.now(UTC)

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

    last_dispatch = runs.latest(OperationalRunKind.DISPATCH)
    last_dispatch_ok = runs.latest_successful(OperationalRunKind.DISPATCH)
    last_backup_ok = runs.latest_successful(OperationalRunKind.BACKUP)
    last_restore_drill = runs.latest(OperationalRunKind.RESTORE_DRILL)
    last_migration = runs.latest(OperationalRunKind.MIGRATION_RELEASE)

    oldest_pending = ctx.session.execute(
        sa.select(sa.func.min(NotificationDelivery.scheduled_for)).where(
            NotificationDelivery.workspace_id == ctx.workspace_id,
            NotificationDelivery.status == DeliveryStatus.PENDING,
            NotificationDelivery.scheduled_for <= now,
        )
    ).scalar()
    if oldest_pending is not None and oldest_pending.tzinfo is None:
        oldest_pending = oldest_pending.replace(tzinfo=UTC)

    due = int(
        ctx.session.execute(
            sa.select(sa.func.count())
            .select_from(NotificationDelivery)
            .where(
                NotificationDelivery.workspace_id == ctx.workspace_id,
                NotificationDelivery.status == DeliveryStatus.PENDING,
                NotificationDelivery.scheduled_for <= now,
            )
        ).scalar_one()
    )
    failed_final = int(
        ctx.session.execute(
            sa.select(sa.func.count())
            .select_from(NotificationDelivery)
            .where(
                NotificationDelivery.workspace_id == ctx.workspace_id,
                NotificationDelivery.status == DeliveryStatus.FAILED_FINAL,
            )
        ).scalar_one()
    )

    metrics = collect_host_metrics()
    dispatcher_state = staleness(
        last_dispatch.started_at if last_dispatch else None,
        limit=timedelta(minutes=settings.dispatcher_stale_after_minutes),
    )

    return {
        "release_version": settings.release_version,
        "application_version": settings.app_version,
        "environment": settings.environment,
        "server_time": now,
        "database_status": database_status,
        "migration_revision": revision,
        "api_status": "healthy",
        "notification_transport": settings.notification_transport,
        "telegram_transport_configured": settings.telegram_transport_configured,
        "test_send_enabled": settings.allow_test_send,
        "dispatcher_state": dispatcher_state,
        "dispatcher_last_run": _run_payload(last_dispatch),
        "dispatcher_last_success_at": last_dispatch_ok.started_at if last_dispatch_ok else None,
        "due_delivery_count": due,
        "failed_final_delivery_count": failed_final,
        "oldest_due_delivery_at": oldest_pending,
        "oldest_due_delivery_minutes": (
            round((now - oldest_pending).total_seconds() / 60, 1) if oldest_pending else None
        ),
        "backup_state": staleness(
            last_backup_ok.started_at if last_backup_ok else None,
            limit=timedelta(hours=settings.backup_stale_after_hours),
        ),
        "backup_last_success_at": last_backup_ok.started_at if last_backup_ok else None,
        "backup_last_run": _run_payload(last_backup_ok),
        "restore_drill_last_run": _run_payload(last_restore_drill),
        "migration_last_run": _run_payload(last_migration),
        "host": metrics.as_dict(),
        "host_bands": evaluate_thresholds(metrics),
        "thresholds": THRESHOLDS,
    }


@router.get("/runs", response_model=list[OperationalRunOut])
def list_runs(
    ctx: Ctx,
    kind: OperationalRunKind | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[dict[str, Any]]:
    """Run history, owner-only: it describes the deployment rather than the workspace."""
    _require_owner(ctx)
    runs = OperationalRunService(ctx.session).recent(limit=limit, kind=kind)
    return [_run_payload(run) for run in runs]


@router.get("/configuration", response_model=ConfigurationReportOut)
def configuration_report(ctx: Ctx) -> dict[str, Any]:
    """Findings, not values. It says a secret is a placeholder; it never shows the secret."""
    _require_owner(ctx)
    from app.core.production_checks import check_settings, is_production

    settings = get_settings()
    findings = check_settings(settings)
    return {
        "environment": settings.environment,
        "production_mode": is_production(settings),
        "release_version": settings.release_version,
        "api_docs_enabled": settings.enable_api_docs,
        "cors_origin_count": len(settings.cors_origins),
        "public_app_url_configured": bool(settings.public_app_url),
        "public_app_url_is_https": settings.public_app_url.strip().startswith("https://"),
        "notification_transport": settings.notification_transport,
        "telegram_transport_configured": settings.telegram_transport_configured,
        "test_send_enabled": settings.allow_test_send,
        "error_count": sum(1 for f in findings if f.severity == "error"),
        "warning_count": sum(1 for f in findings if f.severity == "warning"),
        "findings": [f.as_dict() for f in findings],
    }


# ---- controlled Telegram test send ------------------------------------------------------


@router.post("/test-send/preview", response_model=TestSendPreviewOut)
def test_send_preview(ctx: WriteCtx) -> dict[str, Any]:
    """Render the test message and the pre-send checklist. Sends nothing, ever."""
    _require_owner(ctx)
    settings = get_settings()
    policy = AlertPolicyService(ctx.session, ctx.workspace_id, ctx.audit).get_or_create()
    ctx.commit()
    return TestSendService(ctx.session, settings).build_preview(policy).as_dict()


@router.post("/test-send/execute", response_model=TestSendResultOut)
def test_send_execute(ctx: WriteCtx, payload: TestSendExecuteRequest) -> dict[str, Any]:
    """Send exactly one controlled verification message.

    Four independent gates stand between a caller and an outbound message: workspace owner,
    the server-side ``ADSOPS_ALLOW_TEST_SEND`` switch, an explicit confirmation, and a preview
    token that proves the exact destination and message were seen. The caller supplies no
    recipient and no message body — both come from server-side configuration.
    """
    _require_owner(ctx)
    settings = get_settings()
    if not payload.confirm:
        raise ValidationError("A controlled test send requires an explicit confirmation.")
    if not settings.allow_test_send:
        raise ValidationError(
            "Controlled test send is disabled on this server. Set ADSOPS_ALLOW_TEST_SEND for "
            "one approved verification, then turn it off again."
        )

    policy = AlertPolicyService(ctx.session, ctx.workspace_id, ctx.audit).get_or_create()
    service = TestSendService(ctx.session, settings)
    transport = build_transport(settings)
    sent, detail, preview = service.send(
        policy=policy, transport=transport, approval_code=payload.approval_code
    )
    ctx.audit.record(
        entity_type="operational_run",
        entity_id=None,
        action="operations.test_send" if sent else "operations.test_send_refused",
        after={"result": detail, "recipient_masked": preview.recipient_masked},
    )
    ctx.commit()
    return {
        "sent": sent,
        "detail": detail,
        "message_id": detail if sent else None,
        "preview": preview.as_dict(),
    }


@router.post("/test-send/reset", response_model=OperationalRunOut | None)
def test_send_reset(ctx: WriteCtx) -> dict[str, Any] | None:
    """Record that the verification is finished, so the flow is closed rather than left armed.

    It cannot delete the send history — the run record is the evidence that exactly one
    message went out.
    """
    _require_owner(ctx)
    runs = OperationalRunService(ctx.session)
    last = runs.latest(OperationalRunKind.TEST_SEND)
    ctx.audit.record(
        entity_type="operational_run",
        entity_id=None,
        action="operations.test_send_closed",
        after={"status": last.status.value if last else "never_run"},
    )
    ctx.commit()
    return _run_payload(last)


__all__ = ["router", "OperationalRunStatus"]
