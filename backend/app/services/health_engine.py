"""Deterministic health engine (MINI-SPEC A2 §C).

Pure functions over facts. No database access, no clock reads except the one passed in, no
randomness — the same source records and the same rule version always produce the same result.

Two responsibilities live here:

* turning A1 facts into signal candidates, in a stable order;
* rolling active signals up into one health status with its reasons.

The rollup deliberately has no numeric score. A2 forbids one, and a number would hide exactly
the thing the operator needs: which fact, from which source, at what time.
"""
from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from typing import Any

from app.core.enums import (
    ACTIVE_SIGNAL_STATUSES,
    HealthFreshness,
    HealthStatus,
    SignalSeverity,
)
from app.services.health_rules import (
    ENGINE_VERSION,
    HEALTH_RULES_V1,
    HealthFacts,
    SignalCandidate,
)

#: Worst first. Used for ordering reasons and for the rollup decision.
SEVERITY_RANK: dict[str, int] = {
    SignalSeverity.CRITICAL.value: 0,
    SignalSeverity.WARNING.value: 1,
    SignalSeverity.ATTENTION.value: 2,
    SignalSeverity.UNKNOWN.value: 3,
}

#: The one sentence that may describe `clear_signals`. Never "safe", never "approved".
CLEAR_SIGNALS_LABEL = "No current issues found by configured checks"

HEALTH_STATUS_DESCRIPTION: dict[str, str] = {
    HealthStatus.CRITICAL.value: "At least one unresolved critical signal is open on this account.",
    HealthStatus.WARNING.value: "At least one unresolved warning signal is open, and no critical signal is open.",
    HealthStatus.ATTENTION_NEEDED.value: "No warning or critical signal is open, but something needs attention.",
    HealthStatus.UNKNOWN.value: (
        "There is not enough current evidence to assess this account. Unknown is not a clear result."
    ),
    HealthStatus.CLEAR_SIGNALS.value: (
        f"{CLEAR_SIGNALS_LABEL}. This describes the configured checks only; it is not a platform "
        "approval and it is not a guarantee against restriction."
    ),
}


@dataclass
class HealthReason:
    code: str
    severity: str
    signal_id: str | None
    message: str
    observed_at: str
    rule_key: str
    rule_version: int
    status: str


@dataclass
class HealthRollup:
    health_status: str
    freshness_status: str
    evaluated_at: datetime
    engine_version: str
    counts: dict[str, int] = field(default_factory=dict)
    summary_reasons: list[HealthReason] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "health_status": self.health_status,
            "freshness_status": self.freshness_status,
            "evaluated_at": self.evaluated_at.isoformat(),
            "engine_version": self.engine_version,
            "counts": self.counts,
            "summary_reasons": [asdict(reason) for reason in self.summary_reasons],
        }


def build_candidates(facts: HealthFacts, enabled_rule_keys: set[str]) -> list[SignalCandidate]:
    """Evaluate enabled rules in registry order and return candidates in a stable order.

    A disabled rule simply produces nothing; it never erases what it produced before
    (A2 Guardrail 22).
    """
    candidates: list[SignalCandidate] = []
    for rule in HEALTH_RULES_V1:
        if rule.rule_key not in enabled_rule_keys:
            continue
        candidates.extend(rule.evaluate(facts))
    candidates.sort(key=lambda c: (SEVERITY_RANK[c.severity.value], c.rule_key, c.scope))
    return candidates


def derive_freshness(
    last_evaluated_at: datetime | None,
    *,
    now: datetime,
    stale_after_hours: int,
    archived: bool = False,
) -> HealthFreshness:
    """Freshness is derived at read time, not frozen at write time.

    Without a scheduler nothing would otherwise mark an old snapshot stale, and a snapshot that
    silently keeps saying "current" a week later is exactly the misleading state A2 §25 bans.
    """
    if archived:
        return HealthFreshness.NOT_APPLICABLE
    if last_evaluated_at is None:
        return HealthFreshness.UNKNOWN
    if last_evaluated_at.tzinfo is None:
        last_evaluated_at = last_evaluated_at.replace(tzinfo=now.tzinfo)
    if last_evaluated_at < now - timedelta(hours=stale_after_hours):
        return HealthFreshness.STALE
    return HealthFreshness.CURRENT


