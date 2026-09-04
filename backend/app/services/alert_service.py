"""Alert Center services (MINI-SPEC A3 §B, §F).

Three responsibilities, kept apart:

* `AlertPolicyService` — the workspace delivery policy. It never holds a secret.
* `AlertDerivationService` — turns current A2 facts into alerts, deterministically.
* `AlertLifecycleService` — the operator actions, none of which touch a source record.

The rule that shapes all of it: an alert is a *view* of an A2 fact plus a workflow state.
Acknowledging, resolving or suppressing an alert changes the workflow state and nothing else —
the health signal, the account event and the checklist item behind it are left exactly as they
were, and a test proves it.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, time

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import (
    ACTIVE_ALERT_STATUSES,
    ACTIVE_SIGNAL_STATUSES,
    AlertSeverity,
    AlertSourceType,
    AlertStatus,
    EvaluationRunStatus,
)
from app.core.errors import ConflictError, ValidationError
from app.core.redaction import redact
from app.models.alerts import Alert, AlertPolicy
from app.models.entities import AdAccount
from app.models.health import AccountHealthSignal, HealthEvaluationRun
from app.services.alert_rules import (
    AlertCandidate,
    from_evaluation_failure,
    from_health_signal,
    is_escalation,
)
from app.services.audit import AuditLogService
from app.services.base import snapshot as orm_snapshot
from app.services.quiet_hours import is_valid_timezone

logger = logging.getLogger(__name__)

#: A3 §C policy version 1. Deliberately conservative: nothing pages anyone for an attention
#: item, and the quiet window is on by default.
DEFAULT_POLICY = {
    "name": "Default policy",
    "enabled": True,
    "timezone": "Asia/Ho_Chi_Minh",
    "quiet_hours_enabled": True,
    "quiet_hours_start": time(23, 0),
    "quiet_hours_end": time(7, 0),
    "critical_bypasses_quiet_hours": True,
    "warning_telegram_enabled": True,
    "attention_telegram_enabled": False,
    "reminder_enabled": False,
    "reminder_interval_hours": None,
    "max_reminders_per_alert": None,
    "telegram_chat_id": None,
}


class AlertPolicyService:
    def __init__(self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit

    def get(self) -> AlertPolicy | None:
        return self.session.execute(
            sa.select(AlertPolicy).where(AlertPolicy.workspace_id == self.workspace_id)
        ).scalar_one_or_none()

    def get_or_create(self) -> AlertPolicy:
        """Seeded lazily on first access with safe defaults and **no recipient**.

        A policy that arrives pre-pointed at a chat would be a surprise; this one is inert until
        the owner configures a destination.
        """
        policy = self.get()
        if policy is not None:
            return policy
        policy = AlertPolicy(workspace_id=self.workspace_id, **DEFAULT_POLICY)
        self.session.add(policy)
        self.session.flush()
        self.audit.record(
            action="alert_policy.created",
            entity_type="alert_policy",
            entity_id=policy.id,
            after=orm_snapshot(policy),
            metadata={"seeded": True},
        )
        return policy

    def update(self, payload: dict, *, actor_id: uuid.UUID | None) -> AlertPolicy:
        policy = self.get_or_create()
        timezone_name = payload.get("timezone", policy.timezone)
        if not is_valid_timezone(timezone_name):
            raise ValidationError(
                "Timezone must be a valid IANA identifier, for example Asia/Ho_Chi_Minh.",
                details={"field": "timezone"},
            )
        quiet_enabled = payload.get("quiet_hours_enabled", policy.quiet_hours_enabled)
        start = payload.get("quiet_hours_start", policy.quiet_hours_start)
        end = payload.get("quiet_hours_end", policy.quiet_hours_end)
        if quiet_enabled and (start is None or end is None):
            raise ValidationError(
                "Quiet hours need both a start and an end time.",
                details={"field": "quiet_hours_start"},
            )
        if quiet_enabled and start == end:
            raise ValidationError(
                "Quiet hours cannot start and end at the same time.",
                details={"field": "quiet_hours_end"},
            )
        if payload.get("reminder_enabled") and not payload.get(
            "reminder_interval_hours", policy.reminder_interval_hours
        ):
            raise ValidationError(
                "Reminders need an interval in hours.", details={"field": "reminder_interval_hours"}
            )

        before = orm_snapshot(policy)
        for key, value in payload.items():
            setattr(policy, key, value)
        policy.updated_by = actor_id
        self.session.flush()
        self.audit.record(
            action="alert_policy.updated",
            entity_type="alert_policy",
            entity_id=policy.id,
            before=before,
            after=orm_snapshot(policy),
        )
        return policy


@dataclass
class DerivationResult:
    created: int = 0
    updated: int = 0
    escalated: int = 0
    resolved: int = 0
    unsuppressed: int = 0
    planned_delivery_ids: list[str] | None = None

    def to_dict(self) -> dict:
        return {
            "alerts_created": self.created,
            "alerts_updated": self.updated,
            "alerts_escalated": self.escalated,
            "alerts_resolved": self.resolved,
            "alerts_unsuppressed": self.unsuppressed,
        }


class AlertDerivationService:
    def __init__(
        self,
        session: Session,
        workspace_id: uuid.UUID,
        audit: AuditLogService,
        actor_id: uuid.UUID | None = None,
    ) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit
        self.actor_id = actor_id
        self.policies = AlertPolicyService(session, workspace_id, audit)

    # ------------------------------------------------------------------- reads
    def active_alerts_for_account(self, ad_account_id: uuid.UUID) -> list[Alert]:
        return list(
            self.session.execute(
                sa.select(Alert).where(
                    Alert.workspace_id == self.workspace_id,
                    Alert.ad_account_id == ad_account_id,
                    Alert.status.in_(list(ACTIVE_ALERT_STATUSES)),
                )
            ).scalars().all()
        )

    def _candidates(self, account: AdAccount, health_status: str) -> list[AlertCandidate]:
        signals = list(
            self.session.execute(
                sa.select(AccountHealthSignal).where(
                    AccountHealthSignal.ad_account_id == account.id,
                    AccountHealthSignal.workspace_id == self.workspace_id,
                    AccountHealthSignal.status.in_(list(ACTIVE_SIGNAL_STATUSES)),
                )
            ).scalars().all()
        )
        candidates = [
            from_health_signal(signal, account, health_status=health_status) for signal in signals
        ]

        # A failure only matters while it is the *latest* word on this account. A run that failed
        # yesterday and succeeded since is history, not an open issue.
        latest_run = self.session.execute(
            sa.select(HealthEvaluationRun)
            .where(
                HealthEvaluationRun.ad_account_id == account.id,
                HealthEvaluationRun.workspace_id == self.workspace_id,
                HealthEvaluationRun.status.in_(
                    [EvaluationRunStatus.SUCCEEDED, EvaluationRunStatus.FAILED]
                ),
            )
            .order_by(HealthEvaluationRun.started_at.desc(), HealthEvaluationRun.id.desc())
            .limit(1)
        ).scalar_one_or_none()
        if (
            latest_run is not None
            and latest_run.status == EvaluationRunStatus.FAILED
            and account.archived_at is None
        ):
            candidates.append(from_evaluation_failure(latest_run, account, health_status=health_status))

        candidates.sort(key=lambda candidate: candidate.alert_key)
        return candidates

    # -------------------------------------------------------------- lifecycle
    def _expire_lapsed_suppressions(self, alerts: list[Alert], now: datetime) -> int:
        count = 0
        for alert in alerts:
            if alert.status != AlertStatus.SUPPRESSED:
                continue
            expires = alert.suppression_expires_at
            if expires is None:
                continue
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=UTC)
            if expires > now:
                continue
            before = orm_snapshot(alert)
            alert.status = alert.status_before_suppression or AlertStatus.OPEN
            alert.status_before_suppression = None
            alert.suppressed_at = None
            alert.suppressed_by = None
            alert.suppression_expires_at = None
            self.session.flush()
            self.audit.record(
                action="alert.suppression_expired",
                entity_type="alert",
                entity_id=alert.id,
                before=before,
                after=orm_snapshot(alert),
                metadata={"restored_status": alert.status.value},
            )
            logger.info("alert_unsuppressed", extra={"reason": "suppression_expired"})
            count += 1
        return count

    def _create(self, candidate: AlertCandidate, now: datetime) -> Alert:
        alert = Alert(
            workspace_id=self.workspace_id,
            ad_account_id=uuid.UUID(candidate.ad_account_id) if candidate.ad_account_id else None,
            source_type=candidate.source_type,
            source_entity_type=candidate.source_entity_type,
            source_entity_id=candidate.source_entity_id,
            alert_key=candidate.alert_key,
            active_key=candidate.alert_key,
            category=candidate.category,
            severity=candidate.severity,
            status=AlertStatus.OPEN,
            title=candidate.title,
            summary=candidate.summary,
            source_snapshot_json=redact(
                {**candidate.source_snapshot, "recommended_next_step": candidate.recommended_next_step}
            ),
            first_observed_at=candidate.observed_at or now,
            last_observed_at=now,
        )
        self.session.add(alert)
        self.session.flush()
        self.audit.record(
            action="alert.created",
            entity_type="alert",
            entity_id=alert.id,
            after=orm_snapshot(alert),
            metadata={"source_type": candidate.source_type.value, "severity": candidate.severity.value},
        )
        logger.info(
            "alert_created",
            extra={"severity": candidate.severity.value, "source_type": candidate.source_type.value},
        )
        return alert

    def _resolve_from_source(self, alert: Alert, now: datetime) -> None:
        before = orm_snapshot(alert)
        alert.status = AlertStatus.RESOLVED
        alert.active_key = None
        alert.resolved_at = now
        alert.resolved_by = None  # closed by the source condition ending, not by a person
        alert.resolution_reason = "The source condition is no longer active."
        self.session.flush()
        self.audit.record(
            action="alert.resolved",
            entity_type="alert",
            entity_id=alert.id,
            before=before,
            after=orm_snapshot(alert),
            metadata={"resolved_by": "source_condition"},
        )
        logger.info("alert_resolved", extra={"resolved_by": "source_condition"})

    def derive_for_account(
        self, account: AdAccount, *, health_status: str, now: datetime | None = None
    ) -> tuple[DerivationResult, list[tuple[Alert, str]]]:
        """Reconcile alerts with the account's current A2 facts.

        Returns the counters plus the alerts that need a delivery planned, with the reason. The
        planning itself is a separate step so derivation stays a pure reconciliation.
        """
        now = now or datetime.now(UTC)
        result = DerivationResult()
        to_plan: list[tuple[Alert, str]] = []

        existing = self.active_alerts_for_account(account.id)
        result.unsuppressed = self._expire_lapsed_suppressions(existing, now)
        by_key = {alert.alert_key: alert for alert in existing}
        candidates = self._candidates(account, health_status)
        seen: set[str] = set()

        for candidate in candidates:
            seen.add(candidate.alert_key)
            alert = by_key.get(candidate.alert_key)
            if alert is None:
                alert = self._create(candidate, now)
                to_plan.append((alert, "initial"))
                result.created += 1
                continue

            before = orm_snapshot(alert)
            escalated = is_escalation(alert.severity, candidate.severity)
            alert.severity = candidate.severity
            alert.title = candidate.title
            alert.summary = candidate.summary
            alert.source_entity_id = candidate.source_entity_id
            alert.source_snapshot_json = redact(
                {**candidate.source_snapshot, "recommended_next_step": candidate.recommended_next_step}
            )
            alert.last_observed_at = now
            self.session.flush()

            if escalated:
                self.audit.record(
                    action="alert.escalated",
                    entity_type="alert",
                    entity_id=alert.id,
                    before=before,
                    after=orm_snapshot(alert),
                    metadata={"to_severity": candidate.severity.value},
                )
                logger.info("alert_updated", extra={"escalated": True})
                to_plan.append((alert, "escalation"))
                result.escalated += 1
            else:
                result.updated += 1

        for key, alert in by_key.items():
            if key in seen:
                continue
            self._resolve_from_source(alert, now)
            result.resolved += 1

        return result, to_plan


class AlertLifecycleService:
    """Operator actions. Every one of them requires words, and none of them touch a source row."""

    def __init__(
        self,
        session: Session,
        workspace_id: uuid.UUID,
        audit: AuditLogService,
        actor_id: uuid.UUID | None,
    ) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit
        self.actor_id = actor_id

    @staticmethod
    def _require_text(value: str | None, *, field: str, label: str) -> str:
        text = (value or "").strip()
        if not text:
            raise ValidationError(f"{label} is required.", details={"field": field})
        return text

    def _record(self, alert: Alert, before: dict, action: str, metadata: dict | None = None) -> Alert:
        self.session.flush()
        self.audit.record(
            action=action,
            entity_type="alert",
            entity_id=alert.id,
            before=before,
            after=orm_snapshot(alert),
            metadata=metadata,
        )
        logger.info(action.replace(".", "_"), extra={"severity": alert.severity.value})
        return alert

    def acknowledge(self, alert: Alert, *, note: str) -> Alert:
        text = self._require_text(note, field="note", label="An acknowledgement note")
        if alert.status != AlertStatus.OPEN:
            raise ConflictError(
                f"Only an open alert can be acknowledged; this one is {alert.status.value}."
            )
        before = orm_snapshot(alert)
        alert.status = AlertStatus.ACKNOWLEDGED
        alert.acknowledged_at = datetime.now(UTC)
        alert.acknowledged_by = self.actor_id
        alert.acknowledgement_note = text
        # active_key stays: acknowledging records that the operator saw it. The source condition
        # is untouched and the alert keeps counting.
        return self._record(alert, before, "alert.acknowledged")

    def resolve(self, alert: Alert, *, reason: str) -> Alert:
        text = self._require_text(reason, field="reason", label="A resolution reason")
        if alert.status not in ACTIVE_ALERT_STATUSES:
            raise ConflictError(
                f"Only an active alert can be resolved; this one is {alert.status.value}."
            )
        before = orm_snapshot(alert)
        alert.status = AlertStatus.RESOLVED
        alert.active_key = None
        alert.resolved_at = datetime.now(UTC)
        alert.resolved_by = self.actor_id
        alert.resolution_reason = text
        return self._record(alert, before, "alert.resolved", {"resolved_by": "operator"})

    def reopen(self, alert: Alert, *, reason: str) -> Alert:
        text = self._require_text(reason, field="reason", label="A reason")
        if alert.status in ACTIVE_ALERT_STATUSES:
            raise ConflictError("This alert is already active.")
        clash = self.session.execute(
            sa.select(Alert.id).where(
                Alert.workspace_id == self.workspace_id, Alert.active_key == alert.alert_key
            )
        ).first()
        if clash is not None:
            raise ConflictError(
                "An active alert already exists for this source condition.",
                details={"alert_key": alert.alert_key},
            )
        before = orm_snapshot(alert)
        alert.status = AlertStatus.OPEN
        alert.active_key = alert.alert_key
        alert.resolved_at = None
        alert.resolved_by = None
        alert.resolution_reason = None
        return self._record(alert, before, "alert.reopened", {"reason": text})

    def suppress(self, alert: Alert, *, reason: str, expires_at: datetime) -> Alert:
        text = self._require_text(reason, field="reason", label="A suppression reason")
        if expires_at is None:
            raise ValidationError(
                "Suppression must have an expiry; it cannot be indefinite.",
                details={"field": "expires_at"},
            )
        moment = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=UTC)
        if moment <= datetime.now(UTC):
            raise ValidationError(
                "Suppression expiry must be in the future.", details={"field": "expires_at"}
            )
        if alert.status not in (AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED):
            raise ConflictError(
                f"Only an open or acknowledged alert can be suppressed; this one is {alert.status.value}."
            )
        before = orm_snapshot(alert)
        alert.status_before_suppression = alert.status
        alert.status = AlertStatus.SUPPRESSED
        alert.suppressed_at = datetime.now(UTC)
        alert.suppressed_by = self.actor_id
        alert.suppression_reason = text
        alert.suppression_expires_at = moment
        # active_key is kept on purpose: suppression mutes delivery, not visibility or history.
        return self._record(
            alert,
            before,
            "alert.suppressed",
            {"expires_at": moment.isoformat(), "severity": alert.severity.value},
        )

    def unsuppress(self, alert: Alert, *, note: str | None) -> Alert:
        if alert.status != AlertStatus.SUPPRESSED:
            raise ConflictError("This alert is not suppressed.")
        before = orm_snapshot(alert)
        alert.status = alert.status_before_suppression or AlertStatus.OPEN
        alert.status_before_suppression = None
        alert.suppressed_at = None
        alert.suppressed_by = None
        alert.suppression_expires_at = None
        return self._record(
            alert, before, "alert.unsuppressed", {"note": (note or "").strip() or None}
        )


def severity_of(alert: Alert) -> AlertSeverity:
    return alert.severity


def source_label(alert: Alert) -> str:
    return (
        "Health signal"
        if alert.source_type == AlertSourceType.HEALTH_SIGNAL
        else "Health evaluation"
    )
