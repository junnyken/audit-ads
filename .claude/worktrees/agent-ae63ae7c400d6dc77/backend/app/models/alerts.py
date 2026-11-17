"""MINI-SPEC A3 domain model — Alert Center and notification outbox.

Four additive tables. No A1 or A2 table is altered: alerts observe A2 health facts and record
notification workflow, they never take part in health computation.

Two things here deserve a note.

`alerts.active_key` mirrors `alert_key` while the alert is open, acknowledged or suppressed, and
is NULL otherwise, with `unique(workspace_id, active_key)`. This is the same trick A2 uses for
signals: it enforces "at most one active alert per source condition" in the database and stays
portable, where a PostgreSQL partial index would not.

`notification_deliveries` is a transactional outbox. A delivery row is written in the same
transaction as the alert it belongs to, so an alert can never exist without its delivery decision
and a delivery can never reference an alert that was rolled back. Nothing about sending lives in
memory, which is what makes restart recovery a query rather than a hope.
"""
from __future__ import annotations

import uuid
from datetime import datetime, time

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

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
from app.db.base import Archivable, Base, Timestamped, UUIDPrimaryKey
from app.models.entities import _enum


class AlertPolicy(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """Workspace delivery policy. It holds no secret.

    The Telegram bot token is server-side environment configuration and is deliberately absent
    from this table, from every API response and from every audit payload. What lives here is a
    chat *reference* the owner controls, which is worthless without the token.
    """

    __tablename__ = "alert_policies"
    __table_args__ = (sa.UniqueConstraint("workspace_id"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(120), nullable=False, default="Default policy")
    enabled: Mapped[bool] = mapped_column(sa.Boolean(), nullable=False, default=True)
    #: IANA identifier, validated server-side. Quiet hours are meaningless without it.
    timezone: Mapped[str] = mapped_column(sa.String(64), nullable=False, default="Asia/Ho_Chi_Minh")
    quiet_hours_enabled: Mapped[bool] = mapped_column(sa.Boolean(), nullable=False, default=True)
    quiet_hours_start: Mapped[time | None] = mapped_column(sa.Time(), nullable=True)
    quiet_hours_end: Mapped[time | None] = mapped_column(sa.Time(), nullable=True)
    critical_bypasses_quiet_hours: Mapped[bool] = mapped_column(
        sa.Boolean(), nullable=False, default=True
    )
    warning_telegram_enabled: Mapped[bool] = mapped_column(sa.Boolean(), nullable=False, default=True)
    attention_telegram_enabled: Mapped[bool] = mapped_column(
        sa.Boolean(), nullable=False, default=False
    )
    reminder_enabled: Mapped[bool] = mapped_column(sa.Boolean(), nullable=False, default=False)
    reminder_interval_hours: Mapped[int | None] = mapped_column(sa.Integer(), nullable=True)
    max_reminders_per_alert: Mapped[int | None] = mapped_column(sa.Integer(), nullable=True)
    #: A chat reference only. Never a token.
    telegram_chat_id: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)


class Alert(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """An operator-facing attention item derived from an A2 fact."""

    __tablename__ = "alerts"
    __table_args__ = (
        sa.UniqueConstraint("workspace_id", "active_key"),
        sa.Index("ix_alerts_ws_status_severity_observed", "workspace_id", "status", "severity", "last_observed_at"),
        sa.Index("ix_alerts_ws_account_status", "workspace_id", "ad_account_id", "status"),
        sa.Index("ix_alerts_ws_source", "workspace_id", "source_type", "source_entity_id"),
        sa.Index("ix_alerts_ws_alert_key", "workspace_id", "alert_key"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    ad_account_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(), sa.ForeignKey("ad_accounts.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    source_type: Mapped[AlertSourceType] = mapped_column(
        _enum(AlertSourceType, "alert_source_type"), nullable=False
    )
    source_entity_type: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    source_entity_id: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    #: Deterministic identity of the source condition within the workspace.
    alert_key: Mapped[str] = mapped_column(sa.String(400), nullable=False)
    #: Mirrors alert_key while active, NULL otherwise. See the module docstring.
    active_key: Mapped[str | None] = mapped_column(sa.String(400), nullable=True)
    category: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    severity: Mapped[AlertSeverity] = mapped_column(
        _enum(AlertSeverity, "alert_severity"), nullable=False
    )
    status: Mapped[AlertStatus] = mapped_column(
        _enum(AlertStatus, "alert_status"), nullable=False, default=AlertStatus.OPEN
    )
    title: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    summary: Mapped[str] = mapped_column(sa.Text(), nullable=False, default="")
    #: Redacted, bounded, UI-ready. It keeps the A2 rule key/version and the original health
    #: severity so the mapping stays explainable — never raw evidence.
    source_snapshot_json: Mapped[dict] = mapped_column(sa.JSON(), nullable=False, default=dict)
    first_observed_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    last_observed_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    last_notified_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    acknowledged_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)
    acknowledgement_note: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    #: NULL with a resolved status means the source condition ended, not that a person closed it.
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)
    resolution_reason: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)
    suppressed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    suppressed_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)
    suppression_reason: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)
    suppression_expires_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    #: Status the alert returns to when suppression expires.
    status_before_suppression: Mapped[AlertStatus | None] = mapped_column(
        _enum(AlertStatus, "alert_status"), nullable=True
    )

    @property
    def is_active(self) -> bool:
        return self.status in (
            AlertStatus.OPEN,
            AlertStatus.ACKNOWLEDGED,
            AlertStatus.SUPPRESSED,
        )


