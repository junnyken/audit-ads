from __future__ import annotations

import re
import uuid
from datetime import datetime, time
from typing import Annotated, Any

from pydantic import BaseModel, Field, field_validator

from app.core.enums import (
    AlertSeverity,
    AlertSourceType,
    AlertStatus,
    DeliveryChannel,
    DeliveryFailureCode,
    DeliveryReason,
    DeliverySkipReason,
    DeliveryStatus,
)
from app.schemas.common import ORMModel, StrictPayload

#: Repeated on alert payloads. A3 adds no safety claim of its own and must not let one in.
ALERT_DISCLAIMER = (
    "Alerts are internal operational attention items derived from records in this product. "
    "They describe what the configured checks observed; they are not a platform decision, not a "
    "safety guarantee, and not a prediction of enforcement."
)

#: Telegram accepts a numeric chat id (optionally negative for groups) or an @public_name.
_CHAT_ID = re.compile(r"^(-?\d{3,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$")


class AlertOut(ORMModel):
    id: uuid.UUID
    ad_account_id: uuid.UUID | None
    source_type: AlertSourceType
    source_entity_type: str
    source_entity_id: str | None
    alert_key: str
    category: str
    severity: AlertSeverity
    status: AlertStatus
    title: str
    summary: str
    source_snapshot_json: dict[str, Any]
    first_observed_at: datetime
    last_observed_at: datetime
    last_notified_at: datetime | None
    acknowledged_at: datetime | None
    acknowledged_by: uuid.UUID | None
    acknowledgement_note: str | None
    resolved_at: datetime | None
    resolved_by: uuid.UUID | None
    resolution_reason: str | None
    suppressed_at: datetime | None
    suppression_reason: str | None
    suppression_expires_at: datetime | None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None


class AlertRow(BaseModel):
    """One Alert Center row. Health, readiness and delivery state stay separate values."""

    id: str
    severity: AlertSeverity
    status: AlertStatus
    title: str
    summary: str
    source_type: AlertSourceType
    source_label: str
    category: str
    ad_account_id: str | None
    account_display_name: str | None
    account_reference: str | None
    business_manager_name: str | None
    health_status: str
    readiness_status: str
    first_observed_at: datetime
    last_observed_at: datetime
    last_notified_at: datetime | None
    delivery_status: DeliveryStatus | None
    delivery_skip_reason: DeliverySkipReason | None
    delivery_scheduled_for: datetime | None
    quiet_hours_deferred: bool
    suppressed_until: datetime | None
    archived: bool


class AlertSummaryOut(BaseModel):
    open_critical: int
    open_warning: int
    open_info: int
    acknowledged: int
    suppressed: int
    failed_final_notifications: int
    deferred_by_quiet_hours: int
    total_active: int
    last_successful_notification_at: datetime | None
    telegram_transport_configured: bool
    recipient_configured: bool
    disclaimer: str = ALERT_DISCLAIMER


class AcknowledgeAlertRequest(StrictPayload):
    note: Annotated[str, Field(min_length=1, max_length=2000)]


class ResolveAlertRequest(StrictPayload):
    reason: Annotated[str, Field(min_length=1, max_length=2000)]


class ReopenAlertRequest(StrictPayload):
    reason: Annotated[str, Field(min_length=1, max_length=2000)]


class SuppressAlertRequest(StrictPayload):
    reason: Annotated[str, Field(min_length=1, max_length=2000)]
    #: Required. Indefinite suppression would be a way to hide a critical issue for good.
    expires_at: datetime


class UnsuppressAlertRequest(StrictPayload):
    note: str | None = Field(default=None, max_length=2000)


class NotificationDeliveryOut(ORMModel):
    id: uuid.UUID
    alert_id: uuid.UUID
    channel: DeliveryChannel
    reason: DeliveryReason
    status: DeliveryStatus
    message_template_version: str
    scheduled_for: datetime
    quiet_hours_decision: dict[str, Any] | None
    queued_at: datetime | None
    sending_at: datetime | None
    sent_at: datetime | None
    last_attempt_at: datetime | None
    attempt_count: int
    next_retry_at: datetime | None
    skip_reason: DeliverySkipReason | None
    failure_code: DeliveryFailureCode | None
    failure_summary: str | None
    telegram_message_id: str | None
    created_at: datetime
    #: The rendered message fields. Masked chat reference only — never the raw recipient.
    payload_snapshot_json: dict[str, Any]
    recipient_masked: str | None = None


class DeliveryAttemptOut(ORMModel):
    id: uuid.UUID
    notification_delivery_id: uuid.UUID
    attempt_number: int
    status: DeliveryStatus
    started_at: datetime
    completed_at: datetime | None
    provider_response_code: int | None
    provider_message_id: str | None
    failure_code: DeliveryFailureCode | None
    failure_summary: str | None
    retry_scheduled_for: datetime | None
    request_id: str | None
    created_at: datetime


class AlertPolicyOut(BaseModel):
    """The policy as the owner may see it. The bot token has no representation here at all."""

    id: uuid.UUID
    name: str
    enabled: bool
    timezone: str
    quiet_hours_enabled: bool
    quiet_hours_start: time | None
    quiet_hours_end: time | None
    critical_bypasses_quiet_hours: bool
    warning_telegram_enabled: bool
    attention_telegram_enabled: bool
    reminder_enabled: bool
    reminder_interval_hours: int | None
    max_reminders_per_alert: int | None
    #: Capability booleans, not values.
    telegram_transport_configured: bool
    recipient_configured: bool
    telegram_chat_id_masked: str | None
    updated_at: datetime


class AlertPolicyUpdate(StrictPayload):
    name: str | None = Field(default=None, max_length=120)
    enabled: bool | None = None
    timezone: str | None = Field(default=None, max_length=64)
    quiet_hours_enabled: bool | None = None
    quiet_hours_start: time | None = None
    quiet_hours_end: time | None = None
    critical_bypasses_quiet_hours: bool | None = None
    warning_telegram_enabled: bool | None = None
    attention_telegram_enabled: bool | None = None
    reminder_enabled: bool | None = None
    reminder_interval_hours: int | None = Field(default=None, ge=1, le=168)
    max_reminders_per_alert: int | None = Field(default=None, ge=1, le=20)
    #: A chat reference the owner controls. `StrictPayload` already refuses anything named like
    #: a token; this validator additionally refuses anything that is not a chat reference.
    telegram_chat_id: str | None = Field(default=None, max_length=64)

    @field_validator("telegram_chat_id")
    @classmethod
    def _chat_reference_only(cls, value: str | None) -> str | None:
        if value is None:
            return None
        candidate = value.strip()
        if not candidate:
            return None
        if not _CHAT_ID.match(candidate):
            raise ValueError(
                "telegram_chat_id must be a numeric chat id or an @public_name. "
                "A bot token is never accepted here."
            )
        return candidate


class DispatchRequest(StrictPayload):
    """Owner-only. Takes no recipient and no message body — only how many rows to work."""

    confirm: bool = False
    batch_size: int | None = Field(default=None, ge=1, le=50)


class DispatchResultOut(BaseModel):
    claimed: int
    sent: int
    failed_transient: int
    failed_final: int
    cancelled: int
    transport: str
    due_remaining: int
