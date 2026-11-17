from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, Query

from app.api.deps import AuditCtx, Ctx, WriteCtx
from app.core.config import get_settings
from app.core.enums import (
    ACTIVE_ALERT_STATUSES,
    AlertSeverity,
    AlertStatus,
    DeliveryStatus,
    WorkspaceRole,
)
from app.core.errors import AuthorizationError, NotFoundError, ValidationError
from app.models.alerts import Alert, NotificationDelivery, NotificationDeliveryAttempt
from app.models.entities import AdAccount, AuditLog, BusinessManager, User
from app.models.health import AccountHealthSnapshot
from app.schemas import alerts as s
from app.schemas.audit import AuditLogOut
from app.schemas.common import page_response
from app.services.alert_service import AlertLifecycleService, AlertPolicyService, source_label
from app.services.base import get_or_404
from app.services.notification_service import NotificationDispatcherService

router = APIRouter(tags=["alerts"])

SORTABLE = {"severity", "last_observed_at", "first_observed_at", "status", "title"}

_SEVERITY_ORDER = sa.case(
    (Alert.severity == AlertSeverity.CRITICAL, 0),
    (Alert.severity == AlertSeverity.WARNING, 1),
    else_=2,
)


def mask_chat_reference(value: str | None) -> str | None:
    """Show enough to recognise the destination, never enough to reuse it."""
    if not value:
        return None
    text = str(value)
    if text.startswith("@"):
        return f"@…{text[-4:]}" if len(text) > 5 else "@…"
    return f"…{text[-4:]}" if len(text) > 4 else "…"


def _latest_delivery_subquery():
    """The most recent delivery per alert, for the list's delivery-state column."""
    ranked = sa.select(
        NotificationDelivery.alert_id.label("alert_id"),
        NotificationDelivery.status.label("status"),
        NotificationDelivery.skip_reason.label("skip_reason"),
        NotificationDelivery.scheduled_for.label("scheduled_for"),
        NotificationDelivery.quiet_hours_decision.label("quiet_hours_decision"),
        sa.func.row_number()
        .over(
            partition_by=NotificationDelivery.alert_id,
            order_by=(NotificationDelivery.created_at.desc(), NotificationDelivery.id.desc()),
        )
        .label("rank"),
    ).subquery()
    return sa.select(ranked).where(ranked.c.rank == 1).subquery()


# ------------------------------------------------------------------------------ summary
@router.get("/alerts/summary", response_model=s.AlertSummaryOut)
def alert_summary(ctx: Ctx) -> s.AlertSummaryOut:
    settings = get_settings()
    rows = ctx.session.execute(
        sa.select(Alert.status, Alert.severity, sa.func.count())
        .where(Alert.workspace_id == ctx.workspace_id, Alert.archived_at.is_(None))
        .group_by(Alert.status, Alert.severity)
    ).all()

    open_by_severity = {severity: 0 for severity in AlertSeverity}
    acknowledged = suppressed = total_active = 0
    for status, severity, count in rows:
        if status not in ACTIVE_ALERT_STATUSES:
            continue
        total_active += count
        if status == AlertStatus.OPEN:
            open_by_severity[severity] += count
        elif status == AlertStatus.ACKNOWLEDGED:
            acknowledged += count
        elif status == AlertStatus.SUPPRESSED:
            suppressed += count

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
    deferred = int(
        ctx.session.execute(
            sa.select(sa.func.count())
            .select_from(NotificationDelivery)
            .where(
                NotificationDelivery.workspace_id == ctx.workspace_id,
                NotificationDelivery.status == DeliveryStatus.PENDING,
                NotificationDelivery.scheduled_for > sa.func.now(),
            )
        ).scalar_one()
    )
    last_sent = ctx.session.execute(
        sa.select(sa.func.max(NotificationDelivery.sent_at)).where(
            NotificationDelivery.workspace_id == ctx.workspace_id
        )
    ).scalar()
    policy = AlertPolicyService(ctx.session, ctx.workspace_id, ctx.audit).get()

    return s.AlertSummaryOut(
        open_critical=open_by_severity[AlertSeverity.CRITICAL],
        open_warning=open_by_severity[AlertSeverity.WARNING],
        open_info=open_by_severity[AlertSeverity.INFO],
        acknowledged=acknowledged,
        suppressed=suppressed,
        failed_final_notifications=failed_final,
        deferred_by_quiet_hours=deferred,
        total_active=total_active,
        last_successful_notification_at=last_sent,
        telegram_transport_configured=settings.telegram_transport_configured,
        recipient_configured=bool(policy and policy.telegram_chat_id),
    )


