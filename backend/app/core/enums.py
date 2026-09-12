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


class ActivityStatus(StrEnum):
    """A7: whether the account itself has been active — a different question from
    `DataFreshness`, which is about whether *our data* is current. Deliberately three states,
    not four: there is no operator-recorded evidence path yet for "confirmed inactive"
    (distinct from "we just have not looked recently"), so that state is not fabricated
    (A7 principle: missing data is never turned into a claim). `last_activity_at` unset means
    `UNKNOWN`; set and within the freshness window means `ACTIVE_RECENTLY`; set and older than
    the window means `STALE` — an old data point, not proof of inactivity."""

    UNKNOWN = "unknown"
    ACTIVE_RECENTLY = "active_recently"
    STALE = "stale"


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


class EventSource(StrEnum):
    """Where an AccountEvent came from. A1 stored this as a free string; A5 names the values
    it actually uses so the extension cannot invent a source that looks official."""

    MANUAL = "manual"
    CHROME_EXTENSION = "chrome_extension"
    SYSTEM = "system"


class ExtensionContextStatus(StrEnum):
    """How confident the extension is about which account a page belongs to.

    `confirmed` requires an exact registered account id. Everything else stays honest about
    not knowing — there is deliberately no "probably" state.
    """

    CONFIRMED = "confirmed"
    AMBIGUOUS = "ambiguous"
    UNKNOWN = "unknown"
    UNSUPPORTED_PAGE = "unsupported_page"


class ExtensionPageType(StrEnum):
    """Coarse page shape, from an allowlisted route. Never a raw URL."""

    UNKNOWN = "unknown"
    ACCOUNT = "account"
    CAMPAIGN = "campaign"
    ADSET = "adset"
    AD = "ad"
    BILLING = "billing"
    SETTINGS = "settings"


class ExtensionEventType(StrEnum):
    """The only event types an extension session may write.

    An allowlist rather than a free string: the extension is the least trusted client in the
    system, and an operator reading the timeline must be able to trust what `chrome_extension`
    means.
    """

    CONTEXT_CONFIRMED = "extension_context_confirmed"
    CONTEXT_AMBIGUOUS = "extension_context_ambiguous"
    CONTEXT_UNKNOWN = "extension_context_unknown"
    MANUAL_REVIEW_STARTED = "manual_review_started"
    MANUAL_REVIEW_COMPLETED = "manual_review_completed"
    CAMPAIGN_CHANGE_INTENT = "campaign_change_intent"
    CAMPAIGN_CHANGE_COMPLETED = "campaign_change_completed"
    ACCOUNT_NOTE_ADDED = "account_note_added"
    POLICY_ISSUE_REPORTED = "policy_issue_reported"
    PAYMENT_ISSUE_REPORTED = "payment_issue_reported"


#: Severity each extension event is recorded with. The extension does not choose its own
#: severity: a client that could mark its own note "critical" would make the timeline useless.
EXTENSION_EVENT_SEVERITY: dict[str, str] = {
    ExtensionEventType.CONTEXT_CONFIRMED: "info",
    ExtensionEventType.CONTEXT_AMBIGUOUS: "info",
    ExtensionEventType.CONTEXT_UNKNOWN: "info",
    ExtensionEventType.MANUAL_REVIEW_STARTED: "info",
    ExtensionEventType.MANUAL_REVIEW_COMPLETED: "info",
    ExtensionEventType.CAMPAIGN_CHANGE_INTENT: "info",
    ExtensionEventType.CAMPAIGN_CHANGE_COMPLETED: "info",
    ExtensionEventType.ACCOUNT_NOTE_ADDED: "info",
    ExtensionEventType.POLICY_ISSUE_REPORTED: "warning",
    ExtensionEventType.PAYMENT_ISSUE_REPORTED: "warning",
}


# ------------------------------------------------------------------------------------------
# MINI-SPEC A6 — Preflight Compliance Gate
# ------------------------------------------------------------------------------------------


