"""Deterministic mapping from A2 facts to alert candidates (MINI-SPEC A3 §B).

Pure functions. A3 reads A2 records and normalises them into attention items; it never
re-evaluates a health rule, never changes a health severity, and never invents a fact.

The A2 severity is carried through into `source_snapshot` so the mapping stays explainable:
an `attention` health signal becomes an `info` alert, and the record says so.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.core.enums import AlertSeverity, AlertSourceType, SignalSeverity
from app.models.entities import AdAccount
from app.models.health import AccountHealthSignal, HealthEvaluationRun
from app.services.health_rules import HEALTH_RULES_BY_KEY

ALERT_POLICY_VERSION = "a3-v1"

#: A2 health severity → A3 alert severity. `attention` and `unknown` both become `info`:
#: they are worth showing in the Alert Center, and A3 v1 does not page anyone for them.
SEVERITY_MAP: dict[SignalSeverity, AlertSeverity] = {
    SignalSeverity.CRITICAL: AlertSeverity.CRITICAL,
    SignalSeverity.WARNING: AlertSeverity.WARNING,
    SignalSeverity.ATTENTION: AlertSeverity.INFO,
    SignalSeverity.UNKNOWN: AlertSeverity.INFO,
}

SEVERITY_RANK: dict[AlertSeverity, int] = {
    AlertSeverity.INFO: 0,
    AlertSeverity.WARNING: 1,
    AlertSeverity.CRITICAL: 2,
}

DEFAULT_NEXT_STEP = "Open the account in the dashboard and review the recorded evidence."


@dataclass(frozen=True)
class AlertCandidate:
    alert_key: str
    source_type: AlertSourceType
    source_entity_type: str
    source_entity_id: str | None
    ad_account_id: str | None
    severity: AlertSeverity
    category: str
    title: str
    summary: str
    observed_at: datetime
    source_snapshot: dict[str, Any] = field(default_factory=dict)
    #: The manual action offered to the operator, in the message and in the UI.
    recommended_next_step: str = DEFAULT_NEXT_STEP


def signal_alert_key(signal: AccountHealthSignal) -> str:
    return f"health_signal:{signal.ad_account_id}:{signal.signal_key}"


def evaluation_failure_alert_key(run: HealthEvaluationRun) -> str:
    # Keyed by cause, not by run: repeated failures of the same kind are one attention item,
    # not one per evaluation.
    return f"health_evaluation_run:{run.ad_account_id}:{run.error_code or 'unknown_error'}"


def from_health_signal(
    signal: AccountHealthSignal, account: AdAccount, *, health_status: str
) -> AlertCandidate:
    rule = HEALTH_RULES_BY_KEY.get(signal.rule_key)
    evidence = signal.evidence_json or {}
    severity = SEVERITY_MAP[signal.severity]
    return AlertCandidate(
        alert_key=signal_alert_key(signal),
        source_type=AlertSourceType.HEALTH_SIGNAL,
        source_entity_type="account_health_signal",
        source_entity_id=str(signal.id),
        ad_account_id=str(signal.ad_account_id),
        severity=severity,
        category=signal.category.value,
        title=rule.name if rule else signal.rule_key,
        summary=str(evidence.get("message", signal.rule_key)),
        observed_at=signal.observed_at,
        recommended_next_step=rule.recommended_next_step if rule else DEFAULT_NEXT_STEP,
        source_snapshot={
            "rule_key": signal.rule_key,
            "rule_version": signal.rule_version,
            "health_signal_id": str(signal.id),
            # Kept so nobody has to guess why an attention signal became an info alert.
            "health_severity": signal.severity.value,
            "health_signal_status": signal.status.value,
            "health_status": health_status,
            "readiness_status": account.readiness_status.value,
            "account_status": account.status.value,
            "category": signal.category.value,
            "why_it_matters": rule.why_it_matters if rule else None,
            "observed_at": signal.observed_at.isoformat() if signal.observed_at else None,
        },
    )


def from_evaluation_failure(
    run: HealthEvaluationRun, account: AdAccount, *, health_status: str
) -> AlertCandidate:
    """A failed evaluation means the account's condition is not known — worth a warning.

    Only the allowlisted error *code* is carried. `error_summary` may contain an exception
    message, so it is deliberately left out of both the alert and the message.
    """
    return AlertCandidate(
        alert_key=evaluation_failure_alert_key(run),
        source_type=AlertSourceType.HEALTH_EVALUATION_RUN,
        source_entity_type="health_evaluation_run",
        source_entity_id=str(run.id),
        ad_account_id=str(run.ad_account_id) if run.ad_account_id else None,
        severity=AlertSeverity.WARNING,
        category="data_quality",
        title="Health evaluation did not complete",
        summary=(
            "The last health evaluation for this account failed, so its current condition is "
            f"not known (error code: {run.error_code or 'unknown_error'})."
        ),
        observed_at=run.started_at,
        recommended_next_step=(
            "Recalculate health for this account. If it fails again, check the evaluation-run "
            "history on the Health tab."
        ),
        source_snapshot={
            "health_evaluation_run_id": str(run.id),
            "error_code": run.error_code,
            "trigger_type": run.trigger_type.value,
            "engine_version": run.engine_version,
            "health_status": health_status,
            "readiness_status": account.readiness_status.value,
            "started_at": run.started_at.isoformat() if run.started_at else None,
        },
    )


def is_escalation(previous: AlertSeverity, candidate: AlertSeverity) -> bool:
    return SEVERITY_RANK[candidate] > SEVERITY_RANK[previous]
