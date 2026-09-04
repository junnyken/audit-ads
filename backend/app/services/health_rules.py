"""Typed health-rule registry, version 1 (MINI-SPEC A2 §B).

Rules are Python functions in a fixed registry, not user-authored expressions. Nothing here
parses or evaluates a string supplied by a caller: A2 rejects dynamic rule code outright, and a
registry keeps evaluation deterministic, reviewable and cheap.

Each rule turns A1 facts into zero or more `SignalCandidate`s. A candidate is an observation,
not a verdict: it carries the source fact it came from, the evidence that justifies it, and the
manual next step the operator can take. No rule predicts platform enforcement, and no rule may
describe an account as safe.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from app.core.enums import (
    AccountStatus,
    EventSeverity,
    HealthCategory,
    HealthSourceType,
    ReadinessStatus,
    SignalSeverity,
)
from app.models.entities import AccountEvent, AdAccount, ReadinessChecklistItem
from app.services.readiness import ReadinessResult

ENGINE_VERSION = "a2-v1"


@dataclass(frozen=True)
class SignalCandidate:
    rule_key: str
    rule_version: int
    #: Identifies *which* fact this is about, so the same rule can raise one signal per event.
    scope: str
    severity: SignalSeverity
    category: HealthCategory
    source_type: HealthSourceType
    evidence: dict
    observed_at: datetime
    source_entity_type: str | None = None
    source_entity_id: str | None = None
    expires_at: datetime | None = None

    @property
    def signal_key(self) -> str:
        return f"{self.rule_key}:{self.scope}"


@dataclass
class HealthFacts:
    """Everything a rule may read. Assembled once per evaluation by the source-fact adapters,
    so two rules can never disagree about the same account by reading it at different times."""

    account: AdAccount
    readiness: ReadinessResult
    checklist_items: list[ReadinessChecklistItem]
    unresolved_events: list[AccountEvent]
    now: datetime
    manual_review_due_after_days: int

    @property
    def critical_events(self) -> list[AccountEvent]:
        return [e for e in self.unresolved_events if e.severity == EventSeverity.CRITICAL]

    @property
    def warning_events(self) -> list[AccountEvent]:
        return [e for e in self.unresolved_events if e.severity == EventSeverity.WARNING]

    @property
    def status_is_blocking(self) -> bool:
        return self.account.status in (AccountStatus.RESTRICTED, AccountStatus.DISABLED)

    @property
    def has_critical_source_fact(self) -> bool:
        """True when a critical fact already explains a not-ready account on its own."""
        return self.status_is_blocking or bool(self.critical_events)

    def required_items_in_state(self, state: str) -> list:
        return [item for item in self.readiness.items if item.required and item.state == state]


@dataclass(frozen=True)
class HealthRule:
    rule_key: str
    version: int
    name: str
    description: str
    category: HealthCategory
    default_severity: SignalSeverity
    applicability: str
    input_facts: tuple[str, ...]
    why_it_matters: str
    recommended_next_step: str
    resolution_guidance: str
    evaluate: Callable[[HealthFacts], list[SignalCandidate]]
    condition_config: dict = field(default_factory=dict)


def _iso(value: datetime | None) -> str | None:
    """Timestamps can be unset on an object that has not been flushed; never crash on that."""
    return value.isoformat() if value else None


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


# ----------------------------------------------------------------------- account status
def _restricted(facts: HealthFacts) -> list[SignalCandidate]:
    if facts.account.status != AccountStatus.RESTRICTED:
        return []
    return [
        SignalCandidate(
            rule_key="account_restricted_status",
            rule_version=1,
            scope="account",
            severity=SignalSeverity.CRITICAL,
            category=HealthCategory.ACCOUNT_STATUS,
            source_type=HealthSourceType.ACCOUNT_STATUS,
            source_entity_type="ad_account",
            source_entity_id=str(facts.account.id),
            evidence={
                "message": "The recorded account status is restricted.",
                "account_status": facts.account.status.value,
                "recorded_at": _iso(_aware(facts.account.updated_at) or facts.now),
                "source": "operator-recorded account status",
            },
            observed_at=_aware(facts.account.updated_at) or facts.now,
        )
    ]


def _disabled(facts: HealthFacts) -> list[SignalCandidate]:
    if facts.account.status != AccountStatus.DISABLED:
        return []
    return [
        SignalCandidate(
            rule_key="account_disabled_status",
            rule_version=1,
            scope="account",
            severity=SignalSeverity.CRITICAL,
            category=HealthCategory.ACCOUNT_STATUS,
            source_type=HealthSourceType.ACCOUNT_STATUS,
            source_entity_type="ad_account",
            source_entity_id=str(facts.account.id),
            evidence={
                "message": "The recorded account status is disabled.",
                "account_status": facts.account.status.value,
                "recorded_at": _iso(_aware(facts.account.updated_at) or facts.now),
                "source": "operator-recorded account status",
            },
            observed_at=_aware(facts.account.updated_at) or facts.now,
        )
    ]


# ---------------------------------------------------------------------------- events
def _event_candidate(event: AccountEvent, rule_key: str, severity: SignalSeverity) -> SignalCandidate:
    return SignalCandidate(
        rule_key=rule_key,
        rule_version=1,
        scope=f"event:{event.id}",
        severity=severity,
        category=HealthCategory.OPERATIONS,
        # Manual observations are labelled as such so they can never be mistaken for platform data.
        source_type=HealthSourceType.MANUAL_EVENT,
        source_entity_type="account_event",
        source_entity_id=str(event.id),
        evidence={
            "message": event.summary or event.event_type,
            "event_type": event.event_type,
            "event_severity": event.severity.value,
            "event_status": event.status.value,
            "event_source": event.source,
            "occurred_at": _iso(_aware(event.occurred_at)),
        },
        observed_at=_aware(event.occurred_at) or event.created_at,
    )


def _critical_events(facts: HealthFacts) -> list[SignalCandidate]:
    return [_event_candidate(e, "critical_account_event_open", SignalSeverity.CRITICAL) for e in facts.critical_events]


def _warning_events(facts: HealthFacts) -> list[SignalCandidate]:
    return [_event_candidate(e, "warning_account_event_open", SignalSeverity.WARNING) for e in facts.warning_events]


# -------------------------------------------------------------------------- readiness
def _evidence_missing(facts: HealthFacts) -> list[SignalCandidate]:
    incomplete = facts.required_items_in_state("unknown")
    if not incomplete:
        return []
    return [
        SignalCandidate(
            rule_key="mandatory_readiness_evidence_missing",
            rule_version=1,
            scope="checklist",
            severity=SignalSeverity.ATTENTION,
            category=HealthCategory.READINESS,
            source_type=HealthSourceType.CHECKLIST_ITEM,
            source_entity_type="ad_account",
            source_entity_id=str(facts.account.id),
            evidence={
                "message": (
                    f"{len(incomplete)} required checklist item(s) have no completed review or "
                    "verified evidence."
                ),
                "item_keys": sorted(item.item_key for item in incomplete),
                "items": [
                    {"item_key": item.item_key, "label": item.label, "detail": item.message}
                    for item in sorted(incomplete, key=lambda i: i.item_key)
                ],
            },
            observed_at=facts.now,
        )
    ]


def _evidence_expired(facts: HealthFacts) -> list[SignalCandidate]:
    # The manual-review item has its own rule; excluding it here keeps one fact to one signal.
    blocked = [
        item
        for item in facts.required_items_in_state("problem")
        if item.item_key != "last_manual_review_completed"
    ]
    if not blocked:
        return []
    return [
        SignalCandidate(
            rule_key="mandatory_readiness_evidence_expired",
            rule_version=1,
            scope="checklist",
            severity=SignalSeverity.WARNING,
            category=HealthCategory.READINESS,
            source_type=HealthSourceType.CHECKLIST_ITEM,
            source_entity_type="ad_account",
            source_entity_id=str(facts.account.id),
            evidence={
                "message": (
                    f"{len(blocked)} required checklist item(s) have expired, rejected or "
                    "flagged evidence."
                ),
                "item_keys": sorted(item.item_key for item in blocked),
                "items": [
                    {"item_key": item.item_key, "label": item.label, "detail": item.message}
                    for item in sorted(blocked, key=lambda i: i.item_key)
                ],
            },
            observed_at=facts.now,
        )
    ]


def _readiness_not_ready(facts: HealthFacts) -> list[SignalCandidate]:
    """Suppressed when a critical source fact already explains the state.

    A2 §B requires choosing one approach and documenting it. Emitting this alongside
    `account_restricted_status` would report the same fact twice under two names, which makes
    the account look worse than the evidence says and buries the actual cause.
    """
    if facts.readiness.readiness_status != ReadinessStatus.NOT_READY.value:
        return []
    if facts.has_critical_source_fact:
        return []
    return [
        SignalCandidate(
            rule_key="readiness_not_ready",
            rule_version=1,
            scope="readiness",
            severity=SignalSeverity.WARNING,
            category=HealthCategory.READINESS,
            source_type=HealthSourceType.READINESS_ENGINE,
            source_entity_type="ad_account",
            source_entity_id=str(facts.account.id),
            evidence={
                "message": "Readiness is not_ready for reasons not already raised as a critical signal.",
                "readiness_status": facts.readiness.readiness_status,
                "reason_codes": [r.code for r in facts.readiness.reasons if r.severity != "info"],
                "reasons": [
                    {"code": r.code, "severity": r.severity, "message": r.message}
                    for r in facts.readiness.reasons
                    if r.severity != "info"
                ],
            },
            observed_at=facts.now,
        )
    ]


def _readiness_unknown(facts: HealthFacts) -> list[SignalCandidate]:
    if facts.readiness.readiness_status != ReadinessStatus.UNKNOWN.value:
        return []
    return [
        SignalCandidate(
            rule_key="readiness_unknown",
            rule_version=1,
            scope="readiness",
            severity=SignalSeverity.ATTENTION,
            category=HealthCategory.DATA_QUALITY,
            source_type=HealthSourceType.READINESS_ENGINE,
            source_entity_type="ad_account",
            source_entity_id=str(facts.account.id),
            evidence={
                "message": "Readiness is unknown because required evidence is missing or incomplete.",
                "readiness_status": facts.readiness.readiness_status,
                "reason_codes": [r.code for r in facts.readiness.reasons if r.severity != "info"],
                "completed_item_count": facts.readiness.completed_item_count,
                "required_item_count": facts.readiness.required_item_count,
            },
            observed_at=facts.now,
        )
    ]


# ------------------------------------------------------------------------- operations
def _manual_review(facts: HealthFacts) -> list[SignalCandidate]:
    reviewed_at = _aware(facts.account.last_manual_review_at)
    interval = facts.manual_review_due_after_days
    if reviewed_at is not None and reviewed_at >= facts.now - timedelta(days=interval):
        return []
    evidence = {
        "message": (
            "This account has never been manually reviewed."
            if reviewed_at is None
            else f"The last manual review is older than the configured {interval}-day interval."
        ),
        "last_manual_review_at": reviewed_at.isoformat() if reviewed_at else None,
        "policy_interval_days": interval,
    }
    return [
        SignalCandidate(
            rule_key="manual_review_due_or_stale",
            rule_version=1,
            scope="manual_review",
            severity=SignalSeverity.WARNING,
            category=HealthCategory.OPERATIONS,
            source_type=HealthSourceType.ACCOUNT_STATUS,
            source_entity_type="ad_account",
            source_entity_id=str(facts.account.id),
            evidence=evidence,
            observed_at=facts.now,
        )
    ]


def _data_stale_or_unknown(facts: HealthFacts) -> list[SignalCandidate]:
    """The only rule that may raise `unknown` severity: it fires when the engine lacks the
    inputs to assess an account at all, which must never be reported as a clear result."""
    if not facts.checklist_items:
        return [
            SignalCandidate(
                rule_key="account_data_stale_or_unknown",
                rule_version=1,
                scope="inputs",
                severity=SignalSeverity.UNKNOWN,
                category=HealthCategory.DATA_QUALITY,
                source_type=HealthSourceType.EVALUATION_ENGINE,
                source_entity_type="ad_account",
                source_entity_id=str(facts.account.id),
                evidence={
                    "message": (
                        "This account has no readiness checklist, so its current condition "
                        "cannot be assessed from stored records."
                    ),
                    "missing_input": "readiness_checklist_items",
                },
                observed_at=facts.now,
            )
        ]
    if facts.account.readiness_evaluated_at is None:
        return [
            SignalCandidate(
                rule_key="account_data_stale_or_unknown",
                rule_version=1,
                scope="inputs",
                severity=SignalSeverity.ATTENTION,
                category=HealthCategory.DATA_QUALITY,
                source_type=HealthSourceType.EVALUATION_ENGINE,
                source_entity_type="ad_account",
                source_entity_id=str(facts.account.id),
                evidence={
                    "message": "Readiness has never been evaluated for this account.",
                    "missing_input": "readiness_evaluated_at",
                },
                observed_at=facts.now,
            )
        ]
    return []


HEALTH_RULES_V1: tuple[HealthRule, ...] = (
    HealthRule(
        rule_key="account_restricted_status",
        version=1,
        name="Account status is restricted",
        description="Raises a critical signal while the recorded account status is restricted.",
        category=HealthCategory.ACCOUNT_STATUS,
        default_severity=SignalSeverity.CRITICAL,
        applicability="All non-archived accounts.",
        input_facts=("ad_account.status",),
        why_it_matters="A restricted account cannot be operated normally until the restriction is dealt with.",
        recommended_next_step="Review the account in the ads interface and record what you find as an account event.",
        resolution_guidance="Closes automatically once the recorded status is no longer restricted.",
        evaluate=_restricted,
    ),
    HealthRule(
        rule_key="account_disabled_status",
        version=1,
        name="Account status is disabled",
        description="Raises a critical signal while the recorded account status is disabled.",
        category=HealthCategory.ACCOUNT_STATUS,
        default_severity=SignalSeverity.CRITICAL,
        applicability="All non-archived accounts.",
        input_facts=("ad_account.status",),
        why_it_matters="A disabled account cannot run anything until its status changes.",
        recommended_next_step="Confirm the status in the ads interface and record the outcome as an account event.",
        resolution_guidance="Closes automatically once the recorded status is no longer disabled.",
        evaluate=_disabled,
    ),
    HealthRule(
        rule_key="critical_account_event_open",
        version=1,
        name="Unresolved critical account event",
        description="One critical signal per unresolved critical account event.",
        category=HealthCategory.OPERATIONS,
        default_severity=SignalSeverity.CRITICAL,
        applicability="All non-archived accounts with unresolved critical events.",
        input_facts=("account_event.severity", "account_event.status"),
        why_it_matters="A critical observation you recorded is still open and unaddressed.",
        recommended_next_step="Work the underlying issue, then resolve the account event with a reason on the Events tab.",
        resolution_guidance="Closes automatically when the source account event is resolved.",
        evaluate=_critical_events,
    ),
    HealthRule(
        rule_key="warning_account_event_open",
        version=1,
        name="Unresolved warning account event",
        description="One warning signal per unresolved warning account event.",
        category=HealthCategory.OPERATIONS,
        default_severity=SignalSeverity.WARNING,
        applicability="All non-archived accounts with unresolved warning events.",
        input_facts=("account_event.severity", "account_event.status"),
        why_it_matters="A warning you recorded is still open.",
        recommended_next_step="Resolve the account event with a reason once the issue is handled.",
        resolution_guidance="Closes automatically when the source account event is resolved.",
        evaluate=_warning_events,
    ),
    HealthRule(
        rule_key="mandatory_readiness_evidence_missing",
        version=1,
        name="Required readiness evidence is missing",
        description="Attention signal listing required checklist items with no completed review or verified evidence.",
        category=HealthCategory.READINESS,
        default_severity=SignalSeverity.ATTENTION,
        applicability="All non-archived accounts.",
        input_facts=("readiness_checklist_item.review_status", "readiness_checklist_item.evidence_status"),
        why_it_matters="Operational records for this account are incomplete, so its condition is only partly known.",
        recommended_next_step="Open the Readiness tab and complete the listed items with evidence.",
        resolution_guidance="Closes automatically once every listed item is satisfied.",
        evaluate=_evidence_missing,
    ),
    HealthRule(
        rule_key="mandatory_readiness_evidence_expired",
        version=1,
        name="Required readiness evidence is expired or rejected",
        description="Warning signal listing required checklist items whose evidence expired, was rejected or is flagged.",
        category=HealthCategory.READINESS,
        default_severity=SignalSeverity.WARNING,
        applicability="All non-archived accounts.",
        input_facts=("readiness_checklist_item.evidence_status", "readiness_checklist_item.expires_at"),
        why_it_matters="Evidence that has lapsed or been rejected no longer supports the record it was attached to.",
        recommended_next_step="Attach current evidence on the Readiness tab, or record why the item cannot be satisfied.",
        resolution_guidance="Closes automatically once the listed items carry current, verified evidence.",
        evaluate=_evidence_expired,
    ),
    HealthRule(
        rule_key="readiness_not_ready",
        version=1,
        name="Readiness is not ready",
        description=(
            "Warning signal when A1 readiness is not_ready for reasons not already raised as a "
            "critical signal. Suppressed when a critical source fact already explains the state."
        ),
        category=HealthCategory.READINESS,
        default_severity=SignalSeverity.WARNING,
        applicability="Non-archived accounts whose readiness is not_ready with no critical source fact.",
        input_facts=("readiness.readiness_status", "readiness.reasons"),
        why_it_matters="Something recorded is blocking this account, and it is not a restriction or a critical event.",
        recommended_next_step="Open the Readiness tab and work the listed blocking reasons.",
        resolution_guidance="Closes automatically once readiness is no longer not_ready.",
        evaluate=_readiness_not_ready,
    ),
    HealthRule(
        rule_key="readiness_unknown",
        version=1,
        name="Readiness is unknown",
        description="Attention signal when A1 readiness cannot be determined from stored evidence.",
        category=HealthCategory.DATA_QUALITY,
        default_severity=SignalSeverity.ATTENTION,
        applicability="All non-archived accounts.",
        input_facts=("readiness.readiness_status",),
        why_it_matters="Unknown is not a pass: the records are too incomplete to say anything about this account.",
        recommended_next_step="Complete the outstanding checklist items so readiness can resolve either way.",
        resolution_guidance="Closes automatically once readiness resolves to any other state.",
        evaluate=_readiness_unknown,
    ),
    HealthRule(
        rule_key="manual_review_due_or_stale",
        version=1,
        name="Manual review is due or stale",
        description="Warning signal when the last manual review is missing or older than the configured interval.",
        category=HealthCategory.OPERATIONS,
        default_severity=SignalSeverity.WARNING,
        applicability="All non-archived accounts.",
        input_facts=("ad_account.last_manual_review_at",),
        why_it_matters="Nobody has looked at this account recently, so what is recorded may no longer match reality.",
        recommended_next_step="Review the account and record the review with a note on the Overview tab.",
        resolution_guidance="Closes automatically once a manual review is recorded within the interval.",
        evaluate=_manual_review,
    ),
    HealthRule(
        rule_key="account_data_stale_or_unknown",
        version=1,
        name="Health inputs are missing or stale",
        description="Raised when required health inputs are absent, so the account's condition cannot be assessed.",
        category=HealthCategory.DATA_QUALITY,
        default_severity=SignalSeverity.ATTENTION,
        applicability="All non-archived accounts.",
        input_facts=("readiness_checklist_item", "ad_account.readiness_evaluated_at"),
        why_it_matters="Without these inputs the system has nothing to assess, and absence of a finding is not a clear result.",
        recommended_next_step="Recalculate readiness for the account so the checklist and readiness state exist.",
        resolution_guidance="Closes automatically once the inputs are available.",
        evaluate=_data_stale_or_unknown,
    ),
)

HEALTH_RULES_BY_KEY: dict[str, HealthRule] = {rule.rule_key: rule for rule in HEALTH_RULES_V1}
