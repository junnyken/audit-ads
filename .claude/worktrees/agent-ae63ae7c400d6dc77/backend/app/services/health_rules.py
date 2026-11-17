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
from app.services.discovery_facts import DiscoveryFacts
from app.services.platform_status import (
    BLOCKING,
    PENDING,
    PlatformAccountStatus,
    disable_reason_text,
    status_label,
)
from app.services.readiness import ReadinessResult
from app.services.spend_engine import PlatformStatusFacts, SpendFacts, amount_text, parse_amount

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
    #: S1. Assembled from stored observations before evaluation — never read from the platform
    #: during it, so "Recalculate health" still contacts no advertising platform. `None` means
    #: the spend facts were not assembled at all, and every spend rule then stays silent.
    spend: SpendFacts | None = None
    #: S2. Meta's latest account status, taken from `spend.platform_status` — the same stored
    #: observations, no extra read. `None`: no observation carries a status code, and every
    #: platform-status rule then stays silent (rule 4: missing is never positive, nor negative).
    platform_status: PlatformStatusFacts | None = None
    #: O3. The latest usable production discovery of the account's Business Manager, from stored
    #: runs only. `None`: no such run in the window, and the discovery rule stays silent.
    discovery: DiscoveryFacts | None = None

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
    #: Whether the seeded global definition starts enabled. Only `spend_cap_approaching` starts
    #: off: its inputs' units are unverified until the first live read has been looked at, and
    #: switching it on is then one `PATCH /account-health/rules/{key}` by the owner.
    enabled_by_default: bool = True


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


# ------------------------------------------------------------------------------ spend (S1)
#: Every spend signal names where its fact came from: a platform read through a named reader,
#: stored before evaluation. A spend signal must never look like an operator-recorded fact.
_SPEND_SOURCE = HealthSourceType.PROVIDER_OBSERVATION


def _spend_candidate(
    facts: HealthFacts,
    *,
    rule_key: str,
    scope: str,
    severity: SignalSeverity,
    evidence: dict,
    observed_at: datetime | None,
    observation_id: str | None,
) -> SignalCandidate:
    return SignalCandidate(
        rule_key=rule_key,
        rule_version=1,
        scope=scope,
        severity=severity,
        category=HealthCategory.SPEND,
        source_type=_SPEND_SOURCE,
        source_entity_type="ad_account_spend_observation" if observation_id else "ad_account",
        source_entity_id=observation_id or str(facts.account.id),
        evidence={
            **evidence,
            "source": "Meta read-only spend observation",
            "reader_source": facts.spend.reader_source if facts.spend else None,
        },
        observed_at=_aware(observed_at) or facts.now,
    )


def _spend_missing_or_stale(facts: HealthFacts) -> list[SignalCandidate]:
    spend = facts.spend
    if spend is None or not spend.observable:
        # Nothing can read this account, so there is nothing to be late about. Health says so on
        # screen through the `not_observable` freshness; it is not a finding about the account.
        return []
    latest = spend.latest_success
    attempt = spend.latest_attempt
    failures = spend.consecutive_failures
    if spend.freshness.value == "never_observed":
        message = (
            "Spend has never been read successfully for this account."
            if attempt is None or failures == 0
            else "Every spend read for this account has failed so far."
        )
    elif spend.freshness.value == "stale":
        message = (
            f"The latest successful spend read is older than {spend.stale_after_hours} hours."
        )
    elif failures >= 3:
        message = "The last three spend reads for this account failed."
    else:
        return []
    return [
        _spend_candidate(
            facts,
            rule_key="spend_observation_missing_or_stale",
            scope="spend_observation",
            severity=SignalSeverity.ATTENTION,
            evidence={
                "message": message,
                "spend_freshness": spend.freshness.value,
                "last_successful_observed_at": _iso(_aware(latest.observed_at)) if latest else None,
                "latest_failure_code": (
                    attempt.failure_code if attempt is not None and not attempt.succeeded else None
                ),
                "consecutive_failed_reads": min(failures, 3),
                "stale_after_hours": spend.stale_after_hours,
            },
            observed_at=attempt.observed_at if attempt else None,
            observation_id=attempt.id if attempt else None,
        )
    ]


