"""A6 §6.D `PreflightEvaluationService` — runs the three rule modules, persists their output,
and applies the deterministic verdict rollup from mini-spec §6.C exactly.

Idempotent-safe (mini-spec §6.E): an in-flight run is returned as-is, and a just-completed run
is returned unchanged for a short cooldown, so rapid repeated `evaluate` calls never create
unbounded duplicate runs. A fresh run always supersedes the draft's previously active findings
first, so "current findings" is always exactly "findings from the latest run" without needing a
separate concept of run generations.
"""
from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import DraftStatus, FindingSeverity, FindingStatus, PreflightEvaluationRunStatus
from app.core.errors import ConflictError
from app.models.entities import AdAccount
from app.models.preflight import CampaignDraft, LandingPageEvidence, PreflightEvaluationRun, PreflightFinding
from app.services.audit import AuditLogService
from app.services.base import snapshot
from app.services.preflight_account_context import AccountContextRuleAdapter
from app.services.preflight_copy_rules import CopyRuleEngine
from app.services.preflight_draft import ACTIVE_FINDING_STATUSES
from app.services.preflight_landing_page import LandingPageCheckService
from app.services.preflight_types import FindingDraft

logger = logging.getLogger(__name__)

ENGINE_VERSION = "1"
EVALUATION_COOLDOWN = timedelta(seconds=5)

#: A blocking finding from one of these rules means a hard account/safety condition, not an
#: ordinary content fix — mini-spec §6.C step 3. Every other blocking rule routes to
#: `needs_changes` instead.
_BLOCKED_BY_POLICY_RULE_KEYS = frozenset(
    {
        "account_status_restricted_or_disabled",
        "account_health_critical",
        "landing_page_private_target_blocked",
        "draft_missing_account_link",
    }
)