# --------------------------------------------------------------------------------- list
@router.get("/alerts")
def list_alerts(
    ctx: Ctx,
    search: str | None = None,
    status: str | None = None,
    severity: str | None = None,
    source_type: str | None = None,
    health_status: str | None = None,
    readiness_status: str | None = None,
    business_manager_id: uuid.UUID | None = None,
    ad_account_id: uuid.UUID | None = None,
    delivery_status: str | None = None,
    has_pending_delivery: bool | None = None,
    suppressed: bool | None = None,
    archived: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    sort: str = "severity",
    sort_direction: str = Query("desc", pattern="^(asc|desc)$"),
) -> dict[str, Any]:
    latest = _latest_delivery_subquery()
    stmt = (
        sa.select(Alert, AdAccount, AccountHealthSnapshot, latest)
        .outerjoin(AdAccount, AdAccount.id == Alert.ad_account_id)
        .outerjoin(AccountHealthSnapshot, AccountHealthSnapshot.ad_account_id == Alert.ad_account_id)
        .outerjoin(latest, latest.c.alert_id == Alert.id)
        .where(Alert.workspace_id == ctx.workspace_id)
    )
    visible = ctx.visible_ad_account_ids()
    if visible is not None:
        # A9 scope. An alert with no ad-account link cannot be proven to be inside a member's
        # scope, so it is not shown to one — `NULL IN (...)` excludes it, which is the answer
        # the spec asks for ("if safe scoping cannot be proven, deny non-owner by default").
        stmt = stmt.where(Alert.ad_account_id.in_(visible))
    stmt = (
        stmt.where(Alert.archived_at.is_not(None))
        if archived
        else stmt.where(Alert.archived_at.is_(None))
    )
    if status:
        stmt = stmt.where(Alert.status == AlertStatus(status))
    elif suppressed is None:
        stmt = stmt.where(Alert.status.in_(list(ACTIVE_ALERT_STATUSES)))
    if suppressed is not None:
        stmt = (
            stmt.where(Alert.status == AlertStatus.SUPPRESSED)
            if suppressed
            else stmt.where(Alert.status != AlertStatus.SUPPRESSED)
        )
    if severity:
        stmt = stmt.where(Alert.severity == AlertSeverity(severity))
    if source_type:
        stmt = stmt.where(Alert.source_type == source_type)
    if ad_account_id:
        stmt = stmt.where(Alert.ad_account_id == ad_account_id)
    if business_manager_id:
        stmt = stmt.where(AdAccount.business_manager_id == business_manager_id)
    if readiness_status:
        stmt = stmt.where(AdAccount.readiness_status == readiness_status)
    if health_status:
        stmt = stmt.where(AccountHealthSnapshot.health_status == health_status)
    if delivery_status:
        stmt = stmt.where(latest.c.status == DeliveryStatus(delivery_status))
    if has_pending_delivery is not None:
        condition = latest.c.status == DeliveryStatus.PENDING
        stmt = stmt.where(condition if has_pending_delivery else sa.not_(sa.and_(condition)))
    if search:
        needle = f"%{search.strip()}%"
        stmt = stmt.where(
            sa.or_(Alert.title.ilike(needle), Alert.summary.ilike(needle), AdAccount.display_name.ilike(needle))
        )

    column = {
        "severity": _SEVERITY_ORDER,
        "last_observed_at": Alert.last_observed_at,
        "first_observed_at": Alert.first_observed_at,
        "status": Alert.status,
        "title": Alert.title,
    }.get(sort if sort in SORTABLE else "severity")
    # For severity, "desc" means worst first, which is ascending rank.
    if sort == "severity":
        ordering = sa.asc(column) if sort_direction == "desc" else sa.desc(column)
    else:
        ordering = sa.desc(column) if sort_direction == "desc" else sa.asc(column)
    stmt = stmt.order_by(ordering, Alert.last_observed_at.desc(), Alert.id.asc())

    total = int(
        ctx.session.execute(
            sa.select(sa.func.count()).select_from(stmt.order_by(None).subquery())
        ).scalar_one()
    )
    rows = ctx.session.execute(stmt.limit(page_size).offset((page - 1) * page_size)).all()

    bm_names: dict[uuid.UUID, str] = {}
    bm_ids = {row[1].business_manager_id for row in rows if row[1] and row[1].business_manager_id}
    if bm_ids:
        bm_names = {
            bm.id: bm.name
            for bm in ctx.session.execute(
                sa.select(BusinessManager).where(BusinessManager.id.in_(bm_ids))
            ).scalars().all()
        }

    items = []
    for alert, account, snapshot, *delivery in rows:
        delivery_status_value = delivery[1] if len(delivery) > 1 else None
        quiet = delivery[4] if len(delivery) > 4 else None
        items.append(
            {
                "id": str(alert.id),
                "severity": alert.severity.value,
                "status": alert.status.value,
                "title": alert.title,
                "summary": alert.summary,
                "source_type": alert.source_type.value,
                "source_label": source_label(alert),
                "category": alert.category,
                "ad_account_id": str(alert.ad_account_id) if alert.ad_account_id else None,
                "account_display_name": account.display_name if account else None,
                "account_reference": account.external_account_id if account else None,
                "business_manager_name": bm_names.get(account.business_manager_id) if account else None,
                "health_status": snapshot.health_status.value if snapshot else "unknown",
                "readiness_status": account.readiness_status.value if account else "unknown",
                "first_observed_at": alert.first_observed_at,
                "last_observed_at": alert.last_observed_at,
                "last_notified_at": alert.last_notified_at,
                "delivery_status": delivery_status_value.value if delivery_status_value else None,
                "delivery_skip_reason": (
                    delivery[2].value if len(delivery) > 2 and delivery[2] else None
                ),
                "delivery_scheduled_for": delivery[3] if len(delivery) > 3 else None,
                "quiet_hours_deferred": bool(quiet and quiet.get("deferred")),
                "suppressed_until": alert.suppression_expires_at,
                "archived": alert.archived_at is not None,
            }
        )
    return page_response(items, page=page, page_size=page_size, total=total)