def _spend_change_vs_baseline(facts: HealthFacts) -> list[SignalCandidate]:
    spend = facts.spend
    if spend is None or not spend.observable or not spend.is_current:
        return []
    if not spend.timezone_usable or spend.latest_complete_day is None:
        # No timezone, no "yesterday". Not fired — and not reported as fine either.
        return []
    if spend.insights_currency_conflict:
        return []
    latest = spend.day(spend.latest_complete_day)
    if latest is None or not latest.has_row or latest.amount is None:
        # No row is not zero (rule 4). Only a row with a small number can be a drop.
        return []
    currency = spend.observed_currency or (latest.currency or "").upper() or None
    minimum = spend.min_amount_for(currency)
    if minimum is None:
        # No minimum configured for this currency: the rule stays silent rather than treating
        # every small wobble in an unconfigured currency as a change worth a warning.
        return []
    median = spend.baseline_median()
    if median is None:
        return []

    amount = latest.amount
    delta = amount - median
    if abs(delta) < minimum:
        return []
    ratio = (abs(delta) / median) if median > 0 else None
    if ratio is not None and ratio < parse_amount(str(spend.change_ratio_threshold)):
        return []

    baseline = spend.baseline_days()
    direction = "increase" if delta > 0 else "decrease"
    return [
        _spend_candidate(
            facts,
            rule_key="spend_change_vs_baseline",
            scope=f"day:{latest.day.isoformat()}",
            severity=SignalSeverity.WARNING,
            evidence={
                "message": (
                    f"Spend on {latest.day.isoformat()} ({amount_text(amount)} {currency}) is a "
                    f"{direction} versus the median of the previous {len(baseline)} complete "
                    f"days ({amount_text(median)} {currency})."
                ),
                "day": latest.day.isoformat(),
                "spend": latest.spend_raw,
                "currency": currency,
                "direction": direction,
                "baseline_median": amount_text(median),
                "baseline_day_count": len(baseline),
                "baseline_days": [d.day.isoformat() for d in baseline],
                "change_ratio": amount_text(round(ratio, 4)) if ratio is not None else None,
                "change_ratio_threshold": str(spend.change_ratio_threshold),
                "change_min_amount": amount_text(minimum),
                "timezone_name": spend.latest_success.timezone_name if spend.latest_success else None,
            },
            observed_at=latest.observed_at,
            observation_id=latest.observation_id,
        )
    ]


def _spend_cap_approaching(facts: HealthFacts) -> list[SignalCandidate]:
    spend = facts.spend
    if spend is None or not spend.observable or not spend.is_current:
        return []
    latest = spend.latest_success
    if latest is None or spend.insights_currency_conflict:
        return []
    spent = parse_amount(latest.amount_spent_raw)
    cap = parse_amount(latest.spend_cap_raw)
    if spent is None or cap is None or cap <= 0:
        # An empty, zero or unparseable cap is not a cap this rule can measure against.
        return []
    ratio = spent / cap
    threshold = parse_amount(str(spend.cap_ratio_threshold))
    if threshold is None or ratio < threshold:
        return []
    return [
        _spend_candidate(
            facts,
            rule_key="spend_cap_approaching",
            scope="spend_cap",
            severity=SignalSeverity.WARNING,
            evidence={
                "message": (
                    "Amount spent has reached the configured share of the account spend cap "
                    "(raw values as Meta returned them when this signal opened)."
                ),
                "spend_cap_raw": latest.spend_cap_raw,
                "spend_cap_ratio_threshold": str(spend.cap_ratio_threshold),
                # Volatile: they move on every read without the condition changing, so they are
                # kept out of the material hash (see `VOLATILE_EVIDENCE_KEYS`).
                "amount_spent_raw": latest.amount_spent_raw,
                "spend_cap_used_ratio": amount_text(round(ratio, 4)),
            },
            observed_at=latest.observed_at,
            observation_id=latest.id,
        )
    ]


def _spend_currency_mismatch(facts: HealthFacts) -> list[SignalCandidate]:
    spend = facts.spend
    if spend is None or not spend.observable or spend.latest_success is None:
        return []
    observed = spend.observed_currency
    candidates: list[SignalCandidate] = []
    registry = (facts.account.currency or "").upper() or None
    if observed and registry and observed != registry:
        candidates.append(
            _spend_candidate(
                facts,
                rule_key="spend_currency_mismatch",
                scope="registry",
                severity=SignalSeverity.ATTENTION,
                evidence={
                    "message": (
                        "The currency Meta reports for this account differs from the currency "
                        "recorded in the registry."
                    ),
                    "observed_currency": observed,
                    "registry_currency": registry,
                },
                observed_at=spend.latest_success.observed_at,
                observation_id=spend.latest_success.id,
            )
        )
    if spend.insights_currency_conflict:
        candidates.append(
            _spend_candidate(
                facts,
                rule_key="spend_currency_mismatch",
                scope="insights",
                severity=SignalSeverity.ATTENTION,
                evidence={
                    "message": (
                        "Meta's daily spend rows report a currency different from the account's "
                        "own currency, so spend amounts for this account are not compared."
                    ),
                    "observed_currency": observed,
                    "insights_currencies": sorted(spend.insights_currencies),
                },
                observed_at=spend.latest_success.observed_at,
                observation_id=spend.latest_success.id,
            )
        )
    return candidates