class DraftStatus(StrEnum):
    """Section 4.1. Never worded as "approved" or "safe to publish" anywhere it is rendered."""

    DRAFT = "draft"
    SUBMITTED_FOR_REVIEW = "submitted_for_review"
    NEEDS_CHANGES = "needs_changes"
    READY_FOR_MANUAL_REVIEW = "ready_for_manual_review"
    BLOCKED_BY_INTERNAL_POLICY = "blocked_by_internal_policy"
    UNKNOWN_MISSING_EVIDENCE = "unknown_missing_evidence"
    ARCHIVED = "archived"


class PreflightEvaluationRunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class FindingCategory(StrEnum):
    COPY_LANGUAGE = "copy_language"
    LANDING_PAGE = "landing_page"
    ACCOUNT_READINESS = "account_readiness"
    ACCOUNT_HEALTH = "account_health"
    BUDGET_CHANGE = "budget_change"
    TARGETING_COMPLETENESS = "targeting_completeness"
    DATA_QUALITY = "data_quality"


class FindingSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    BLOCKING = "blocking"


class FindingStatus(StrEnum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"
    SUPERSEDED = "superseded"


# ------------------------------------------------------------------------------------------
# MINI-SPEC A7 — BM + Ad Account Creation & Sharing (official Meta API only)
# ------------------------------------------------------------------------------------------


class MetaEnvironment(StrEnum):
    """`fake` is the only one any code path is allowed to call automatically — `sandbox` and
    `production` exist so the schema/UI has somewhere to point once a real Meta App exists, but
    reaching them always requires the operator's own separate, explicit setup."""

    FAKE = "fake"
    SANDBOX = "sandbox"
    PRODUCTION = "production"


class MetaBatchItemStatus(StrEnum):
    """`unknown` is reachable only via a timeout — never assigned for an ordinary failure, and
    never advanced to `succeeded` by anything other than a confirmed provider result
    (A7 guardrail: an ambiguous side effect is never guessed into a positive state)."""

    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    UNKNOWN = "unknown"


# ------------------------------------------------------------------------------------------
# MINI-SPEC A10.1 — Configured BM Validation & Read-Only Asset Discovery
# ------------------------------------------------------------------------------------------


class DiscoveryTrigger(StrEnum):
    """How a discovery run started. `scheduled_reconciliation` is deliberately absent: A10.1
    only runs when a person asks, so there is no code path that could start one on a timer."""

    MANUAL = "manual"
    INTERNAL_TEST = "internal_test"


class DiscoveryRunStatus(StrEnum):
    """Deliberately small, because the *reason* a run did not fully succeed already has a
    vocabulary: `MetaFailureCode`, stored alongside. Repeating `permission_missing`,
    `token_expired`, `rate_limited` and friends here would create a second, drifting copy of
    that scheme — the parallel-vocabulary mistake A10 was written to avoid.

    `succeeded_with_warnings` is the honest home for a run that finished without error but did
    not see everything: an edge was refused, or a page cap stopped the read. It completed; it is
    not a full inventory, so it may not license `missing_from_latest_discovery`.
    """

    RUNNING = "running"
    SUCCEEDED = "succeeded"
    SUCCEEDED_WITH_WARNINGS = "succeeded_with_warnings"
    FAILED = "failed"


class CoverageStatus(StrEnum):
    """How much of an asset type a run actually saw — a dimension of its own, separate from
    *why* it fell short. The reason stays a `MetaFailureCode` on the individual edge, so this
    enum never becomes a drifting second copy of that vocabulary.

    Proven necessary on real data (2026-09-10): a Business Manager returned four ad accounts,
    two on `owned_ad_accounts` and two on `client_ad_accounts`. A run reading only the first
    edge succeeds on everything it attempts, so an error-based notion of completeness calls it
    complete — while half the inventory is invisible and would be reported missing.
    """

    #: Every required edge answered and no page cap was hit. The only value that may license
    #: `missing_from_latest_discovery`.
    COMPLETE = "complete"
    #: An edge was cut short — a cap, a rate limit, a server error. More exists than was seen.
    PARTIAL = "partial"
    #: An edge could not be read at all, so a whole class of assets may be unrepresented.
    INCOMPLETE = "incomplete"
    #: An edge failed in a way this product cannot categorise.
    UNKNOWN = "unknown"
    #: Computed at read time against the freshness policy, never stored as a scan result.
    STALE = "stale"
    #: The asset type was never asked for. Distinct from seeing nothing.
    NOT_ATTEMPTED = "not_attempted"


class BusinessAuthority(StrEnum):
    """Whether the provider positively proved it may read a Business Manager's assets.

    Measured against real Meta on 2026-09-11, and the reason this enum exists: a system-user
    token with no role in a Business Manager can still read that BM's **node** (`id`, `name`),
    and its asset edges answer `200` with an empty list and no error — while
    `{business-id}/system_users`, same token, same BM, refuses with `permission_missing`. One
    business, two edges, two different failure languages.

    So an error-free empty inventory does not distinguish "this Business Manager holds nothing"
    from "this token may not see what it holds". Without this dimension the first reading wins
    by default, and `complete` — the single gate on `missing_from_latest_discovery` — is granted
    to a Business Manager nobody could actually read.
    """

    #: Nobody asked. The honest default: it must never read as access (hard rule 4).
    NOT_CHECKED = "not_checked"
    #: A positive answer to something only a member can read.
    ESTABLISHED = "established"
    #: The check was made and did not come back positive. Deliberately one value, not two:
    #: "no role at all" and "a role too narrow to prove itself" are indistinguishable from
    #: outside, and collapsing them into access is the defect this prevents.
    NOT_ESTABLISHED = "not_established"


class AssetReconciliationStatus(StrEnum):
    """`missing_from_latest_discovery` says only what it says: the asset was not returned by the
    most recent *complete* scan. It is never evidence that Meta deleted, disabled or restricted
    anything, and it never causes an internal record to change on its own."""

    MATCHED = "matched"
    MISSING_IN_REGISTRY = "missing_in_registry"
    MISSING_FROM_LATEST_DISCOVERY = "missing_from_latest_discovery"
    METADATA_MISMATCH = "metadata_mismatch"
    OUT_OF_SCOPE = "out_of_scope"
    UNKNOWN = "unknown"
    NOT_EVALUATED = "not_evaluated"


# ------------------------------------------------------------------------------------------
# MINI-SPEC A9 — Team Seats, BM/Ad-Account Assignment & Device Session Security
# ------------------------------------------------------------------------------------------


class DeviceSessionType(StrEnum):
    """Only `web` exists today. A5's extension already has its own, separate, working
    revocation model (`ExtensionInstallation`) — this registry is not merged with it (A9 audit
    finding), so `chrome_extension` is deliberately not a member here yet."""

    WEB = "web"


class SeatPlanStatus(StrEnum):
    """A single value today — `WorkspaceSeatPlan.archived_at` already answers "is this the
    workspace's current plan," so this exists only so the schema has somewhere to add a state
    like `past_due` later without a migration, not because two values are needed now."""

    ACTIVE = "active"


class InvitationStatus(StrEnum):
    """`draft` exists in the spec's vocabulary but nothing in A9 ever creates one — every
    invitation this product writes starts at `pending` (create-and-send is one action, not a
    two-step draft/send). Kept as a member for schema-vocabulary completeness only."""

    DRAFT = "draft"
    PENDING = "pending"
    ACCEPTED = "accepted"
    EXPIRED = "expired"
    REVOKED = "revoked"
    CANCELLED = "cancelled"
    ARCHIVED = "archived"


class WorkspaceMemberStatus(StrEnum):
    """`archived` is deliberately not a member here — `WorkspaceMember.archived_at` (inherited
    from `Archivable`, present since A1) already is that state; duplicating it as a fifth enum
    value would be two sources of truth for the same fact. A membership's *effective* status is
    `archived` whenever `archived_at is not None`, checked first, before this column."""

    INVITED = "invited"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    DEACTIVATED = "deactivated"


class AssignmentStatus(StrEnum):
    """`archived` is likewise not a member — assignment rows use the same `Archivable`
    convention as everything else in this codebase; `revoked`/`expired` are this table's own
    additional states beyond plain archive."""

    ACTIVE = "active"
    REVOKED = "revoked"
    EXPIRED = "expired"