# ------------------------------------------------------------------------------- detail
def _get_alert(ctx, alert_id: uuid.UUID) -> Alert:
    alert = get_or_404(ctx.session, Alert, alert_id, ctx.workspace_id, label="Alert")
    visible = ctx.visible_ad_account_ids()
    if visible is not None and (alert.ad_account_id is None or alert.ad_account_id not in visible):
        raise NotFoundError("Alert not found.")
    return alert


def _serialize_delivery(delivery: NotificationDelivery) -> dict[str, Any]:
    data = s.NotificationDeliveryOut.model_validate(delivery).model_dump()
    data["recipient_masked"] = mask_chat_reference(delivery.recipient_reference)
    return data


@router.get("/alerts/{alert_id}")
def alert_detail(ctx: Ctx, alert_id: uuid.UUID) -> dict[str, Any]:
    alert = _get_alert(ctx, alert_id)
    account = (
        ctx.session.get(AdAccount, alert.ad_account_id) if alert.ad_account_id else None
    )
    snapshot = (
        ctx.session.execute(
            sa.select(AccountHealthSnapshot).where(
                AccountHealthSnapshot.ad_account_id == alert.ad_account_id
            )
        ).scalar_one_or_none()
        if alert.ad_account_id
        else None
    )
    deliveries = list(
        ctx.session.execute(
            sa.select(NotificationDelivery)
            .where(NotificationDelivery.alert_id == alert.id)
            .order_by(NotificationDelivery.created_at.desc())
        ).scalars().all()
    )
    policy = AlertPolicyService(ctx.session, ctx.workspace_id, ctx.audit).get()
    return {
        "alert": s.AlertOut.model_validate(alert).model_dump(),
        "source_label": source_label(alert),
        "account": (
            {
                "id": str(account.id),
                "display_name": account.display_name,
                "external_account_id": account.external_account_id,
                "status": account.status.value,
                "readiness_status": account.readiness_status.value,
                "health_status": snapshot.health_status.value if snapshot else "unknown",
            }
            if account
            else None
        ),
        "notifications": [_serialize_delivery(delivery) for delivery in deliveries],
        "policy_decision": {
            "timezone": policy.timezone if policy else None,
            "quiet_hours_enabled": policy.quiet_hours_enabled if policy else None,
            "critical_bypasses_quiet_hours": (
                policy.critical_bypasses_quiet_hours if policy else None
            ),
            "recipient_configured": bool(policy and policy.telegram_chat_id),
            "latest_delivery": _serialize_delivery(deliveries[0]) if deliveries else None,
        },
        "disclaimer": s.ALERT_DISCLAIMER,
    }