class PreflightEvaluationService:
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

    def _in_flight_or_recent_run(self, draft_id: uuid.UUID) -> PreflightEvaluationRun | None:
        cutoff = datetime.now(UTC) - EVALUATION_COOLDOWN
        stmt = (
            sa.select(PreflightEvaluationRun)
            .where(
                PreflightEvaluationRun.draft_id == draft_id,
                sa.or_(
                    PreflightEvaluationRun.status.in_(
                        (PreflightEvaluationRunStatus.QUEUED, PreflightEvaluationRunStatus.RUNNING)
                    ),
                    PreflightEvaluationRun.created_at >= cutoff,
                ),
            )
            .order_by(sa.desc(PreflightEvaluationRun.created_at))
            .limit(1)
        )
        return self.session.execute(stmt).scalar_one_or_none()

    def _supersede_active_findings(self, draft_id: uuid.UUID) -> None:
        self.session.execute(
            sa.update(PreflightFinding)
            .where(
                PreflightFinding.draft_id == draft_id,
                PreflightFinding.status.in_(ACTIVE_FINDING_STATUSES),
            )
            .values(status=FindingStatus.SUPERSEDED)
        )

    def evaluate(self, draft: CampaignDraft, *, request_id: str | None = None) -> PreflightEvaluationRun:
        if draft.archived_at is not None:
            raise ConflictError("An archived draft cannot be evaluated. Restore it first.")

        existing = self._in_flight_or_recent_run(draft.id)
        if existing is not None:
            return existing

        started_at = datetime.now(UTC)
        run = PreflightEvaluationRun(
            workspace_id=self.workspace_id,
            draft_id=draft.id,
            status=PreflightEvaluationRunStatus.RUNNING,
            engine_version=ENGINE_VERSION,
            started_at=started_at,
            request_id=request_id,
            created_by=self.actor_id,
        )
        self.session.add(run)
        self.session.flush()
        self.audit.record(
            action="preflight_evaluation.started",
            entity_type="preflight_evaluation_run",
            entity_id=run.id,
            after={"draft_id": str(draft.id)},
        )

        try:
            self._supersede_active_findings(draft.id)

            account: AdAccount | None = None
            if draft.ad_account_id is not None:
                account = self.session.get(AdAccount, draft.ad_account_id)

            draft_findings: list[FindingDraft] = list(CopyRuleEngine().evaluate(draft))

            landing_transient = False
            if draft.landing_page_url:
                outcome = LandingPageCheckService().check(draft.landing_page_url)
                self.session.add(
                    LandingPageEvidence(
                        workspace_id=self.workspace_id,
                        draft_id=draft.id,
                        evaluation_run_id=run.id,
                        **outcome.evidence_fields,
                    )
                )
                draft_findings.extend(outcome.findings)
                landing_transient = outcome.is_transient

            draft_findings.extend(
                AccountContextRuleAdapter(self.session, self.workspace_id, self.audit).evaluate(account)
            )

            persisted: list[PreflightFinding] = []
            for f in draft_findings:
                row = PreflightFinding(
                    workspace_id=self.workspace_id,
                    draft_id=draft.id,
                    evaluation_run_id=run.id,
                    category=f.category,
                    severity=f.severity,
                    rule_key=f.rule_key,
                    rule_version=f.rule_version,
                    message=f.message,
                    field_reference=f.field_reference,
                    evidence_reference=f.evidence_reference,
                    recommended_action=f.recommended_action,
                    status=FindingStatus.OPEN,
                )
                self.session.add(row)
                persisted.append(row)
            self.session.flush()

            new_status = self._rollup(persisted, landing_transient=landing_transient)
            draft.draft_status = new_status
            draft.last_evaluated_at = started_at

            completed_at = datetime.now(UTC)
            run.status = PreflightEvaluationRunStatus.SUCCEEDED
            run.completed_at = completed_at
            run.result_summary_json = {
                "draft_status": new_status.value,
                "blocking_count": sum(1 for f in persisted if f.severity == FindingSeverity.BLOCKING),
                "warning_count": sum(1 for f in persisted if f.severity == FindingSeverity.WARNING),
            }
            self.session.flush()
            self.audit.record(
                action="preflight_evaluation.succeeded",
                entity_type="preflight_evaluation_run",
                entity_id=run.id,
                after=snapshot(run),
                metadata={"draft_id": str(draft.id), "draft_status": new_status.value},
            )
            return run
        except Exception as exc:  # noqa: BLE001 - a rule/fetch bug must degrade honestly, never crash to a stale verdict
            logger.exception("preflight_evaluation_failed", extra={"draft_id": str(draft.id)})
            run.status = PreflightEvaluationRunStatus.FAILED
            run.completed_at = datetime.now(UTC)
            run.error_code = type(exc).__name__
            run.error_summary = str(exc)[:500]
            # A failed run must never leave a stale "ready" verdict standing (A6 guardrail 16).
            draft.draft_status = DraftStatus.UNKNOWN_MISSING_EVIDENCE
            draft.last_evaluated_at = started_at
            self.session.flush()
            self.audit.record(
                action="preflight_evaluation.failed",
                entity_type="preflight_evaluation_run",
                entity_id=run.id,
                after=snapshot(run),
                metadata={"draft_id": str(draft.id)},
            )
            return run

    @staticmethod
    def _rollup(findings: list[PreflightFinding], *, landing_transient: bool) -> DraftStatus:
        """Mini-spec §6.C, verbatim."""
        if landing_transient:
            return DraftStatus.UNKNOWN_MISSING_EVIDENCE

        blocking = [f for f in findings if f.severity == FindingSeverity.BLOCKING]
        if blocking:
            if any(f.rule_key in _BLOCKED_BY_POLICY_RULE_KEYS for f in blocking):
                return DraftStatus.BLOCKED_BY_INTERNAL_POLICY
            return DraftStatus.NEEDS_CHANGES

        warning = [f for f in findings if f.severity == FindingSeverity.WARNING]
        if warning:
            return DraftStatus.NEEDS_CHANGES

        return DraftStatus.READY_FOR_MANUAL_REVIEW