# -------------------------------------------------------------------- platform status (S2)
#: Recorded statuses the mismatch rule compares. `unknown` (nobody checked), `warning` (the
#: recorder's own judgement) and `archived` are never compared: they are not a claim Meta's code
#: can contradict.
_COMPARABLE_REGISTRY = (AccountStatus.ACTIVE, AccountStatus.RESTRICTED, AccountStatus.DISABLED)

_FRESHNESS_SENTENCE = {
    "stale": " This is the last status Meta returned; no read carrying a status is recent.",
    "not_observable": (
        " No connection can read this account any more; this is the last status Meta returned."
    ),
}


def _platform_candidate(
    facts: HealthFacts,
    value: PlatformStatusFacts,
    *,
    rule_key: str,
    scope: str,
    severity: SignalSeverity,
    category: HealthCategory,
    message: str,
    extra: dict | None = None,
) -> SignalCandidate:
    """One candidate per rule per account. The evidence is an allowlist of Meta's codes and their
    labels, the observation they came from and when — never a raw provider payload (rule 26)."""
    return SignalCandidate(
        rule_key=rule_key,
        rule_version=1,
        scope=scope,
        severity=severity,
        category=category,
        # A platform observation, never an operator-recorded fact: the UI prints this source.
        source_type=HealthSourceType.PROVIDER_OBSERVATION,
        source_entity_type="ad_account_spend_observation",
        source_entity_id=value.observation_id,
        evidence={
            "message": message,
            "account_status_raw": value.account_status_raw,
            "platform_status": value.status.value,
            "disable_reason_raw": value.disable_reason_raw,
            "disable_reason": value.disable_reason.value if value.disable_reason else None,
            "spend_freshness": value.freshness.value,
            "reader_source": value.reader_source,
            "source": "Meta read-only observation (ad account node)",
            # Volatile (see `VOLATILE_EVIDENCE_KEYS`): they move on every read, or as the lookback
            # window slides, while the condition stays the same.
            "observation_id": value.observation_id,
            "observed_at": _iso(_aware(value.observed_at)),
            "observation_status": value.observation_status.value,
            "observation_failure_code": value.failure_code,
            "previous_account_status_raw": value.previous_account_status_raw,
            "previous_observed_at": _iso(_aware(value.previous_observed_at)),
            "since_observed_at": _iso(_aware(value.since_observed_at)),
            **(extra or {}),
        },
        observed_at=_aware(value.observed_at) or facts.now,
    )


def _status_sentence(value: PlatformStatusFacts) -> str:
    return (
        f"Meta returned account_status {value.account_status_raw} ({status_label(value.status)}) "
        f"for this account; disable reason: "
        f"{disable_reason_text(value.disable_reason, value.disable_reason_raw)}."
        + _FRESHNESS_SENTENCE.get(value.freshness.value, "")
    )


def _platform_blocking(facts: HealthFacts) -> list[SignalCandidate]:
    value = facts.platform_status
    # Whatever its age: an old "disabled" is still the last thing Meta said, and old is not
    # recovered (rules 4 and 28). The evidence carries the freshness.
    if value is None or value.status not in BLOCKING:
        return []
    return [
        _platform_candidate(
            facts,
            value,
            rule_key="platform_account_status_blocking",
            scope="platform_status",
            severity=SignalSeverity.CRITICAL,
            category=HealthCategory.ACCOUNT_STATUS,
            message=_status_sentence(value),
        )
    ]


def _platform_pending(facts: HealthFacts) -> list[SignalCandidate]:
    value = facts.platform_status
    if value is None or value.status not in PENDING:
        return []
    return [
        _platform_candidate(
            facts,
            value,
            rule_key="platform_account_status_pending",
            scope="platform_status",
            severity=SignalSeverity.WARNING,
            category=HealthCategory.ACCOUNT_STATUS,
            message=_status_sentence(value),
        )
    ]


