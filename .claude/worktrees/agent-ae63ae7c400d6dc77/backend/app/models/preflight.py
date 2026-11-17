"""MINI-SPEC A6 domain model — Preflight Compliance Gate.

Four additive tables. None of A1-A5's tables are altered. A6 reads A1 readiness and A2 health
through their existing services (never duplicate SQL against those tables) and writes only its
own records here.

No table in this module is ever hard-deleted — `archived_at` (via `Archivable`) is the only
removal path, consistent with every other domain table in this codebase (A6 guardrail 13).
"""
from __future__ import annotations

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.core.enums import (
    DraftStatus,
    FindingCategory,
    FindingSeverity,
    FindingStatus,
    PreflightEvaluationRunStatus,
)
from app.db.base import Archivable, Base, Timestamped, UUIDPrimaryKey
from app.models.entities import _enum


class CampaignDraft(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """An operator-authored, pre-publish record. A6 never creates, edits or publishes the real
    campaign this describes — the operator does that manually, outside this product."""

    __tablename__ = "campaign_drafts"
    __table_args__ = (
        sa.Index("ix_cd_ws_status_updated", "workspace_id", "draft_status", "updated_at"),
        sa.Index("ix_cd_ws_account", "workspace_id", "ad_account_id"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    #: Nullable so an unlinked draft can still be saved and shown a `draft_missing_account_link`
    #: finding, rather than being refused outright at the API boundary.
    ad_account_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(), sa.ForeignKey("ad_accounts.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    objective: Mapped[str | None] = mapped_column(sa.String(80), nullable=True)
    primary_copy: Mapped[str] = mapped_column(sa.Text(), nullable=False, default="")
    headline: Mapped[str | None] = mapped_column(sa.String(200), nullable=True)
    description: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)
    call_to_action: Mapped[str | None] = mapped_column(sa.String(80), nullable=True)
    #: The operator's stated intent, not a fetched value. `LandingPageEvidence` is the fetch.
    landing_page_url: Mapped[str | None] = mapped_column(sa.String(2000), nullable=True)
    #: An external link/label only — A6 has no creative upload/storage (mini-spec §3).
    creative_reference: Mapped[str | None] = mapped_column(sa.String(2000), nullable=True)
    budget_amount: Mapped[float | None] = mapped_column(sa.Numeric(14, 2), nullable=True)
    budget_currency: Mapped[str | None] = mapped_column(sa.String(8), nullable=True)
    budget_change_percent: Mapped[float | None] = mapped_column(sa.Numeric(6, 2), nullable=True)
    targeting_summary: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)
    draft_status: Mapped[DraftStatus] = mapped_column(
        _enum(DraftStatus, "draft_status"), nullable=False, default=DraftStatus.DRAFT
    )
    last_evaluated_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    created_by: Mapped[uuid.UUID] = mapped_column(sa.Uuid(), nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)


class PreflightEvaluationRun(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """One evaluation attempt, including the ones that failed — mirrors A2's
    `HealthEvaluationRun` so a failure is a visible record, not a silently missing one."""

    __tablename__ = "preflight_evaluation_runs"
    __table_args__ = (
        sa.Index(
            "ix_per_ws_draft_status_created", "workspace_id", "draft_id", "status", "created_at"
        ),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    draft_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("campaign_drafts.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    status: Mapped[PreflightEvaluationRunStatus] = mapped_column(
        _enum(PreflightEvaluationRunStatus, "preflight_evaluation_run_status"),
        nullable=False,
        default=PreflightEvaluationRunStatus.QUEUED,
    )
    engine_version: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    started_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    error_code: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    error_summary: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)
    result_summary_json: Mapped[dict | None] = mapped_column(sa.JSON(), nullable=True)
    request_id: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)


class PreflightFinding(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """One explainable, rule-based observation. Never an opaque score (A6 guardrail 11)."""

    __tablename__ = "preflight_findings"
    __table_args__ = (
        sa.Index("ix_pf_ws_draft_status_severity", "workspace_id", "draft_id", "status", "severity"),
        sa.Index("ix_pf_evaluation_run", "evaluation_run_id"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    draft_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("campaign_drafts.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    evaluation_run_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(),
        sa.ForeignKey("preflight_evaluation_runs.id", ondelete="RESTRICT"),
        nullable=False,
    )
    category: Mapped[FindingCategory] = mapped_column(
        _enum(FindingCategory, "finding_category"), nullable=False
    )
    severity: Mapped[FindingSeverity] = mapped_column(
        _enum(FindingSeverity, "finding_severity"), nullable=False
    )
    rule_key: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    rule_version: Mapped[int] = mapped_column(sa.Integer(), nullable=False, default=1)
    message: Mapped[str] = mapped_column(sa.Text(), nullable=False)
    field_reference: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    evidence_reference: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    recommended_action: Mapped[str] = mapped_column(sa.Text(), nullable=False, default="")
    status: Mapped[FindingStatus] = mapped_column(
        _enum(FindingStatus, "finding_status"), nullable=False, default=FindingStatus.OPEN
    )
    resolved_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)
    resolution_reason: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)


class LandingPageEvidence(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """A safety-bounded, cached snapshot of what one check observed. Not a live guarantee — it
    carries its own `checked_at`/`expires_at` so staleness is visible, never assumed away.

    Only the fields below are ever stored. The fetched HTML body itself is never persisted
    (A6 guardrail 6 / 8).
    """

    __tablename__ = "landing_page_evidence"
    __table_args__ = (
        sa.Index("ix_lpe_ws_draft_checked", "workspace_id", "draft_id", "checked_at"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    draft_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("campaign_drafts.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    evaluation_run_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(),
        sa.ForeignKey("preflight_evaluation_runs.id", ondelete="SET NULL"),
        nullable=True,
    )
    url: Mapped[str] = mapped_column(sa.String(2000), nullable=False)
    final_url: Mapped[str | None] = mapped_column(sa.String(2000), nullable=True)
    http_status: Mapped[int | None] = mapped_column(sa.Integer(), nullable=True)
    is_https: Mapped[bool] = mapped_column(sa.Boolean(), nullable=False, default=False)
    redirect_count: Mapped[int | None] = mapped_column(sa.Integer(), nullable=True)
    response_time_ms: Mapped[int | None] = mapped_column(sa.Integer(), nullable=True)
    mobile_viewport_meta_present: Mapped[bool | None] = mapped_column(sa.Boolean(), nullable=True)
    contact_or_policy_link_detected: Mapped[bool | None] = mapped_column(sa.Boolean(), nullable=True)
    fetch_error: Mapped[str | None] = mapped_column(sa.String(200), nullable=True)
    checked_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