# ------------------------------------------------------------------------------ actions
def _act(ctx, alert: Alert, action, **kwargs) -> dict[str, Any]:
    action(alert, **kwargs)
    ctx.commit()
    return {"alert": s.AlertOut.model_validate(alert).model_dump()}


@router.post("/alerts/{alert_id}/acknowledge")
def acknowledge_alert(ctx: WriteCtx, alert_id: uuid.UUID, payload: s.AcknowledgeAlertRequest) -> dict[str, Any]:
    """Records that the operator saw it. The A2 signal and the A1 record behind it do not move."""
    alert = _get_alert(ctx, alert_id)
    service = AlertLifecycleService(ctx.session, ctx.workspace_id, ctx.audit, ctx.actor_id)
    return _act(ctx, alert, service.acknowledge, note=payload.note)


@router.post("/alerts/{alert_id}/resolve")
def resolve_alert(ctx: WriteCtx, alert_id: uuid.UUID, payload: s.ResolveAlertRequest) -> dict[str, Any]:
    alert = _get_alert(ctx, alert_id)
    service = AlertLifecycleService(ctx.session, ctx.workspace_id, ctx.audit, ctx.actor_id)
    return _act(ctx, alert, service.resolve, reason=payload.reason)


@router.post("/alerts/{alert_id}/reopen")
def reopen_alert(ctx: WriteCtx, alert_id: uuid.UUID, payload: s.ReopenAlertRequest) -> dict[str, Any]:
    alert = _get_alert(ctx, alert_id)
    service = AlertLifecycleService(ctx.session, ctx.workspace_id, ctx.audit, ctx.actor_id)
    return _act(ctx, alert, service.reopen, reason=payload.reason)


@router.post("/alerts/{alert_id}/suppress")
def suppress_alert(ctx: WriteCtx, alert_id: uuid.UUID, payload: s.SuppressAlertRequest) -> dict[str, Any]:
    """Mutes delivery for a bounded period. Visibility and history are untouched."""
    alert = _get_alert(ctx, alert_id)
    service = AlertLifecycleService(ctx.session, ctx.workspace_id, ctx.audit, ctx.actor_id)
    return _act(ctx, alert, service.suppress, reason=payload.reason, expires_at=payload.expires_at)


@router.post("/alerts/{alert_id}/unsuppress")
def unsuppress_alert(ctx: WriteCtx, alert_id: uuid.UUID, payload: s.UnsuppressAlertRequest) -> dict[str, Any]:
    alert = _get_alert(ctx, alert_id)
    service = AlertLifecycleService(ctx.session, ctx.workspace_id, ctx.audit, ctx.actor_id)
    return _act(ctx, alert, service.unsuppress, note=payload.note)


