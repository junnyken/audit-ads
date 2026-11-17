"""MINI-SPEC A2 domain model — account health.

Four additive tables. No A1 table is altered and no A1 column changes meaning: health reads A1
facts and records its own observations alongside them.

`account_health_signals.active_key` deserves an explanation. At most one signal per account may
be active for a given `signal_key`, and that has to be enforced by the database rather than by
hope. A PostgreSQL partial unique index would do it, but it would break A1's property that one
migration runs on any backend. Instead `active_key` mirrors `signal_key` while the signal is
open or acknowledged and is NULL otherwise; NULLs never collide in a unique index on either
backend, so `unique(ad_account_id, active_key)` gives the same guarantee portably.
"""
from __future__ import annotations

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.core.enums import (
    EvaluationRunStatus,
    EvaluationTrigger,
    HealthCategory,
    HealthFreshness,
    HealthSourceType,
    HealthStatus,
    SignalSeverity,
    SignalStatus,
)
from app.db.base import Archivable, Base, Timestamped, UUIDPrimaryKey
from app.models.entities import _enum


class HealthRuleDefinition(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """A versioned, enabled/disabled definition of one typed internal rule.

    Configuration is data, never code: `condition_config_json` is read by a fixed registry
    implementation. Nothing here is ever evaluated as an expression (A2 §A.1).
    """

    __tablename__ = "health_rule_definitions"
    __table_args__ = (
        sa.UniqueConstraint("workspace_id", "rule_key", "version"),
        sa.Index("ix_hrd_rule_key_enabled", "rule_key", "enabled"),
    )

    #: NULL means a system-default rule shared by every workspace.
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    rule_key: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    version: Mapped[int] = mapped_column(sa.Integer(), nullable=False, default=1)
    name: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    description: Mapped[str] = mapped_column(sa.Text(), nullable=False, default="")
    category: Mapped[HealthCategory] = mapped_column(
        _enum(HealthCategory, "health_category"), nullable=False
    )
    enabled: Mapped[bool] = mapped_column(sa.Boolean(), nullable=False, default=True)
    severity: Mapped[SignalSeverity] = mapped_column(
        _enum(SignalSeverity, "signal_severity"), nullable=False
    )
    source_requirements_json: Mapped[dict] = mapped_column(sa.JSON(), nullable=False, default=dict)
    condition_config_json: Mapped[dict] = mapped_column(sa.JSON(), nullable=False, default=dict)
    freshness_policy_json: Mapped[dict | None] = mapped_column(sa.JSON(), nullable=True)
    resolution_guidance: Mapped[str] = mapped_column(sa.Text(), nullable=False, default="")
    created_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)


class AccountHealthSignal(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """One explainable observation about one account, derived from one rule and one source fact."""

    __tablename__ = "account_health_signals"
    __table_args__ = (
        sa.UniqueConstraint("ad_account_id", "active_key"),
        sa.Index(
            "ix_ahs_ws_account_status_severity",
            "workspace_id",
            "ad_account_id",
            "status",
            "severity",
        ),
        sa.Index("ix_ahs_ws_rule_key_status", "workspace_id", "rule_key", "status"),
        sa.Index("ix_ahs_account_observed_at", "ad_account_id", "observed_at"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    ad_account_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("ad_accounts.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    rule_definition_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(),
        sa.ForeignKey(
            "health_rule_definitions.id",
            ondelete="RESTRICT",
            name="fk_ahs_rule_definition_id",
        ),
        nullable=True
    )
    rule_key: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    rule_version: Mapped[int] = mapped_column(sa.Integer(), nullable=False, default=1)
    #: Deterministic identity of the observed fact: rule key plus source scope.
    signal_key: Mapped[str] = mapped_column(sa.String(300), nullable=False)
    #: Mirrors signal_key while active, NULL otherwise. See the module docstring.
    active_key: Mapped[str | None] = mapped_column(sa.String(300), nullable=True)
    category: Mapped[HealthCategory] = mapped_column(
        _enum(HealthCategory, "health_category"), nullable=False
    )
    severity: Mapped[SignalSeverity] = mapped_column(
        _enum(SignalSeverity, "signal_severity"), nullable=False
    )
    status: Mapped[SignalStatus] = mapped_column(
        _enum(SignalStatus, "signal_status"), nullable=False, default=SignalStatus.OPEN
    )
    source_type: Mapped[HealthSourceType] = mapped_column(
        _enum(HealthSourceType, "health_source_type"), nullable=False
    )
    source_entity_type: Mapped[str | None] = mapped_column(sa.String(80), nullable=True)
    source_entity_id: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    #: Allowlisted, redacted, UI-ready. Never a raw record dump.
    evidence_json: Mapped[dict] = mapped_column(sa.JSON(), nullable=False, default=dict)
    evidence_hash: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    observed_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    last_evaluated_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    acknowledged_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)
    acknowledgement_note: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    #: NULL with a resolved status means the engine closed it because the source fact went away.
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)
    resolution_reason: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)
    resolution_evidence_reference: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)
    superseded_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    superseded_by_signal_id: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)

    @property
    def is_active(self) -> bool:
        return self.status in (SignalStatus.OPEN, SignalStatus.ACKNOWLEDGED)


