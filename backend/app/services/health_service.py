"""Account-health services (MINI-SPEC A2 §D).

These are the only places that write health data. They reuse A1 wholesale: the same session and
transaction, the same `AuditLogService`, the same workspace scoping, the same soft-archive
semantics. Nothing here writes to an A1 table — health observes A1, it never edits it.
"""
from __future__ import annotations

import hashlib
import json
import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.context import get_request_id
from app.core.enums import (
    ACTIVE_SIGNAL_STATUSES,
    EvaluationRunStatus,
    EvaluationTrigger,
    HealthFreshness,
    HealthStatus,
    SignalStatus,
)
from app.core.errors import ConflictError, ValidationError
from app.core.redaction import redact
from app.models.entities import AccountEvent, AdAccount, ReadinessChecklistItem
from app.models.health import (
    AccountHealthSignal,
    AccountHealthSnapshot,
    HealthEvaluationRun,
    HealthRuleDefinition,
)
from app.services.alert_triggers import derive_alerts_safe
from app.services.audit import AuditLogService
from app.services.base import snapshot as orm_snapshot
from app.services.health_engine import HealthRollup, build_candidates, derive_freshness, roll_up
from app.services.health_rules import (
    ENGINE_VERSION,
    HEALTH_RULES_BY_KEY,
    HEALTH_RULES_V1,
    HealthFacts,
    SignalCandidate,
)
from app.services.rollup import ReadinessRollupService

logger = logging.getLogger(__name__)

#: Evidence keys that move without the underlying fact changing. Excluded from the material
#: hash so an unrelated edit to an account does not supersede a signal that says the same thing.
VOLATILE_EVIDENCE_KEYS = frozenset({"recorded_at"})


def evidence_hash(evidence: dict[str, Any]) -> str:
    material = {k: v for k, v in evidence.items() if k not in VOLATILE_EVIDENCE_KEYS}
    encoded = json.dumps(material, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode()).hexdigest()


class HealthRuleRegistryService:
    """Materialises the code registry into rows so rules can be enabled, disabled and versioned.

    Seeding is lazy and idempotent rather than baked into the migration: one definition of the
    rule set (the typed registry) cannot drift from a second copy written in SQL.
    """

    def __init__(self, session: Session, workspace_id: uuid.UUID) -> None:
        self.session = session
        self.workspace_id = workspace_id

    def ensure_seeded(self) -> list[HealthRuleDefinition]:
        existing = {
            (row.rule_key, row.version): row
            for row in self.session.execute(
                sa.select(HealthRuleDefinition).where(HealthRuleDefinition.workspace_id.is_(None))
            ).scalars().all()
        }
        created = False
        for rule in HEALTH_RULES_V1:
            if (rule.rule_key, rule.version) in existing:
                continue
            row = HealthRuleDefinition(
                workspace_id=None,
                rule_key=rule.rule_key,
                version=rule.version,
                name=rule.name,
                description=rule.description,
                category=rule.category,
                enabled=True,
                severity=rule.default_severity,
                source_requirements_json={"input_facts": list(rule.input_facts)},
                condition_config_json=dict(rule.condition_config),
                freshness_policy_json=None,
                resolution_guidance=rule.resolution_guidance,
            )
            self.session.add(row)
            created = True
        if created:
            self.session.flush()
        return self.list_definitions()

    def list_definitions(self) -> list[HealthRuleDefinition]:
        rows = self.session.execute(
            sa.select(HealthRuleDefinition)
            .where(
                sa.or_(
                    HealthRuleDefinition.workspace_id.is_(None),
                    HealthRuleDefinition.workspace_id == self.workspace_id,
                ),
                HealthRuleDefinition.archived_at.is_(None),
            )
            .order_by(HealthRuleDefinition.rule_key, HealthRuleDefinition.version)
        ).scalars().all()
        return list(rows)

    def enabled_definitions(self) -> dict[str, HealthRuleDefinition]:
        """Highest enabled version per rule key. A rule with no enabled row stops generating."""
        chosen: dict[str, HealthRuleDefinition] = {}
        for row in self.list_definitions():
            if not row.enabled or row.rule_key not in HEALTH_RULES_BY_KEY:
                continue
            current = chosen.get(row.rule_key)
            if current is None or row.version > current.version:
                chosen[row.rule_key] = row
        return chosen