@router.get("/alerts/{alert_id}/audit-logs")
def alert_audit_logs(
    ctx: AuditCtx,
    alert_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    alert = _get_alert(ctx, alert_id)
    delivery_ids = [
        str(row)
        for row in ctx.session.execute(
            sa.select(NotificationDelivery.id).where(NotificationDelivery.alert_id == alert.id)
        ).scalars().all()
    ]
    stmt = (
        sa.select(AuditLog, User.email)
        .outerjoin(User, User.id == AuditLog.actor_id)
        .where(
            AuditLog.workspace_id == ctx.workspace_id,
            AuditLog.entity_id.in_([str(alert.id), *delivery_ids]),
        )
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
    )
    total = int(
        ctx.session.execute(
            sa.select(sa.func.count()).select_from(stmt.order_by(None).subquery())
        ).scalar_one()
    )
    rows = ctx.session.execute(stmt.limit(page_size).offset((page - 1) * page_size)).all()
    items = []
    for entry, actor_email in rows:
        data = AuditLogOut.model_validate(entry).model_dump()
        data["actor_email"] = actor_email
        items.append(data)
    return page_response(items, page=page, page_size=page_size, total=total)


@router.get("/alerts/{alert_id}/notifications")
def alert_notifications(ctx: Ctx, alert_id: uuid.UUID) -> list[dict[str, Any]]:
    alert = _get_alert(ctx, alert_id)
    deliveries = ctx.session.execute(
        sa.select(NotificationDelivery)
        .where(NotificationDelivery.alert_id == alert.id)
        .order_by(NotificationDelivery.created_at.desc())
    ).scalars().all()
    return [_serialize_delivery(delivery) for delivery in deliveries]


# ------------------------------------------------------------------------------- policy
def _policy_payload(ctx, policy) -> dict[str, Any]:
    settings = get_settings()
    data = {
        "id": policy.id,
        "name": policy.name,
        "enabled": policy.enabled,
        "timezone": policy.timezone,
        "quiet_hours_enabled": policy.quiet_hours_enabled,
        "quiet_hours_start": policy.quiet_hours_start,
        "quiet_hours_end": policy.quiet_hours_end,
        "critical_bypasses_quiet_hours": policy.critical_bypasses_quiet_hours,
        "warning_telegram_enabled": policy.warning_telegram_enabled,
        "attention_telegram_enabled": policy.attention_telegram_enabled,
        "reminder_enabled": policy.reminder_enabled,
        "reminder_interval_hours": policy.reminder_interval_hours,
        "max_reminders_per_alert": policy.max_reminders_per_alert,
        # Capability booleans only. The bot token has no representation in this response.
        "telegram_transport_configured": settings.telegram_transport_configured,
        "recipient_configured": bool(policy.telegram_chat_id),
        "telegram_chat_id_masked": mask_chat_reference(policy.telegram_chat_id),
        "updated_at": policy.updated_at,
    }
    return s.AlertPolicyOut(**data).model_dump()


def _require_owner(ctx) -> None:
    if ctx.membership.role != WorkspaceRole.OWNER:
        raise AuthorizationError("Only the workspace owner can change notification policy.")


@router.get("/notification-policies/current", response_model=s.AlertPolicyOut)
def get_policy(ctx: Ctx) -> dict[str, Any]:
    policy = AlertPolicyService(ctx.session, ctx.workspace_id, ctx.audit).get_or_create()
    ctx.commit()
    return _policy_payload(ctx, policy)


@router.post("/notification-policies/current", response_model=s.AlertPolicyOut)
def create_policy(ctx: WriteCtx) -> dict[str, Any]:
    _require_owner(ctx)
    policy = AlertPolicyService(ctx.session, ctx.workspace_id, ctx.audit).get_or_create()
    ctx.commit()
    return _policy_payload(ctx, policy)


@router.patch("/notification-policies/current", response_model=s.AlertPolicyOut)
def update_policy(ctx: WriteCtx, payload: s.AlertPolicyUpdate) -> dict[str, Any]:
    _require_owner(ctx)
    service = AlertPolicyService(ctx.session, ctx.workspace_id, ctx.audit)
    policy = service.update(payload.model_dump(exclude_unset=True), actor_id=ctx.actor_id)
    ctx.commit()
    return _policy_payload(ctx, policy)


@router.get("/notification-policies/current/audit-logs")
def policy_audit_logs(
    ctx: AuditCtx, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)
) -> dict[str, Any]:
    stmt = (
        sa.select(AuditLog, User.email)
        .outerjoin(User, User.id == AuditLog.actor_id)
        .where(AuditLog.workspace_id == ctx.workspace_id, AuditLog.entity_type == "alert_policy")
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
    )
    total = int(
        ctx.session.execute(
            sa.select(sa.func.count()).select_from(stmt.order_by(None).subquery())
        ).scalar_one()
    )
    rows = ctx.session.execute(stmt.limit(page_size).offset((page - 1) * page_size)).all()
    items = []
    for entry, actor_email in rows:
        data = AuditLogOut.model_validate(entry).model_dump()
        data["actor_email"] = actor_email
        items.append(data)
    return page_response(items, page=page, page_size=page_size, total=total)


