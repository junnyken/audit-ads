"""Read-time presentation of a stored health snapshot.

A snapshot records what was true when it was written. Without a scheduler nothing re-writes it
as it ages, so freshness is derived on every read and a `clear_signals` snapshot that has gone
stale is presented as `unknown` instead. That is the difference between "we checked and found
nothing" and "we have not checked lately", and A2 requires the second one to be visible.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from app.core.config import get_settings
from app.core.enums import HealthFreshness, HealthStatus
from app.models.entities import AdAccount
from app.models.health import AccountHealthSnapshot
from app.services.health_engine import HEALTH_STATUS_DESCRIPTION, derive_freshness
from app.services.health_rules import ENGINE_VERSION


def _reason(code: str, message: str, *, severity: str = "unknown") -> dict[str, Any]:
    return {
        "code": code,
        "severity": severity,
        "signal_id": None,
        "message": message,
        "observed_at": "",
        "rule_key": code,
        "rule_version": 1,
        "status": "informational",
    }


def present_snapshot(
    account: AdAccount,
    snapshot: AccountHealthSnapshot | None,
    *,
    now: datetime,
) -> dict[str, Any]:
    settings = get_settings()
    archived = account.archived_at is not None

    if archived:
        return {
            "health_status": HealthStatus.UNKNOWN.value,
            "freshness_status": HealthFreshness.NOT_APPLICABLE.value,
            "evaluated_at": snapshot.last_evaluated_at.isoformat() if snapshot and snapshot.last_evaluated_at else None,
            "engine_version": snapshot.engine_version if snapshot else ENGINE_VERSION,
            "counts": {"critical": 0, "warning": 0, "attention": 0, "unknown": 0},
            "summary_reasons": [
                _reason(
                    "account_archived",
                    "Archived account is excluded from active health evaluation.",
                )
            ],
            "status_description": HEALTH_STATUS_DESCRIPTION[HealthStatus.UNKNOWN.value],
        }

    if snapshot is None:
        return {
            "health_status": HealthStatus.UNKNOWN.value,
            "freshness_status": HealthFreshness.UNKNOWN.value,
            "evaluated_at": None,
            "engine_version": ENGINE_VERSION,
            "counts": {"critical": 0, "warning": 0, "attention": 0, "unknown": 0},
            "summary_reasons": [
                _reason(
                    "health_never_evaluated",
                    "Health has never been evaluated for this account, so nothing is known yet.",
                )
            ],
            "status_description": HEALTH_STATUS_DESCRIPTION[HealthStatus.UNKNOWN.value],
        }

    freshness = derive_freshness(
        snapshot.last_evaluated_at,
        now=now,
        stale_after_hours=settings.health_evaluation_stale_after_hours,
    )
    summary = dict(snapshot.health_summary_json or {})
    status = snapshot.health_status.value
    reasons = list(summary.get("summary_reasons", []))

    if freshness != HealthFreshness.CURRENT and status == HealthStatus.CLEAR_SIGNALS.value:
        status = HealthStatus.UNKNOWN.value
        reasons = [
            _reason(
                "health_evaluation_stale",
                "The last health evaluation is not current, so this is reported as unknown "
                "rather than clear.",
            )
        ] + reasons

    return {
        "health_status": status,
        "freshness_status": freshness.value,
        "evaluated_at": snapshot.last_evaluated_at.isoformat() if snapshot.last_evaluated_at else None,
        "engine_version": snapshot.engine_version,
        "counts": {
            "critical": snapshot.open_critical_count,
            "warning": snapshot.open_warning_count,
            "attention": snapshot.open_attention_count,
            "unknown": snapshot.open_unknown_count,
        },
        "summary_reasons": reasons,
        "status_description": HEALTH_STATUS_DESCRIPTION[status],
    }