def _platform_unrecognised(facts: HealthFacts) -> list[SignalCandidate]:
    value = facts.platform_status
    if value is None or value.status != PlatformAccountStatus.UNKNOWN:
        return []
    return [
        _platform_candidate(
            facts,
            value,
            rule_key="platform_account_status_unrecognised",
            scope="platform_status",
            severity=SignalSeverity.ATTENTION,
            category=HealthCategory.DATA_QUALITY,
            message=(
                f"Meta returned account_status {value.account_status_raw[:16]!r}, a code this "
                "product does not recognise, so the account's status on Meta is unknown."
                + _FRESHNESS_SENTENCE.get(value.freshness.value, "")
            ),
        )
    ]


def _platform_vs_recorded(facts: HealthFacts) -> list[SignalCandidate]:
    value = facts.platform_status
    # Only a current observation may prompt a change to the record: old data must not drive it.
    if value is None or not value.is_current or value.status == PlatformAccountStatus.UNKNOWN:
        return []
    recorded = facts.account.status
    if recorded not in _COMPARABLE_REGISTRY:
        return []
    meta_not_active = value.status in BLOCKING or value.status in PENDING
    differs = (
        value.status == PlatformAccountStatus.ACTIVE
        and recorded in (AccountStatus.RESTRICTED, AccountStatus.DISABLED)
    ) or (meta_not_active and recorded == AccountStatus.ACTIVE)
    if not differs:
        return []
    return [
        _platform_candidate(
            facts,
            value,
            rule_key="platform_vs_recorded_status_mismatch",
            scope="registry",
            severity=SignalSeverity.ATTENTION,
            category=HealthCategory.ACCOUNT_STATUS,
            message=(
                f"Meta returned account_status {value.account_status_raw} "
                f"({status_label(value.status)}), but the recorded account status is "
                f"{recorded.value}."
            ),
            extra={"registry_status": recorded.value},
        )
    ]


# ----------------------------------------------------------------- discovery (O3)
def _not_returned_by_latest_discovery(facts: HealthFacts) -> list[SignalCandidate]:
    """`missing_from_latest_discovery`, on the account. Only from a **complete** inventory.

    The latest usable run of the account's Business Manager decides, as in reconciliation: if it
    returned the account there is nothing to say; if its ad-account coverage was anything less
    than `complete`, absence means nothing and the rule is silent — even when an older complete
    run exists, because the newest look is the one that counts. Never archives, never changes the
    record: the next step is always a person's (rule 2).
    """
    discovery = facts.discovery
    if discovery is None or discovery.returned or not discovery.complete:
        return []
    return [
        SignalCandidate(
            rule_key="account_not_returned_by_latest_discovery",
            rule_version=1,
            scope="discovery",
            severity=SignalSeverity.ATTENTION,
            category=HealthCategory.DATA_QUALITY,
            source_type=HealthSourceType.PROVIDER_OBSERVATION,
            source_entity_type="business_manager_discovery_run",
            source_entity_id=discovery.run_id,
            evidence={
                "message": (
                    "Not returned by the latest completed discovery of Business Manager "
                    f"{discovery.business_manager_reference} (read as "
                    f"{discovery.read_as or 'an unknown identity'}). This says nothing about "
                    "whether Meta removed or restricted it."
                ),
                "discovery_run_id": discovery.run_id,
                "discovery_completed_at": _iso(_aware(discovery.completed_at)),
                "business_manager_reference": discovery.business_manager_reference,
                "read_as": discovery.read_as,
                "coverage_status": discovery.coverage_status.value,
                "source": "Meta read-only discovery",
            },
            observed_at=_aware(discovery.completed_at) or facts.now,
        )
    ]