# ------------------------------------------------------------------- notification history
@router.get("/notifications")
def list_notifications(
    ctx: Ctx,
    alert_id: uuid.UUID | None = None,
    status: str | None = None,
    channel: str | None = None,
    scheduled_after: datetime | None = None,
    scheduled_before: datetime | None = None,
    failed_only: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    sort: str = "created_at",
    sort_direction: str = Query("desc", pattern="^(asc|desc)$"),
) -> dict[str, Any]:
    stmt = sa.select(NotificationDelivery).where(
        NotificationDelivery.workspace_id == ctx.workspace_id
    )
    if alert_id:
        stmt = stmt.where(NotificationDelivery.alert_id == alert_id)
    if status:
        stmt = stmt.where(NotificationDelivery.status == DeliveryStatus(status))
    if channel:
        stmt = stmt.where(NotificationDelivery.channel == channel)
    if scheduled_after:
        stmt = stmt.where(NotificationDelivery.scheduled_for >= scheduled_after)
    if scheduled_before:
        stmt = stmt.where(NotificationDelivery.scheduled_for <= scheduled_before)
    if failed_only:
        stmt = stmt.where(
            NotificationDelivery.status.in_(
                [DeliveryStatus.FAILED_TRANSIENT, DeliveryStatus.FAILED_FINAL]
            )
        )
    column = {
        "created_at": NotificationDelivery.created_at,
        "scheduled_for": NotificationDelivery.scheduled_for,
        "sent_at": NotificationDelivery.sent_at,
    }.get(sort, NotificationDelivery.created_at)
    stmt = stmt.order_by(
        sa.desc(column) if sort_direction == "desc" else sa.asc(column), NotificationDelivery.id.asc()
    )
    total = int(
        ctx.session.execute(
            sa.select(sa.func.count()).select_from(stmt.order_by(None).subquery())
        ).scalar_one()
    )
    rows = ctx.session.execute(stmt.limit(page_size).offset((page - 1) * page_size)).scalars().all()
    return page_response(
        [_serialize_delivery(row) for row in rows], page=page, page_size=page_size, total=total
    )