class NotificationDelivery(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """One outbound message candidate and its lifecycle. The outbox row."""

    __tablename__ = "notification_deliveries"
    __table_args__ = (
        sa.UniqueConstraint("workspace_id", "idempotency_key"),
        sa.Index("ix_nd_ws_status_scheduled", "workspace_id", "status", "scheduled_for"),
        sa.Index("ix_nd_alert_created", "alert_id", "created_at"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    alert_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("alerts.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    channel: Mapped[DeliveryChannel] = mapped_column(
        _enum(DeliveryChannel, "delivery_channel"), nullable=False, default=DeliveryChannel.TELEGRAM
    )
    #: A chat reference. Never a bot token.
    recipient_reference: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    reason: Mapped[DeliveryReason] = mapped_column(
        _enum(DeliveryReason, "delivery_reason"), nullable=False, default=DeliveryReason.INITIAL
    )
    #: alert + reason + severity + recipient. Unique per workspace, so re-planning is a no-op.
    idempotency_key: Mapped[str] = mapped_column(sa.String(400), nullable=False)
    message_template_version: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    #: Rendered-safe template inputs. Redacted and bounded; never raw evidence.
    payload_snapshot_json: Mapped[dict] = mapped_column(sa.JSON(), nullable=False, default=dict)
    status: Mapped[DeliveryStatus] = mapped_column(
        _enum(DeliveryStatus, "delivery_status"), nullable=False, default=DeliveryStatus.PENDING
    )
    scheduled_for: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    #: Recorded so a deferred warning can explain itself: policy timezone and the decision taken.
    quiet_hours_decision: Mapped[dict | None] = mapped_column(sa.JSON(), nullable=True)
    queued_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    sending_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    attempt_count: Mapped[int] = mapped_column(sa.Integer(), nullable=False, default=0)
    next_retry_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    #: A lease, so a dispatcher that dies mid-send does not strand the row forever.
    lease_expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    skip_reason: Mapped[DeliverySkipReason | None] = mapped_column(
        _enum(DeliverySkipReason, "delivery_skip_reason"), nullable=True
    )
    failure_code: Mapped[DeliveryFailureCode | None] = mapped_column(
        _enum(DeliveryFailureCode, "delivery_failure_code"), nullable=True
    )
    failure_summary: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)
    telegram_message_id: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    telegram_chat_id: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)


class NotificationDeliveryAttempt(UUIDPrimaryKey, Base):
    """Append-only transport attempt history.

    No `archived_at` and no update path: an attempt record that can be rewritten is not evidence.
    Only an allowlisted response code, a safe message id and a summarised error are stored —
    never a raw provider body, never an authorization header.
    """

    __tablename__ = "notification_delivery_attempts"
    __table_args__ = (
        sa.UniqueConstraint("notification_delivery_id", "attempt_number"),
        sa.Index("ix_nda_ws_created", "workspace_id", "created_at"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    notification_delivery_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(),
        sa.ForeignKey("notification_deliveries.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    attempt_number: Mapped[int] = mapped_column(sa.Integer(), nullable=False)
    status: Mapped[DeliveryStatus] = mapped_column(
        _enum(DeliveryStatus, "delivery_status"), nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    provider_response_code: Mapped[int | None] = mapped_column(sa.Integer(), nullable=True)
    provider_message_id: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    failure_code: Mapped[DeliveryFailureCode | None] = mapped_column(
        _enum(DeliveryFailureCode, "delivery_failure_code"), nullable=True
    )
    failure_summary: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)
    retry_scheduled_for: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    request_id: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