class AccountHealthSnapshot(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """The latest rollup for one account. A cache, never the source of truth: it is rebuildable
    from signals, A1 facts and rule definitions at any time."""

    __tablename__ = "account_health_snapshots"
    __table_args__ = (
        sa.UniqueConstraint("ad_account_id"),
        sa.Index(
            "ix_ahsnap_ws_status_freshness",
            "workspace_id",
            "health_status",
            "freshness_status",
        ),
        sa.Index("ix_ahsnap_ws_last_evaluated_at", "workspace_id", "last_evaluated_at"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    ad_account_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("ad_accounts.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    health_status: Mapped[HealthStatus] = mapped_column(
        _enum(HealthStatus, "health_status"), nullable=False, default=HealthStatus.UNKNOWN
    )
    health_summary_json: Mapped[dict] = mapped_column(sa.JSON(), nullable=False, default=dict)
    open_critical_count: Mapped[int] = mapped_column(sa.Integer(), nullable=False, default=0)
    open_warning_count: Mapped[int] = mapped_column(sa.Integer(), nullable=False, default=0)
    open_attention_count: Mapped[int] = mapped_column(sa.Integer(), nullable=False, default=0)
    open_unknown_count: Mapped[int] = mapped_column(sa.Integer(), nullable=False, default=0)
    freshness_status: Mapped[HealthFreshness] = mapped_column(
        _enum(HealthFreshness, "health_freshness"), nullable=False, default=HealthFreshness.UNKNOWN
    )
    last_evaluated_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    next_evaluation_due_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    engine_version: Mapped[str] = mapped_column(sa.String(32), nullable=False)


class HealthEvaluationRun(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """Observability for every evaluation, including the ones that failed.

    A failed run is the record that lets the UI say "this is stale" instead of quietly showing
    a previous clear result (A2 Guardrail 25).
    """

    __tablename__ = "health_evaluation_runs"
    __table_args__ = (
        sa.Index(
            "ix_her_ws_account_status_created",
            "workspace_id",
            "ad_account_id",
            "status",
            "created_at",
        ),
    )

    workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    ad_account_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(), sa.ForeignKey("ad_accounts.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    trigger_type: Mapped[EvaluationTrigger] = mapped_column(
        _enum(EvaluationTrigger, "evaluation_trigger"), nullable=False
    )
    trigger_reference_id: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    status: Mapped[EvaluationRunStatus] = mapped_column(
        _enum(EvaluationRunStatus, "evaluation_run_status"),
        nullable=False,
        default=EvaluationRunStatus.QUEUED,
    )
    engine_version: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    started_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    error_code: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    error_summary: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)
    result_summary_json: Mapped[dict | None] = mapped_column(sa.JSON(), nullable=True)
    request_id: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)