@router.get("/notifications/status/summary")
def notification_status(ctx: Ctx) -> dict[str, Any]:
    """Safe operational counters. No token, no raw chat id, no provider payload."""
    settings = get_settings()
    now = datetime.now(UTC)
    service = NotificationDispatcherService(ctx.session, ctx.workspace_id, ctx.audit)
    oldest = ctx.session.execute(
        sa.select(sa.func.min(NotificationDelivery.scheduled_for)).where(
            NotificationDelivery.workspace_id == ctx.workspace_id,
            NotificationDelivery.status == DeliveryStatus.PENDING,
        )
    ).scalar()
    policy = AlertPolicyService(ctx.session, ctx.workspace_id, ctx.audit).get()
    last_attempt = ctx.session.execute(
        sa.select(sa.func.max(NotificationDeliveryAttempt.started_at)).where(
            NotificationDeliveryAttempt.workspace_id == ctx.workspace_id
        )
    ).scalar()
    if oldest is not None and oldest.tzinfo is None:
        oldest = oldest.replace(tzinfo=UTC)
    return {
        "telegram_transport_configured": settings.telegram_transport_configured,
        "recipient_configured": bool(policy and policy.telegram_chat_id),
        "transport_mode": settings.notification_transport,
        "due_deliveries": service.due_count(now),
        "failed_final_deliveries": int(
            ctx.session.execute(
                sa.select(sa.func.count())
                .select_from(NotificationDelivery)
                .where(
                    NotificationDelivery.workspace_id == ctx.workspace_id,
                    NotificationDelivery.status == DeliveryStatus.FAILED_FINAL,
                )
            ).scalar_one()
        ),
        "oldest_pending_delivery_age_seconds": (
            int((now - oldest).total_seconds()) if oldest and oldest <= now else 0
        ),
        "last_successful_notification_at": ctx.session.execute(
            sa.select(sa.func.max(NotificationDelivery.sent_at)).where(
                NotificationDelivery.workspace_id == ctx.workspace_id
            )
        ).scalar(),
        "last_delivery_attempt_at": last_attempt,
    }


@router.get("/notifications/{notification_id}")
def notification_detail(ctx: Ctx, notification_id: uuid.UUID) -> dict[str, Any]:
    delivery = get_or_404(
        ctx.session, NotificationDelivery, notification_id, ctx.workspace_id, label="Notification"
    )
    return _serialize_delivery(delivery)


@router.get("/notifications/{notification_id}/attempts", response_model=list[s.DeliveryAttemptOut])
def notification_attempts(ctx: Ctx, notification_id: uuid.UUID) -> list[NotificationDeliveryAttempt]:
    delivery = get_or_404(
        ctx.session, NotificationDelivery, notification_id, ctx.workspace_id, label="Notification"
    )
    return list(
        ctx.session.execute(
            sa.select(NotificationDeliveryAttempt)
            .where(NotificationDeliveryAttempt.notification_delivery_id == delivery.id)
            .order_by(NotificationDeliveryAttempt.attempt_number.asc())
        ).scalars().all()
    )


# --------------------------------------------------------------------- operational admin
@router.post("/notifications/dispatch-due", response_model=s.DispatchResultOut)
def dispatch_due(ctx: WriteCtx, payload: s.DispatchRequest) -> dict[str, Any]:
    """Owner-only. Works the outbox; it takes no recipient and no message body from the caller.

    This exists because A3 ships no scheduler. It respects every policy, dedupe and quiet-hours
    decision already recorded on the delivery rows — it cannot force a message out.
    """
    _require_owner(ctx)
    if not payload.confirm:
        raise ValidationError("Dispatch must be confirmed explicitly.", details={"field": "confirm"})
    service = NotificationDispatcherService(ctx.session, ctx.workspace_id, ctx.audit)
    result = service.dispatch_due(batch_size=payload.batch_size)
    remaining = service.due_count()
    ctx.audit.record(
        action="notification.dispatch_run",
        entity_type="notification_delivery",
        entity_id=ctx.workspace_id,
        after=result.to_dict(),
        metadata={"transport": service.transport.name},
    )
    ctx.commit()
    return {**result.to_dict(), "transport": service.transport.name, "due_remaining": remaining}


@router.post("/notifications/recovery-sweep")
def recovery_sweep(ctx: WriteCtx) -> dict[str, Any]:
    """Reclaims deliveries whose dispatcher died mid-send. Sends nothing itself."""
    _require_owner(ctx)
    service = NotificationDispatcherService(ctx.session, ctx.workspace_id, ctx.audit)
    result = service.recovery_sweep()
    ctx.commit()
    return result