def _reason_from_signal(signal: Any) -> HealthReason:
    evidence = signal.evidence_json or {}
    observed_at = signal.observed_at
    return HealthReason(
        code=signal.rule_key,
        severity=signal.severity.value if hasattr(signal.severity, "value") else str(signal.severity),
        signal_id=str(signal.id),
        message=str(evidence.get("message", signal.rule_key)),
        observed_at=observed_at.isoformat() if observed_at else "",
        rule_key=signal.rule_key,
        rule_version=signal.rule_version,
        status=signal.status.value if hasattr(signal.status, "value") else str(signal.status),
    )


def roll_up(
    active_signals: Iterable[Any],
    *,
    now: datetime,
    freshness: HealthFreshness,
    archived: bool = False,
    evaluation_failed: bool = False,
) -> HealthRollup:
    """Health rollup, algorithm version 1 (A2 §C).

    Acknowledged signals still count: acknowledging something is a record that you saw it, not
    a claim that it is fixed (A2 Guardrail 11).
    """
    signals: Sequence[Any] = [
        signal for signal in active_signals if signal.status in ACTIVE_SIGNAL_STATUSES
    ]
    counts = {
        "critical": sum(1 for s in signals if s.severity == SignalSeverity.CRITICAL),
        "warning": sum(1 for s in signals if s.severity == SignalSeverity.WARNING),
        "attention": sum(1 for s in signals if s.severity == SignalSeverity.ATTENTION),
        "unknown": sum(1 for s in signals if s.severity == SignalSeverity.UNKNOWN),
    }
    reasons = [
        _reason_from_signal(signal)
        for signal in sorted(
            signals,
            key=lambda s: (
                SEVERITY_RANK[s.severity.value],
                s.rule_key,
                s.observed_at.isoformat() if s.observed_at else "",
                str(s.id),
            ),
        )
    ]

    def build(status: HealthStatus, extra: HealthReason | None = None) -> HealthRollup:
        return HealthRollup(
            health_status=status.value,
            freshness_status=freshness.value,
            evaluated_at=now,
            engine_version=ENGINE_VERSION,
            counts=counts,
            summary_reasons=([extra] + reasons) if extra else reasons,
        )

    # 1. Archived accounts are excluded from active assessment.
    if archived:
        return build(
            HealthStatus.UNKNOWN,
            HealthReason(
                code="account_archived",
                severity=SignalSeverity.UNKNOWN.value,
                signal_id=None,
                message="Archived account is excluded from active health evaluation.",
                observed_at=now.isoformat(),
                rule_key="account_archived",
                rule_version=1,
                status="informational",
            ),
        )

    # 3. A failed evaluation must never leave a previous clear result standing.
    if evaluation_failed:
        return build(
            HealthStatus.UNKNOWN,
            HealthReason(
                code="health_evaluation_failed",
                severity=SignalSeverity.UNKNOWN.value,
                signal_id=None,
                message=(
                    "The last health evaluation did not complete, so the current condition of "
                    "this account is not known."
                ),
                observed_at=now.isoformat(),
                rule_key="health_evaluation_failed",
                rule_version=1,
                status="informational",
            ),
        )

    # 4-6. Worst active severity wins.
    if counts["critical"]:
        return build(HealthStatus.CRITICAL)
    if counts["warning"]:
        return build(HealthStatus.WARNING)
    if counts["attention"]:
        return build(HealthStatus.ATTENTION_NEEDED)

    # Between attention and clear: an unknown-severity signal means the engine could not assess.
    if counts["unknown"]:
        return build(HealthStatus.UNKNOWN)

    # 7. Clear only when the evaluation itself is current.
    if freshness == HealthFreshness.CURRENT:
        return build(HealthStatus.CLEAR_SIGNALS)

    # 8. Otherwise the absence of findings is not a finding of absence.
    return build(
        HealthStatus.UNKNOWN,
        HealthReason(
            code="health_evaluation_stale",
            severity=SignalSeverity.UNKNOWN.value,
            signal_id=None,
            message=(
                "No open signals, but the last evaluation is not current, so this is reported as "
                "unknown rather than clear."
            ),
            observed_at=now.isoformat(),
            rule_key="health_evaluation_stale",
            rule_version=1,
            status="informational",
        ),
    )
