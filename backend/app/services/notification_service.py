"""Notification planning, outbox dispatch and delivery attempts (MINI-SPEC A3 §C, §E).

The outbox pattern, and the reason for it: a delivery row is written in the same transaction as
the alert that caused it, so the decision to notify is as durable as the fact behind it. Sending
happens later, separately, and can fail, retry or be restarted without ever putting the source
transaction at risk.

Nothing about a pending send lives in memory. Recovery after a crash is a query.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.context import get_request_id
from app.core.enums import (
    ACTIVE_ALERT_STATUSES,
    TRANSIENT_FAILURE_CODES,
    AlertSeverity,
    AlertStatus,
    DeliveryChannel,
    DeliveryFailureCode,
    DeliveryReason,
    DeliverySkipReason,
    DeliveryStatus,
)
from app.core.redaction import redact
from app.models.alerts import Alert, AlertPolicy, NotificationDelivery, NotificationDeliveryAttempt
from app.models.entities import AdAccount
from app.services import quiet_hours
from app.services.audit import AuditLogService
from app.services.base import snapshot as orm_snapshot
from app.services.notification_templates import (
    TEMPLATE_VERSION,
    MessageInputs,
    build_dashboard_link,
    render,
)
from app.services.notification_transport import NotificationTransport, OutboundMessage
from app.services.telegram_transport import build_transport

logger = logging.getLogger(__name__)


def idempotency_key(alert: Alert, reason: DeliveryReason, recipient: str | None, sequence: int = 0) -> str:
    """Alert + reason + severity + recipient, so re-planning the same decision is a no-op.

    `sequence` exists only for reminders, which are the one delivery kind that may legitimately
    repeat for an unchanged alert.
    """
    parts = [str(alert.id), reason.value, alert.severity.value, recipient or "none"]
    if sequence:
        parts.append(str(sequence))
    return ":".join(parts)


@dataclass
class PlanOutcome:
    delivery: NotificationDelivery | None
    created: bool
    reason: str


class NotificationPlannerService:
    """Turns an eligible alert into exactly one durable delivery decision.

    Every non-send is written down as a `skipped` delivery with a reason rather than silently
    not happening — "no message arrived" should always have a record explaining itself.
    """

    def __init__(
        self,
        session: Session,
        workspace_id: uuid.UUID,
        audit: AuditLogService,
    ) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit
        self.settings = get_settings()

    def _existing(self, key: str) -> NotificationDelivery | None:
        return self.session.execute(
            sa.select(NotificationDelivery).where(
                NotificationDelivery.workspace_id == self.workspace_id,
                NotificationDelivery.idempotency_key == key,
            )
        ).scalar_one_or_none()

    def _severity_enabled(self, policy: AlertPolicy, severity: AlertSeverity) -> bool:
        if severity == AlertSeverity.CRITICAL:
            return True
        if severity == AlertSeverity.WARNING:
            return policy.warning_telegram_enabled
        return policy.attention_telegram_enabled

    def _payload(
        self, alert: Alert, account: AdAccount | None, policy: AlertPolicy
    ) -> tuple[dict, str]:
        snapshot = alert.source_snapshot_json or {}
        inputs = MessageInputs(
            severity=alert.severity.value,
            alert_title=alert.title,
            account_display_name=account.display_name if account else "—",
            account_reference=(account.external_account_id if account else None) or "no external ID",
            health_status=str(snapshot.get("health_status", "unknown")),
            readiness_status=str(snapshot.get("readiness_status", "unknown")),
            observed_at=alert.last_observed_at,
            safe_summary=alert.summary,
            recommended_next_step=str(snapshot.get("recommended_next_step", "")),
            timezone_name=policy.timezone,
            dashboard_link=build_dashboard_link(
                self.settings.public_app_url, str(alert.ad_account_id) if alert.ad_account_id else None
            ),
        )
        return redact(inputs.to_payload()), render(inputs)

    def _create(
        self,
        alert: Alert,
        policy: AlertPolicy,
        account: AdAccount | None,
        *,
        key: str,
        reason: DeliveryReason,
        status: DeliveryStatus,
        scheduled_for: datetime,
        skip_reason: DeliverySkipReason | None = None,
        quiet_decision: dict | None = None,
        recipient: str | None = None,
    ) -> NotificationDelivery:
        payload, _text = self._payload(alert, account, policy)
        delivery = NotificationDelivery(
            workspace_id=self.workspace_id,
            alert_id=alert.id,
            channel=DeliveryChannel.TELEGRAM,
            recipient_reference=recipient,
            reason=reason,
            idempotency_key=key,
            message_template_version=TEMPLATE_VERSION,
            payload_snapshot_json=payload,
            status=status,
            scheduled_for=scheduled_for,
            quiet_hours_decision=quiet_decision,
            skip_reason=skip_reason,
            telegram_chat_id=recipient,
        )
        self.session.add(delivery)
        self.session.flush()
        self.audit.record(
            action="notification.planned" if skip_reason is None else "notification.skipped",
            entity_type="notification_delivery",
            entity_id=delivery.id,
            after=orm_snapshot(delivery),
            metadata={
                "alert_id": str(alert.id),
                "status": status.value,
                "skip_reason": skip_reason.value if skip_reason else None,
            },
        )
        event = "notification_planned"
        if skip_reason == DeliverySkipReason.NO_RECIPIENT_CONFIGURED:
            event = "notification_skipped_no_recipient"
        elif skip_reason is not None:
            event = "notification_skipped"
        elif quiet_decision and quiet_decision.get("deferred"):
            event = "notification_deferred_quiet_hours"
        logger.info(event, extra={"severity": alert.severity.value, "reason": reason.value})
        return delivery

    def plan(
        self,
        alert: Alert,
        policy: AlertPolicy,
        account: AdAccount | None,
        *,
        reason: DeliveryReason = DeliveryReason.INITIAL,
        sequence: int = 0,
        now: datetime | None = None,
    ) -> PlanOutcome:
        now = now or datetime.now(UTC)
        recipient = (policy.telegram_chat_id or "").strip() or None
        key = idempotency_key(alert, reason, recipient, sequence)

        existing = self._existing(key)
        if existing is not None:
            logger.info("notification_deduped", extra={"alert_id": str(alert.id)})
            return PlanOutcome(existing, False, "already_planned")

        def skip(skip_reason: DeliverySkipReason) -> PlanOutcome:
            delivery = self._create(
                alert,
                policy,
                account,
                key=key,
                reason=reason,
                status=DeliveryStatus.SKIPPED,
                scheduled_for=now,
                skip_reason=skip_reason,
                recipient=recipient,
            )
            return PlanOutcome(delivery, True, skip_reason.value)

        if alert.status not in ACTIVE_ALERT_STATUSES:
            return skip(DeliverySkipReason.ALERT_NOT_ACTIVE)
        if alert.status == AlertStatus.SUPPRESSED:
            return skip(DeliverySkipReason.ALERT_SUPPRESSED)
        if not policy.enabled:
            return skip(DeliverySkipReason.POLICY_DISABLED)
        if not self._severity_enabled(policy, alert.severity):
            return skip(DeliverySkipReason.SEVERITY_DELIVERY_DISABLED)
        if reason == DeliveryReason.REMINDER and not policy.reminder_enabled:
            return skip(DeliverySkipReason.REMINDERS_DISABLED)
        if recipient is None:
            # The alert still exists and stays fully usable in the Alert Center; only the
            # outbound message is impossible.
            return skip(DeliverySkipReason.NO_RECIPIENT_CONFIGURED)

        decision = quiet_hours.evaluate(
            now_utc=now,
            timezone_name=policy.timezone,
            quiet_hours_enabled=policy.quiet_hours_enabled,
            start=policy.quiet_hours_start,
            end=policy.quiet_hours_end,
        )
        if decision.reason == "timezone_unresolved":
            # Never guess an hour. Say the configuration is missing.
            return skip(DeliverySkipReason.TIMEZONE_NOT_CONFIGURED)

        scheduled_for = now
        quiet_payload = decision.to_dict()
        quiet_payload["deferred"] = False
        quiet_payload["policy_version"] = "a3-v1"
        if decision.in_quiet_hours:
            bypass = alert.severity == AlertSeverity.CRITICAL and policy.critical_bypasses_quiet_hours
            quiet_payload["critical_bypass"] = bypass
            if not bypass and decision.next_end_utc is not None:
                # Deferred, never discarded: the message is scheduled for the end of the window.
                scheduled_for = decision.next_end_utc
                quiet_payload["deferred"] = True

        delivery = self._create(
            alert,
            policy,
            account,
            key=key,
            reason=reason,
            status=DeliveryStatus.PENDING,
            scheduled_for=scheduled_for,
            quiet_decision=quiet_payload,
            recipient=recipient,
        )
        return PlanOutcome(delivery, True, "planned")


@dataclass
class DispatchResult:
    claimed: int = 0
    sent: int = 0
    failed_transient: int = 0
    failed_final: int = 0
    cancelled: int = 0
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "claimed": self.claimed,
            "sent": self.sent,
            "failed_transient": self.failed_transient,
            "failed_final": self.failed_final,
            "cancelled": self.cancelled,
        }


class NotificationDispatcherService:
    """Claims due deliveries, sends them, and records every attempt.

    Concurrency is one by default and the batch is bounded, because the target VPS has no room
    for anything else and notification volume for 30 accounts does not need more.
    """

    def __init__(
        self,
        session: Session,
        workspace_id: uuid.UUID,
        audit: AuditLogService,
        transport: NotificationTransport | None = None,
    ) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit
        self.settings = get_settings()
        self.transport = transport or build_transport(self.settings)

    # ------------------------------------------------------------------ claim
    def _due_query(self, now: datetime):
        lease_cutoff = now
        return sa.select(NotificationDelivery).where(
            NotificationDelivery.workspace_id == self.workspace_id,
            sa.or_(
                sa.and_(
                    NotificationDelivery.status == DeliveryStatus.PENDING,
                    NotificationDelivery.scheduled_for <= now,
                ),
                sa.and_(
                    NotificationDelivery.status == DeliveryStatus.FAILED_TRANSIENT,
                    NotificationDelivery.next_retry_at.is_not(None),
                    NotificationDelivery.next_retry_at <= now,
                ),
                # Reclaim a row whose dispatcher died mid-send.
                sa.and_(
                    NotificationDelivery.status == DeliveryStatus.SENDING,
                    NotificationDelivery.lease_expires_at.is_not(None),
                    NotificationDelivery.lease_expires_at <= lease_cutoff,
                ),
            ),
        )

    def due_count(self, now: datetime | None = None) -> int:
        now = now or datetime.now(UTC)
        return int(
            self.session.execute(
                sa.select(sa.func.count()).select_from(self._due_query(now).subquery())
            ).scalar_one()
        )

    def _claim(self, batch_size: int, now: datetime) -> list[NotificationDelivery]:
        """`FOR UPDATE SKIP LOCKED` is what makes two dispatchers safe: the second one steps
        over rows the first is already holding instead of duplicating a send."""
        stmt = (
            self._due_query(now)
            .order_by(NotificationDelivery.scheduled_for.asc(), NotificationDelivery.id.asc())
            .limit(batch_size)
            .with_for_update(skip_locked=True)
        )
        deliveries = list(self.session.execute(stmt).scalars().all())
        lease = now + timedelta(seconds=self.settings.notification_lease_seconds)
        for delivery in deliveries:
            delivery.status = DeliveryStatus.SENDING
            delivery.queued_at = delivery.queued_at or now
            delivery.sending_at = now
            delivery.lease_expires_at = lease
        if deliveries:
            self.session.flush()
        return deliveries

    # ----------------------------------------------------------------- attempt
    def _attempt(
        self,
        delivery: NotificationDelivery,
        *,
        status: DeliveryStatus,
        started_at: datetime,
        provider_response_code: int | None = None,
        provider_message_id: str | None = None,
        failure_code: DeliveryFailureCode | None = None,
        failure_summary: str | None = None,
        retry_scheduled_for: datetime | None = None,
    ) -> NotificationDeliveryAttempt:
        attempt = NotificationDeliveryAttempt(
            workspace_id=self.workspace_id,
            notification_delivery_id=delivery.id,
            attempt_number=delivery.attempt_count,
            status=status,
            started_at=started_at,
            completed_at=datetime.now(UTC),
            provider_response_code=provider_response_code,
            provider_message_id=provider_message_id,
            failure_code=failure_code,
            # Truncated and allowlisted upstream; a provider body never reaches this column.
            failure_summary=(failure_summary or "")[:500] or None,
            retry_scheduled_for=retry_scheduled_for,
            request_id=get_request_id(),
            created_at=datetime.now(UTC),
        )
        self.session.add(attempt)
        self.session.flush()
        return attempt

    def _backoff(self, attempt_count: int) -> timedelta:
        schedule = self.settings.retry_backoff_minutes
        index = min(max(attempt_count - 1, 0), len(schedule) - 1)
        return timedelta(minutes=schedule[index])

    def _send_one(self, delivery: NotificationDelivery, now: datetime, result: DispatchResult) -> None:
        alert = self.session.get(Alert, delivery.alert_id)
        if alert is None or alert.status not in ACTIVE_ALERT_STATUSES:
            # The condition went away before the message went out. Sending now would be noise.
            delivery.status = DeliveryStatus.CANCELLED
            delivery.lease_expires_at = None
            delivery.skip_reason = DeliverySkipReason.ALERT_NOT_ACTIVE
            self.session.flush()
            self.audit.record(
                action="notification.cancelled",
                entity_type="notification_delivery",
                entity_id=delivery.id,
                after=orm_snapshot(delivery),
                metadata={"reason": "alert_no_longer_active"},
            )
            result.cancelled += 1
            return

        payload = delivery.payload_snapshot_json or {}
        text = render(
            MessageInputs(
                severity=str(payload.get("severity", alert.severity.value)),
                alert_title=str(payload.get("alert_title", alert.title)),
                account_display_name=str(payload.get("account_display_name", "—")),
                account_reference=str(payload.get("account_reference", "—")),
                health_status=str(payload.get("health_status", "unknown")),
                readiness_status=str(payload.get("readiness_status", "unknown")),
                observed_at=alert.last_observed_at,
                safe_summary=str(payload.get("safe_summary", alert.summary)),
                recommended_next_step=str(payload.get("recommended_next_step", "")),
                timezone_name=payload.get("timezone"),
                dashboard_link=payload.get("dashboard_link"),
            )
        )

        started_at = datetime.now(UTC)
        delivery.attempt_count += 1
        delivery.last_attempt_at = started_at
        self.session.flush()
        logger.info("notification_send_started", extra={"attempt": delivery.attempt_count})

        transport_result = self.transport.send(
            OutboundMessage(chat_id=delivery.recipient_reference or "", text=text)
        )

        if transport_result.ok:
            delivery.status = DeliveryStatus.SENT
            delivery.sent_at = datetime.now(UTC)
            delivery.lease_expires_at = None
            delivery.next_retry_at = None
            delivery.telegram_message_id = transport_result.provider_message_id
            delivery.failure_code = None
            delivery.failure_summary = None
            alert.last_notified_at = delivery.sent_at
            self.session.flush()
            self._attempt(
                delivery,
                status=DeliveryStatus.SENT,
                started_at=started_at,
                provider_response_code=transport_result.provider_response_code,
                provider_message_id=transport_result.provider_message_id,
            )
            self.audit.record(
                action="notification.sent",
                entity_type="notification_delivery",
                entity_id=delivery.id,
                after=orm_snapshot(delivery),
                metadata={"alert_id": str(alert.id), "attempt": delivery.attempt_count},
            )
            logger.info("notification_sent", extra={"attempt": delivery.attempt_count})
            result.sent += 1
            return

        failure_code = transport_result.failure_code or DeliveryFailureCode.UNKNOWN_ERROR
        transient = failure_code in TRANSIENT_FAILURE_CODES
        attempts_left = delivery.attempt_count < self.settings.notification_max_attempts

        if transient and attempts_left:
            retry_at = datetime.now(UTC) + self._backoff(delivery.attempt_count)
            delivery.status = DeliveryStatus.FAILED_TRANSIENT
            delivery.next_retry_at = retry_at
            delivery.lease_expires_at = None
            delivery.failure_code = failure_code
            delivery.failure_summary = (transport_result.failure_summary or "")[:500] or None
            self.session.flush()
            self._attempt(
                delivery,
                status=DeliveryStatus.FAILED_TRANSIENT,
                started_at=started_at,
                provider_response_code=transport_result.provider_response_code,
                failure_code=failure_code,
                failure_summary=transport_result.failure_summary,
                retry_scheduled_for=retry_at,
            )
            logger.info(
                "notification_retry_scheduled",
                extra={"failure_code": failure_code.value, "attempt": delivery.attempt_count},
            )
            result.failed_transient += 1
            return

        delivery.status = DeliveryStatus.FAILED_FINAL
        delivery.next_retry_at = None
        delivery.lease_expires_at = None
        delivery.failure_code = failure_code
        delivery.failure_summary = (transport_result.failure_summary or "")[:500] or None
        self.session.flush()
        self._attempt(
            delivery,
            status=DeliveryStatus.FAILED_FINAL,
            started_at=started_at,
            provider_response_code=transport_result.provider_response_code,
            failure_code=failure_code,
            failure_summary=transport_result.failure_summary,
        )
        self.audit.record(
            action="notification.failed_final",
            entity_type="notification_delivery",
            entity_id=delivery.id,
            after=orm_snapshot(delivery),
            metadata={"failure_code": failure_code.value},
        )
        logger.warning("notification_failed_final", extra={"failure_code": failure_code.value})
        result.failed_final += 1

    def dispatch_due(self, *, batch_size: int | None = None, now: datetime | None = None) -> DispatchResult:
        now = now or datetime.now(UTC)
        limit = min(batch_size or self.settings.notification_dispatch_batch_size, 50)
        logger.info("notification_dispatcher_run_started", extra={"batch_size": limit})
        result = DispatchResult()
        deliveries = self._claim(limit, now)
        result.claimed = len(deliveries)
        for delivery in deliveries:
            try:
                self._send_one(delivery, now, result)
            except Exception as exc:  # noqa: BLE001 - one bad row must not stop the batch
                logger.exception("notification_dispatcher_run_failed")
                result.errors.append(type(exc).__name__)
                delivery.status = DeliveryStatus.FAILED_TRANSIENT
                delivery.next_retry_at = datetime.now(UTC) + self._backoff(delivery.attempt_count)
                delivery.lease_expires_at = None
                delivery.failure_code = DeliveryFailureCode.UNKNOWN_ERROR
                delivery.failure_summary = f"Dispatcher error ({type(exc).__name__})."
                self.session.flush()
        logger.info("notification_dispatcher_run_completed", extra=result.to_dict())
        return result

    def recovery_sweep(self, *, now: datetime | None = None) -> dict:
        """Reclaim leases that outlived their dispatcher and report what is waiting.

        Deliberately does not send: it makes stranded work visible and eligible again, and the
        normal dispatch path does the rest.
        """
        now = now or datetime.now(UTC)
        stranded = list(
            self.session.execute(
                sa.select(NotificationDelivery).where(
                    NotificationDelivery.workspace_id == self.workspace_id,
                    NotificationDelivery.status == DeliveryStatus.SENDING,
                    NotificationDelivery.lease_expires_at.is_not(None),
                    NotificationDelivery.lease_expires_at <= now,
                )
            ).scalars().all()
        )
        for delivery in stranded:
            delivery.status = DeliveryStatus.PENDING
            delivery.lease_expires_at = None
        if stranded:
            self.session.flush()
            self.audit.record(
                action="notification.recovered",
                entity_type="notification_delivery",
                entity_id=stranded[0].id,
                metadata={"recovered": len(stranded)},
            )
        return {"recovered": len(stranded), "due": self.due_count(now)}
