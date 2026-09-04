"""Controlled vocabulary for A1 (MINI-SPEC A1 §B).

Values are stable wire/database values. Display labels are localised in the frontend; these
strings must not be renamed without a migration.
"""
from __future__ import annotations

from enum import Enum


class StrEnum(str, Enum):
    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.value


class WorkspaceRole(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    BUYER = "buyer"
    VIEWER = "viewer"
    AUDITOR = "auditor"


class AccountType(StrEnum):
    BUSINESS_MANAGER = "business_manager"
    PERSONAL_REFERENCE = "personal_reference"
    UNKNOWN = "unknown"


class AccountStatus(StrEnum):
    UNKNOWN = "unknown"
    ACTIVE = "active"
    WARNING = "warning"
    RESTRICTED = "restricted"
    DISABLED = "disabled"
    ARCHIVED = "archived"


class ReadinessStatus(StrEnum):
    UNKNOWN = "unknown"
    NOT_READY = "not_ready"
    READY_WITH_WARNINGS = "ready_with_warnings"
    OPERATIONALLY_READY = "operationally_ready"


class EvidenceStatus(StrEnum):
    MISSING = "missing"
    PROVIDED = "provided"
    VERIFIED = "verified"
    EXPIRED = "expired"
    REJECTED = "rejected"


class ChecklistReviewStatus(StrEnum):
    NOT_REVIEWED = "not_reviewed"
    IN_REVIEW = "in_review"
    COMPLETED = "completed"
    NEEDS_UPDATE = "needs_update"
    WAIVED = "waived"


class EventSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class EventStatus(StrEnum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


class ChecklistCategory(StrEnum):
    OWNERSHIP = "ownership"
    ACCESS = "access"
    BILLING = "billing"
    ASSETS = "assets"
    COMPLIANCE = "compliance"
    OPERATIONS = "operations"


class AssetType(StrEnum):
    """Asset kinds addressable through AccountAssetLink."""

    PAGE = "page"
    PIXEL = "pixel"
    PAYMENT_PROFILE = "payment_profile"
    BROWSER_PROFILE = "browser_profile"
    PROXY = "proxy"


#: Asset kinds where at most one link may be active per ad account at a time.
SINGLE_ACTIVE_ASSET_TYPES = frozenset({AssetType.BROWSER_PROFILE, AssetType.PROXY})


class ReferenceStatus(StrEnum):
    """Lifecycle of a non-account reference record (BM, page, pixel, proxy, ...)."""

    UNKNOWN = "unknown"
    ACTIVE = "active"
    INACTIVE = "inactive"
    RESTRICTED = "restricted"


class DataFreshness(StrEnum):
    CURRENT = "current"
    STALE = "stale"
    UNKNOWN = "unknown"


class ReasonSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


# ---------------------------------------------------------------------------------------
# MINI-SPEC A2 — Account health vocabulary.
#
# Additive only. No A1 value above is renamed, removed or given a new meaning: readiness and
# health answer different questions and keep separate vocabularies (A2 §4.1).
# ---------------------------------------------------------------------------------------


class HealthStatus(StrEnum):
    """What currently needs the operator's attention on an account, and how urgently."""

    UNKNOWN = "unknown"
    ATTENTION_NEEDED = "attention_needed"
    WARNING = "warning"
    CRITICAL = "critical"
    #: Rendered as "No current issues found by configured checks" — never as "safe".
    CLEAR_SIGNALS = "clear_signals"


class SignalSeverity(StrEnum):
    """`unknown` is used only when the engine could not assess, never as a mild severity."""

    UNKNOWN = "unknown"
    ATTENTION = "attention"
    WARNING = "warning"
    CRITICAL = "critical"


class SignalStatus(StrEnum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"
    EXPIRED = "expired"
    SUPERSEDED = "superseded"


#: Statuses that still count towards the health rollup. Acknowledgement is not resolution
#: (A2 Guardrail 11), so an acknowledged signal stays here.
ACTIVE_SIGNAL_STATUSES = frozenset({SignalStatus.OPEN, SignalStatus.ACKNOWLEDGED})


class HealthCategory(StrEnum):
    ACCOUNT_STATUS = "account_status"
    OPERATIONS = "operations"
    READINESS = "readiness"
    DATA_QUALITY = "data_quality"


class HealthSourceType(StrEnum):
    """Where a signal's fact came from. A manual observation must never look like platform data."""

    ACCOUNT_STATUS = "account_status"
    MANUAL_EVENT = "manual_event"
    READINESS_ENGINE = "readiness_engine"
    CHECKLIST_ITEM = "checklist_item"
    EVALUATION_ENGINE = "evaluation_engine"


class HealthFreshness(StrEnum):
    """Separate from A1's DataFreshness: health adds `not_applicable` for sources that do not
    exist yet (there is no platform integration), and A1 enums must not be altered."""

    CURRENT = "current"
    STALE = "stale"
    UNKNOWN = "unknown"
    NOT_APPLICABLE = "not_applicable"


class EvaluationTrigger(StrEnum):
    ACCOUNT_MUTATION = "account_mutation"
    CHECKLIST_MUTATION = "checklist_mutation"
    EVIDENCE_MUTATION = "evidence_mutation"
    ACCOUNT_EVENT_MUTATION = "account_event_mutation"
    MANUAL_RECALCULATE = "manual_recalculate"
    SCHEDULED_RECALCULATE = "scheduled_recalculate"
    RULE_CHANGE = "rule_change"
    BACKFILL = "backfill"


class EvaluationRunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    SKIPPED = "skipped"


# ---------------------------------------------------------------------------------------
# MINI-SPEC A3 — Alert Center and notification delivery.
#
# Additive only. Alerts are an attention/notification layer over A2 health: they never
# recompute health, and neither A1 readiness nor A2 health vocabulary changes here.
# ---------------------------------------------------------------------------------------


class AlertStatus(StrEnum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    SUPPRESSED = "suppressed"
    RESOLVED = "resolved"
    EXPIRED = "expired"
    ARCHIVED = "archived"


#: Statuses that keep an alert in the Alert Center's active view and in its counts.
#: `suppressed` is deliberately included: suppression mutes delivery, never visibility.
ACTIVE_ALERT_STATUSES = frozenset(
    {AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED, AlertStatus.SUPPRESSED}
)


class AlertSeverity(StrEnum):
    """Reuses the A1 event severity words. A3 adds no "safe" state and no score."""

    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class AlertSourceType(StrEnum):
    HEALTH_SIGNAL = "health_signal"
    HEALTH_EVALUATION_RUN = "health_evaluation_run"


class DeliveryChannel(StrEnum):
    TELEGRAM = "telegram"


class DeliveryStatus(StrEnum):
    PENDING = "pending"
    QUEUED = "queued"
    SENDING = "sending"
    SENT = "sent"
    FAILED_TRANSIENT = "failed_transient"
    FAILED_FINAL = "failed_final"
    SKIPPED = "skipped"
    CANCELLED = "cancelled"


#: Statuses a dispatcher may still act on.
DUE_DELIVERY_STATUSES = frozenset({DeliveryStatus.PENDING, DeliveryStatus.FAILED_TRANSIENT})
#: Statuses that are terminal — nothing reopens them.
TERMINAL_DELIVERY_STATUSES = frozenset(
    {
        DeliveryStatus.SENT,
        DeliveryStatus.FAILED_FINAL,
        DeliveryStatus.SKIPPED,
        DeliveryStatus.CANCELLED,
    }
)


class DeliveryReason(StrEnum):
    """Why a delivery exists. Part of the idempotency key, so it decides what may be re-sent."""

    INITIAL = "initial"
    ESCALATION = "escalation"
    REMINDER = "reminder"


class DeliverySkipReason(StrEnum):
    """Every non-send is explained by one of these; a delivery is never silently dropped."""

    NO_RECIPIENT_CONFIGURED = "no_recipient_configured"
    POLICY_DISABLED = "policy_disabled"
    SEVERITY_DELIVERY_DISABLED = "severity_delivery_disabled"
    ALERT_SUPPRESSED = "alert_suppressed"
    ALERT_NOT_ACTIVE = "alert_not_active"
    TIMEZONE_NOT_CONFIGURED = "timezone_not_configured"
    DUPLICATE_SUPPRESSED_BY_DEDUPE = "duplicate_suppressed_by_dedupe"
    REMINDERS_DISABLED = "reminders_disabled"


class DeliveryFailureCode(StrEnum):
    """Allowlisted, safe failure codes. A raw provider body never becomes a stored value."""

    TRANSPORT_NOT_CONFIGURED = "transport_not_configured"
    NETWORK_ERROR = "network_error"
    RATE_LIMITED = "rate_limited"
    PROVIDER_SERVER_ERROR = "provider_server_error"
    INVALID_RECIPIENT = "invalid_recipient"
    UNAUTHORIZED = "unauthorized"
    MESSAGE_REJECTED = "message_rejected"
    UNKNOWN_ERROR = "unknown_error"


#: Failure codes that are worth retrying. Everything else is final by default.
TRANSIENT_FAILURE_CODES = frozenset(
    {
        DeliveryFailureCode.NETWORK_ERROR,
        DeliveryFailureCode.RATE_LIMITED,
        DeliveryFailureCode.PROVIDER_SERVER_ERROR,
    }
)


class NotificationTransportMode(StrEnum):
    """`disabled` is the default: a fresh deployment cannot message anyone by accident."""

    DISABLED = "disabled"
    FAKE = "fake"
    TELEGRAM = "telegram"


class OperationalRunKind(StrEnum):
    """A4. Infrastructure processes whose last run an operator needs to be able to see."""

    DISPATCH = "dispatch"
    RECOVERY_SWEEP = "recovery_sweep"
    BACKUP = "backup"
    RESTORE_DRILL = "restore_drill"
    MIGRATION_RELEASE = "migration_release"
    TEST_SEND = "test_send"


class OperationalRunStatus(StrEnum):
    SUCCEEDED = "succeeded"
    PARTIAL = "partial"
    FAILED = "failed"