@dataclass
class SignalSyncResult:
    opened: int = 0
    unchanged: int = 0
    superseded: int = 0
    auto_resolved: int = 0
    expired: int = 0


class AccountHealthSignalService:
    def __init__(self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit

    def active_signals(self, ad_account_id: uuid.UUID) -> list[AccountHealthSignal]:
        return list(
            self.session.execute(
                sa.select(AccountHealthSignal).where(
                    AccountHealthSignal.ad_account_id == ad_account_id,
                    AccountHealthSignal.workspace_id == self.workspace_id,
                    AccountHealthSignal.status.in_(list(ACTIVE_SIGNAL_STATUSES)),
                )
            ).scalars().all()
        )

    def _create(
        self,
        account: AdAccount,
        candidate: SignalCandidate,
        definition: HealthRuleDefinition | None,
        *,
        now: datetime,
    ) -> AccountHealthSignal:
        signal = AccountHealthSignal(
            workspace_id=self.workspace_id,
            ad_account_id=account.id,
            rule_definition_id=definition.id if definition else None,
            rule_key=candidate.rule_key,
            rule_version=candidate.rule_version,
            signal_key=candidate.signal_key,
            active_key=candidate.signal_key,
            category=candidate.category,
            severity=candidate.severity,
            status=SignalStatus.OPEN,
            source_type=candidate.source_type,
            source_entity_type=candidate.source_entity_type,
            source_entity_id=candidate.source_entity_id,
            # Redacted on the way in: evidence is built from allowlisted fields, and this is the
            # second gate in case a rule is ever extended carelessly.
            evidence_json=redact(candidate.evidence),
            evidence_hash=evidence_hash(candidate.evidence),
            observed_at=candidate.observed_at,
            last_evaluated_at=now,
            expires_at=candidate.expires_at,
        )
        self.session.add(signal)
        self.session.flush()
        self.audit.record(
            action="health_signal.opened",
            entity_type="account_health_signal",
            entity_id=signal.id,
            after=orm_snapshot(signal),
            metadata={"ad_account_id": str(account.id), "rule_key": signal.rule_key},
        )
        logger.info(
            "health_signal_opened",
            extra={"rule_key": signal.rule_key, "severity": signal.severity.value},
        )
        return signal

    def _close(
        self,
        signal: AccountHealthSignal,
        *,
        status: SignalStatus,
        now: datetime,
        reason: str,
        action: str,
    ) -> None:
        before = orm_snapshot(signal)
        signal.status = status
        signal.active_key = None
        if status == SignalStatus.RESOLVED:
            signal.resolved_at = now
            signal.resolved_by = None  # closed by the engine, not by a person
            signal.resolution_reason = reason
        signal.last_evaluated_at = now
        self.session.flush()
        self.audit.record(
            action=action,
            entity_type="account_health_signal",
            entity_id=signal.id,
            before=before,
            after=orm_snapshot(signal),
            metadata={"reason": reason},
        )

    def sync(
        self,
        account: AdAccount,
        candidates: Sequence[SignalCandidate],
        definitions: dict[str, HealthRuleDefinition],
        *,
        now: datetime,
        enabled_rule_keys: set[str],
    ) -> SignalSyncResult:
        """Reconcile active signals with the current candidate set.

        Nothing is deleted and nothing is overwritten in place when the underlying fact changes:
        a materially different observation becomes a successor signal and the previous one is
        marked superseded, so the trail of what was true when stays readable.
        """
        result = SignalSyncResult()
        active = {signal.active_key: signal for signal in self.active_signals(account.id)}
        seen: set[str] = set()

        for candidate in candidates:
            key = candidate.signal_key
            seen.add(key)
            existing = active.get(key)
            new_hash = evidence_hash(candidate.evidence)
            definition = definitions.get(candidate.rule_key)

            if existing is None:
                self._create(account, candidate, definition, now=now)
                result.opened += 1
                continue

            if existing.evidence_hash == new_hash:
                # Same fact, same evidence: touch the evaluation stamp only. Critically this
                # preserves an `acknowledged` status instead of resetting it to open.
                existing.last_evaluated_at = now
                self.session.flush()
                result.unchanged += 1
                continue

            before = orm_snapshot(existing)
            existing.status = SignalStatus.SUPERSEDED
            existing.active_key = None
            existing.superseded_at = now
            existing.last_evaluated_at = now
            self.session.flush()  # release the unique active_key before the successor takes it
            successor = self._create(account, candidate, definition, now=now)
            existing.superseded_by_signal_id = successor.id
            self.session.flush()
            self.audit.record(
                action="health_signal.superseded",
                entity_type="account_health_signal",
                entity_id=existing.id,
                before=before,
                after=orm_snapshot(existing),
                metadata={"superseded_by_signal_id": str(successor.id)},
            )
            result.superseded += 1

        for key, signal in active.items():
            if key in seen:
                continue
            if signal.rule_key not in enabled_rule_keys:
                # A disabled rule stops generating but never erases history (A2 Guardrail 22).
                self._close(
                    signal,
                    status=SignalStatus.EXPIRED,
                    now=now,
                    reason="The rule that produced this signal is no longer enabled.",
                    action="health_signal.expired",
                )
                result.expired += 1
            else:
                self._close(
                    signal,
                    status=SignalStatus.RESOLVED,
                    now=now,
                    reason="The source condition is no longer true.",
                    action="health_signal.resolved",
                )
                result.auto_resolved += 1
        return result

    def expire_all_active(self, account: AdAccount, *, now: datetime, reason: str) -> int:
        count = 0
        for signal in self.active_signals(account.id):
            self._close(
                signal, status=SignalStatus.EXPIRED, now=now, reason=reason, action="health_signal.expired"
            )
            count += 1
        return count


class AccountHealthSnapshotService:
    def __init__(self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit

    def get(self, ad_account_id: uuid.UUID) -> AccountHealthSnapshot | None:
        return self.session.execute(
            sa.select(AccountHealthSnapshot).where(
                AccountHealthSnapshot.ad_account_id == ad_account_id,
                AccountHealthSnapshot.workspace_id == self.workspace_id,
            )
        ).scalar_one_or_none()

    def upsert(self, account: AdAccount, rollup: HealthRollup) -> AccountHealthSnapshot:
        snapshot = self.get(account.id)
        previous_status = snapshot.health_status.value if snapshot else None
        payload = {
            "health_status": HealthStatus(rollup.health_status),
            "health_summary_json": redact(rollup.to_dict()),
            "open_critical_count": rollup.counts.get("critical", 0),
            "open_warning_count": rollup.counts.get("warning", 0),
            "open_attention_count": rollup.counts.get("attention", 0),
            "open_unknown_count": rollup.counts.get("unknown", 0),
            "freshness_status": HealthFreshness(rollup.freshness_status),
            "last_evaluated_at": rollup.evaluated_at,
            "engine_version": rollup.engine_version,
        }
        if snapshot is None:
            snapshot = AccountHealthSnapshot(
                workspace_id=self.workspace_id, ad_account_id=account.id, **payload
            )
            self.session.add(snapshot)
        else:
            for key, value in payload.items():
                setattr(snapshot, key, value)
        self.session.flush()

        if previous_status != rollup.health_status:
            self.audit.record(
                action="health_snapshot.changed",
                entity_type="account_health_snapshot",
                entity_id=snapshot.id,
                before={"health_status": previous_status},
                after={"health_status": rollup.health_status},
                metadata={"ad_account_id": str(account.id), "engine_version": rollup.engine_version},
            )
            logger.info(
                "health_snapshot_changed",
                extra={"from": previous_status, "to": rollup.health_status},
            )
        return snapshot


class HealthEvaluationRunService:
    def __init__(self, session: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID | None) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.actor_id = actor_id

    def start(
        self,
        *,
        ad_account_id: uuid.UUID | None,
        trigger: EvaluationTrigger,
        trigger_reference_id: str | None = None,
    ) -> HealthEvaluationRun:
        run = HealthEvaluationRun(
            workspace_id=self.workspace_id,
            ad_account_id=ad_account_id,
            trigger_type=trigger,
            trigger_reference_id=trigger_reference_id,
            status=EvaluationRunStatus.RUNNING,
            engine_version=ENGINE_VERSION,
            started_at=datetime.now(UTC),
            request_id=get_request_id(),
            created_by=self.actor_id,
        )
        self.session.add(run)
        self.session.flush()
        logger.info("health_evaluation_started", extra={"trigger": trigger.value})
        return run

    def finish(
        self,
        run: HealthEvaluationRun,
        *,
        status: EvaluationRunStatus,
        result: dict[str, Any] | None = None,
        error_code: str | None = None,
        error_summary: str | None = None,
    ) -> HealthEvaluationRun:
        run.status = status
        run.completed_at = datetime.now(UTC)
        run.result_summary_json = redact(result) if result else None
        run.error_code = error_code
        # Truncated and redacted: an exception message must not become a leak channel.
        run.error_summary = (error_summary or "")[:500] or None
        self.session.flush()
        logger.info(
            "health_evaluation_succeeded" if status == EvaluationRunStatus.SUCCEEDED else "health_evaluation_failed",
            extra={"status": status.value, "error_code": error_code},
        )
        return run


class AccountHealthEvaluationService:
    """Orchestrates one account's evaluation: facts → candidates → signals → snapshot → run."""

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
        self.settings = get_settings()
        self.rules = HealthRuleRegistryService(session, workspace_id)
        self.signals = AccountHealthSignalService(session, workspace_id, audit)
        self.snapshots = AccountHealthSnapshotService(session, workspace_id, audit)
        self.runs = HealthEvaluationRunService(session, workspace_id, actor_id)

    # ------------------------------------------------------------------ source facts
    def _facts(self, account: AdAccount, now: datetime) -> HealthFacts:
        """Read A1 without writing to it.

        Readiness is evaluated with `persist=False`: health must never move a readiness state,
        and passing that flag is what makes the guarantee structural rather than a promise.
        """
        readiness = ReadinessRollupService(self.session, self.workspace_id, self.audit).evaluate(
            account, persist=False
        )
        checklist_items = list(
            self.session.execute(
                sa.select(ReadinessChecklistItem).where(
                    ReadinessChecklistItem.ad_account_id == account.id,
                    ReadinessChecklistItem.archived_at.is_(None),
                )
            ).scalars().all()
        )
        events = list(
            self.session.execute(
                sa.select(AccountEvent).where(
                    AccountEvent.ad_account_id == account.id,
                    AccountEvent.archived_at.is_(None),
                )
            ).scalars().all()
        )
        return HealthFacts(
            account=account,
            readiness=readiness,
            checklist_items=checklist_items,
            unresolved_events=[event for event in events if event.is_unresolved],
            now=now,
            manual_review_due_after_days=self.settings.readiness_manual_review_interval_days,
        )

    # -------------------------------------------------------------------- evaluation
    def evaluate_account(
        self,
        account: AdAccount,
        *,
        trigger: EvaluationTrigger,
        trigger_reference_id: str | None = None,
        run: HealthEvaluationRun | None = None,
    ) -> tuple[HealthEvaluationRun, HealthRollup]:
        now = datetime.now(UTC)
        run = run or self.runs.start(
            ad_account_id=account.id, trigger=trigger, trigger_reference_id=trigger_reference_id
        )

        if account.archived_at is not None:
            # Archived accounts leave active assessment. Existing signals are expired, not
            # deleted, so the history of what was true before archival stays readable.
            expired = self.signals.expire_all_active(
                account, now=now, reason="Account archived; excluded from active health evaluation."
            )
            rollup = roll_up(
                [], now=now, freshness=HealthFreshness.NOT_APPLICABLE, archived=True
            )
            self.snapshots.upsert(account, rollup)
            # Derivation still runs so alerts for an archived account close instead of lingering.
            self.runs.finish(
                run,
                status=EvaluationRunStatus.SKIPPED,
                result={"reason": "account_archived", "expired_signals": expired},
            )
            alerts = derive_alerts_safe(
                self.session,
                self.workspace_id,
                self.audit,
                account,
                health_status=rollup.health_status,
                actor_id=self.actor_id,
            )
            run.result_summary_json = {**(run.result_summary_json or {}), **alerts}
            self.session.flush()
            return run, rollup

        definitions = self.rules.ensure_seeded() and self.rules.enabled_definitions()
        enabled_keys = set(definitions)
        facts = self._facts(account, now)
        candidates = build_candidates(facts, enabled_keys)
        sync = self.signals.sync(
            account, candidates, definitions, now=now, enabled_rule_keys=enabled_keys
        )
        active = self.signals.active_signals(account.id)
        freshness = derive_freshness(
            now, now=now, stale_after_hours=self.settings.health_evaluation_stale_after_hours
        )
        rollup = roll_up(active, now=now, freshness=freshness)
        self.snapshots.upsert(account, rollup)
        # A3 alert derivation. Nested savepoint inside this one: an alerting bug degrades
        # alerting only, never health and never the source mutation.
        # The run is finished *before* alert derivation on purpose: derivation asks "what is the
        # latest word on this account?", and a run still marked running would leave a previous
        # failure looking current, so a recovered account would never clear its failure alert.
        self.runs.finish(
            run,
            status=EvaluationRunStatus.SUCCEEDED,
            result={
                "health_status": rollup.health_status,
                "counts": rollup.counts,
                "signals_opened": sync.opened,
                "signals_unchanged": sync.unchanged,
                "signals_superseded": sync.superseded,
                "signals_auto_resolved": sync.auto_resolved,
                "signals_expired": sync.expired,
                "rules_evaluated": len(enabled_keys),
            },
        )
        alerts = derive_alerts_safe(
            self.session,
            self.workspace_id,
            self.audit,
            account,
            health_status=rollup.health_status,
            actor_id=self.actor_id,
        )
        run.result_summary_json = {**(run.result_summary_json or {}), **alerts}
        self.session.flush()
        return run, rollup

    def evaluate_account_safe(
        self,
        account: AdAccount,
        *,
        trigger: EvaluationTrigger,
        trigger_reference_id: str | None = None,
    ) -> HealthEvaluationRun:
        """Evaluate inside a SAVEPOINT so a health failure cannot roll back the A1 mutation.

        This is the whole reason health evaluation is safe to run synchronously: if it breaks,
        the operator's actual change still commits, the failure is recorded as a run, and the
        account's health is shown as unknown instead of keeping a stale clear result.
        """
        run = self.runs.start(
            ad_account_id=account.id, trigger=trigger, trigger_reference_id=trigger_reference_id
        )
        try:
            with self.session.begin_nested():
                self.evaluate_account(
                    account, trigger=trigger, trigger_reference_id=trigger_reference_id, run=run
                )
            return run
        except Exception as exc:  # noqa: BLE001 - deliberately broad; the run records the reason
            logger.exception(
                "health_evaluation_failed",
                extra={"ad_account_id": str(account.id), "trigger": trigger.value},
            )
            self._mark_unknown_after_failure(account, exc)
            finished = self.runs.finish(
                run,
                status=EvaluationRunStatus.FAILED,
                error_code=type(exc).__name__,
                error_summary=str(exc),
            )
            # Derive *after* the run is marked failed, so the failure is the latest word on this
            # account and the derivation can raise a warning alert about it. Doing this inside
            # the rolled-back savepoint above would lose it.
            derive_alerts_safe(
                self.session,
                self.workspace_id,
                self.audit,
                account,
                health_status="unknown",
                actor_id=self.actor_id,
            )
            return finished

    def _mark_unknown_after_failure(self, account: AdAccount, exc: Exception) -> None:
        now = datetime.now(UTC)
        existing = self.snapshots.get(account.id)
        freshness = HealthFreshness.STALE if existing else HealthFreshness.UNKNOWN
        rollup = roll_up([], now=now, freshness=freshness, evaluation_failed=True)
        # Keep the previously observed counts out of the picture: the point is that we no
        # longer know, not that everything is suddenly fine.
        try:
            self.snapshots.upsert(account, rollup)
        except Exception:  # pragma: no cover - the session is already degraded
            logger.exception("failed to record unknown health snapshot after evaluation failure")


class HealthSignalActionService:
    """Operator actions on a signal. None of them touch the underlying A1 record."""

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

    def acknowledge(self, signal: AccountHealthSignal, *, note: str) -> AccountHealthSignal:
        text = self._require_text(note, field="note", label="An acknowledgement note")
        if signal.status != SignalStatus.OPEN:
            raise ConflictError(
                f"Only an open signal can be acknowledged; this one is {signal.status.value}."
            )
        before = orm_snapshot(signal)
        signal.status = SignalStatus.ACKNOWLEDGED
        signal.acknowledged_at = datetime.now(UTC)
        signal.acknowledged_by = self.actor_id
        signal.acknowledgement_note = text
        # active_key is deliberately left in place: acknowledging is not resolving, and the
        # signal keeps counting towards the account's health rollup.
        self.session.flush()
        self.audit.record(
            action="health_signal.acknowledged",
            entity_type="account_health_signal",
            entity_id=signal.id,
            before=before,
            after=orm_snapshot(signal),
        )
        logger.info("health_signal_acknowledged", extra={"rule_key": signal.rule_key})
        return signal

    def resolve(
        self, signal: AccountHealthSignal, *, reason: str, evidence_reference: str | None
    ) -> AccountHealthSignal:
        text = self._require_text(reason, field="reason", label="A resolution reason")
        if signal.status not in ACTIVE_SIGNAL_STATUSES:
            raise ConflictError(
                f"Only an open or acknowledged signal can be resolved; this one is {signal.status.value}."
            )
        before = orm_snapshot(signal)
        signal.status = SignalStatus.RESOLVED
        signal.active_key = None
        signal.resolved_at = datetime.now(UTC)
        signal.resolved_by = self.actor_id
        signal.resolution_reason = text
        signal.resolution_evidence_reference = evidence_reference
        self.session.flush()
        self.audit.record(
            action="health_signal.resolved",
            entity_type="account_health_signal",
            entity_id=signal.id,
            before=before,
            after=orm_snapshot(signal),
        )
        logger.info("health_signal_resolved", extra={"rule_key": signal.rule_key})
        return signal

    def reopen(self, signal: AccountHealthSignal, *, reason: str) -> AccountHealthSignal:
        text = self._require_text(reason, field="reason", label="A reason")
        if signal.status in ACTIVE_SIGNAL_STATUSES:
            raise ConflictError("This signal is already active.")
        if signal.status == SignalStatus.SUPERSEDED:
            raise ConflictError(
                "A superseded signal cannot be reopened; a newer signal already replaced it.",
                details={"superseded_by_signal_id": str(signal.superseded_by_signal_id or "")},
            )
        clash = self.session.execute(
            sa.select(AccountHealthSignal.id).where(
                AccountHealthSignal.ad_account_id == signal.ad_account_id,
                AccountHealthSignal.active_key == signal.signal_key,
            )
        ).first()
        if clash is not None:
            raise ConflictError(
                "An active signal already exists for this rule and source fact.",
                details={"signal_key": signal.signal_key},
            )
        before = orm_snapshot(signal)
        signal.status = SignalStatus.OPEN
        signal.active_key = signal.signal_key
        signal.resolved_at = None
        signal.resolved_by = None
        signal.resolution_reason = None
        signal.resolution_evidence_reference = None
        signal.acknowledged_at = None
        signal.acknowledged_by = None
        signal.acknowledgement_note = None
        self.session.flush()
        self.audit.record(
            action="health_signal.reopened",
            entity_type="account_health_signal",
            entity_id=signal.id,
            before=before,
            after=orm_snapshot(signal),
            metadata={"reason": text},
        )
        return signal


class HealthBackfillService:
    """Bounded batch evaluation.

    Synchronous by necessity: A1 ships no worker, and A2 §G forbids adding a scheduler just to
    satisfy this MINI-SPEC. The bound is what makes it safe to run in a request.
    """

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
        self.settings = get_settings()
        self.evaluation = AccountHealthEvaluationService(session, workspace_id, audit, actor_id)
        self.runs = HealthEvaluationRunService(session, workspace_id, actor_id)

    def pending_count(self) -> int:
        return int(
            self.session.execute(
                sa.select(sa.func.count())
                .select_from(AdAccount)
                .where(AdAccount.workspace_id == self.workspace_id, AdAccount.archived_at.is_(None))
            ).scalar_one()
        )

    def run(self, *, batch_size: int | None = None) -> dict[str, Any]:
        limit = batch_size or self.settings.health_backfill_default_batch
        if limit < 1 or limit > self.settings.health_backfill_max_batch:
            raise ValidationError(
                f"batch_size must be between 1 and {self.settings.health_backfill_max_batch}.",
                details={"field": "batch_size"},
            )
        parent = self.runs.start(ad_account_id=None, trigger=EvaluationTrigger.BACKFILL)
        logger.info("health_backfill_started", extra={"batch_size": limit})

        # Oldest evaluation first, never-evaluated accounts first of all.
        stmt = (
            sa.select(AdAccount)
            .outerjoin(
                AccountHealthSnapshot, AccountHealthSnapshot.ad_account_id == AdAccount.id
            )
            .where(AdAccount.workspace_id == self.workspace_id, AdAccount.archived_at.is_(None))
            .order_by(
                AccountHealthSnapshot.last_evaluated_at.is_(None).desc(),
                AccountHealthSnapshot.last_evaluated_at.asc(),
                AdAccount.created_at.asc(),
            )
            .limit(limit)
        )
        accounts = list(self.session.execute(stmt).scalars().all())

        succeeded = failed = skipped = 0
        for account in accounts:
            run = self.evaluation.evaluate_account_safe(
                account, trigger=EvaluationTrigger.BACKFILL, trigger_reference_id=str(parent.id)
            )
            if run.status == EvaluationRunStatus.SUCCEEDED:
                succeeded += 1
            elif run.status == EvaluationRunStatus.SKIPPED:
                skipped += 1
            else:
                failed += 1

        summary = {
            "requested_batch_size": limit,
            "evaluated": len(accounts),
            "succeeded": succeeded,
            "failed": failed,
            "skipped": skipped,
            "remaining_active_accounts": self.pending_count(),
        }
        self.runs.finish(
            parent,
            status=EvaluationRunStatus.SUCCEEDED if failed == 0 else EvaluationRunStatus.FAILED,
            result=summary,
            error_code=None if failed == 0 else "partial_failure",
            error_summary=None if failed == 0 else f"{failed} account evaluation(s) failed.",
        )
        self.audit.record(
            action="health_backfill.completed" if failed == 0 else "health_backfill.failed",
            entity_type="health_evaluation_run",
            entity_id=parent.id,
            after=summary,
        )
        logger.info("health_backfill_completed", extra=summary)
        return {"run_id": str(parent.id), **summary}