_PLATFORM_RESOLUTION = (
    "Closes automatically when the latest Meta observation no longer shows this state. This is "
    "not a statement that the account is in good standing or will stay active."
)


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
    HealthRule(
        rule_key="spend_observation_missing_or_stale",
        version=1,
        name="Spend has not been read recently",
        description=(
            "Attention signal when an account that can be read has never had a successful spend "
            "read, its latest successful read is stale, or its last three reads failed."
        ),
        category=HealthCategory.SPEND,
        default_severity=SignalSeverity.ATTENTION,
        applicability="Non-archived accounts whose Business Manager has a production Meta connection with a reader.",
        input_facts=("ad_account_spend_observation.observed_at", "ad_account_spend_observation.status"),
        why_it_matters="Without a current read, the spend shown for this account may no longer match what Meta reports.",
        recommended_next_step=(
            "Open the account's Spend tab and read the failure code, then check the account in Ads "
            "Manager. An owner can request one read with \"Đọc lại từ Meta\"."
        ),
        resolution_guidance="Closes automatically once a successful spend read lands inside the freshness window.",
        evaluate=_spend_missing_or_stale,
    ),
    HealthRule(
        rule_key="spend_change_vs_baseline",
        version=1,
        name="Daily spend changed sharply versus its baseline",
        description=(
            "Warning when the latest complete day's spend differs from the median of at least the "
            "configured number of earlier complete days by the configured ratio and by the "
            "configured minimum amount for that currency."
        ),
        category=HealthCategory.SPEND,
        default_severity=SignalSeverity.WARNING,
        applicability=(
            "Accounts with a current spend read, a known timezone, an insights row for the latest "
            "complete day, enough baseline days, and a minimum amount configured for the currency."
        ),
        input_facts=("ad_account_spend_observation.daily_json", "ad_account_spend_observation.observed_timezone_name"),
        why_it_matters="A sudden rise or drop in daily spend is often the first visible sign that delivery changed.",
        recommended_next_step=(
            "Open Ads Manager and compare the named day's spend with the days before it; record "
            "what you find as an account event."
        ),
        resolution_guidance=(
            "Closes automatically when the latest complete day is no longer outside the range, or "
            "when there is no longer enough data to compare."
        ),
        evaluate=_spend_change_vs_baseline,
    ),
    HealthRule(
        rule_key="spend_cap_approaching",
        version=1,
        name="Amount spent is close to the spend cap",
        description=(
            "Warning when amount_spent / spend_cap, both as Meta returned them, reaches the "
            "configured ratio. Starts disabled: the units of these fields are confirmed at the "
            "first live read, after which the owner turns this check on."
        ),
        category=HealthCategory.SPEND,
        default_severity=SignalSeverity.WARNING,
        applicability="Accounts with a current spend read carrying a positive, parseable spend cap.",
        input_facts=("ad_account_spend_observation.amount_spent_raw", "ad_account_spend_observation.spend_cap_raw"),
        why_it_matters="When the cap is reached, the account stops delivering until the cap is raised or reset.",
        recommended_next_step=(
            "Check the account spending limit in Ads Manager's billing settings and decide there "
            "whether it needs changing."
        ),
        resolution_guidance="Closes automatically once the ratio falls below the threshold or the cap is removed.",
        evaluate=_spend_cap_approaching,
        enabled_by_default=False,
    ),
    HealthRule(
        rule_key="spend_currency_mismatch",
        version=1,
        name="Spend currency does not match",
        description=(
            "Attention signal when the currency Meta reports differs from the registry's currency, "
            "or Meta's daily rows report a different currency from the account node."
        ),
        category=HealthCategory.SPEND,
        default_severity=SignalSeverity.ATTENTION,
        applicability="Accounts with at least one successful spend read.",
        input_facts=("ad_account_spend_observation.observed_currency", "ad_account.currency"),
        why_it_matters="Spend is only ever grouped by currency; a wrong currency would put an amount in the wrong group.",
        recommended_next_step="Confirm the account currency in Ads Manager and correct the registry record if it is wrong.",
        resolution_guidance="Closes automatically once the currencies agree.",
        evaluate=_spend_currency_mismatch,
    ),
    HealthRule(
        rule_key="platform_account_status_blocking",
        version=1,
        name="Meta reports the account as not operable",
        description=(
            "Critical signal while the latest account_status Meta returned is disabled (2), "
            "pending closure (100) or closed (101) — whatever the age of that observation."
        ),
        category=HealthCategory.ACCOUNT_STATUS,
        default_severity=SignalSeverity.CRITICAL,
        applicability="Accounts with at least one stored observation carrying an account_status code.",
        input_facts=(
            "ad_account_spend_observation.observed_account_status",
            "ad_account_spend_observation.observed_disable_reason",
        ),
        why_it_matters="While Meta reports this state the account cannot run ads.",
        recommended_next_step=(
            "Open the account in Ads Manager / Business Settings, read Meta's notice, and record "
            "what you find as an account event."
        ),
        resolution_guidance=_PLATFORM_RESOLUTION,
        evaluate=_platform_blocking,
    ),
    HealthRule(
        rule_key="platform_account_status_pending",
        version=1,
        name="Meta reports a pending payment or review state",
        description=(
            "Warning while the latest account_status Meta returned is unsettled (3), pending risk "
            "review (7), pending settlement (8) or in grace period (9)."
        ),
        category=HealthCategory.ACCOUNT_STATUS,
        default_severity=SignalSeverity.WARNING,
        applicability="Accounts with at least one stored observation carrying an account_status code.",
        input_facts=("ad_account_spend_observation.observed_account_status",),
        why_it_matters="Meta reports something outstanding on billing or review for this account.",
        recommended_next_step=(
            "Check billing or the review notice in Ads Manager, and record what you find as an "
            "account event."
        ),
        resolution_guidance=_PLATFORM_RESOLUTION,
        evaluate=_platform_pending,
    ),
    HealthRule(
        rule_key="platform_account_status_unrecognised",
        version=1,
        name="Meta returned a status code this product does not recognise",
        description=(
            "Attention signal while the latest account_status Meta returned is not on the "
            "documented allowlist (for example 201, 202, or a non-numeric value)."
        ),
        category=HealthCategory.DATA_QUALITY,
        default_severity=SignalSeverity.ATTENTION,
        applicability="Accounts with at least one stored observation carrying an account_status code.",
        input_facts=("ad_account_spend_observation.observed_account_status",),
        why_it_matters="An unrecognised code is not a good state: the account's status on Meta is unknown.",
        recommended_next_step="Check the account's status in Ads Manager and record what you find as an account event.",
        resolution_guidance=_PLATFORM_RESOLUTION,
        evaluate=_platform_unrecognised,
    ),
    HealthRule(
        rule_key="platform_vs_recorded_status_mismatch",
        version=1,
        name="Meta's status differs from the recorded status",
        description=(
            "Attention signal when a current Meta observation and the recorded account status "
            "disagree: Meta active while the record says restricted or disabled, or Meta not "
            "active while the record says active. Unknown, warning and archived records are not "
            "compared."
        ),
        category=HealthCategory.ACCOUNT_STATUS,
        default_severity=SignalSeverity.ATTENTION,
        applicability="Accounts with a current observation carrying a recognised account_status code.",
        input_facts=("ad_account_spend_observation.observed_account_status", "ad_account.status"),
        why_it_matters="Readiness and preflight read the recorded status, so a record Meta contradicts can mislead them.",
        recommended_next_step=(
            "Compare both, then update the recorded status if Meta is right — with a note. This "
            "product never changes the record by itself."
        ),
        resolution_guidance=(
            "Closes automatically when the two agree, or when the Meta observation is no longer "
            "current."
        ),
        evaluate=_platform_vs_recorded,
    ),
    HealthRule(
        rule_key="account_not_returned_by_latest_discovery",
        version=1,
        name="Not returned by the latest complete discovery",
        description=(
            "Attention signal when the latest discovery of the account's Business Manager — a "
            "production run, inside the discovery freshness window, whose ad-account coverage was "
            "complete — did not return this account. Partial, incomplete or unknown coverage "
            "never raises it."
        ),
        category=HealthCategory.DATA_QUALITY,
        default_severity=SignalSeverity.ATTENTION,
        applicability=(
            "Non-archived accounts mapped to a Business Manager that has a recent production "
            "discovery run."
        ),
        input_facts=(
            "business_manager_discovery_run.ad_account_coverage_status",
            "discovered_ad_account_observation.external_account_id",
        ),
        why_it_matters=(
            "The reader could see every ad account of this Business Manager and this one was not "
            "among them: access may have been removed, or the account moved. It is not evidence "
            "that Meta deleted or restricted it."
        ),
        recommended_next_step=(
            "Check in Business Settings whether the account is still shared with this Business "
            "Manager and assigned to the reader. Archive it yourself if it no longer belongs here "
            "— this product never archives anything on its own."
        ),
        resolution_guidance=(
            "Closes automatically when a newer complete discovery returns it, when no complete "
            "discovery is left inside the window (which is not a clear result), or when the "
            "account is archived."
        ),
        evaluate=_not_returned_by_latest_discovery,
    ),
)

HEALTH_RULES_BY_KEY: dict[str, HealthRule] = {rule.rule_key: rule for rule in HEALTH_RULES_V1}
