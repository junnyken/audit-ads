"""A6 request/response schemas — Preflight Compliance Gate."""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated

from pydantic import Field, field_validator

from app.core.enums import (
    DraftStatus,
    FindingCategory,
    FindingSeverity,
    FindingStatus,
    PreflightEvaluationRunStatus,
)
from app.schemas.common import ORMModel, StrictPayload

Title = Annotated[str, Field(min_length=1, max_length=200)]
OptText = Annotated[str | None, Field(default=None, max_length=5000)]
OptShort = Annotated[str | None, Field(default=None, max_length=200)]
OptUrl = Annotated[str | None, Field(default=None, max_length=2000)]
Reason = Annotated[str, Field(min_length=1, max_length=2000)]


class TimestampsOut(ORMModel):
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None


# --------------------------------------------------------------------- CampaignDraft


class CampaignDraftCreate(StrictPayload):
    title: Title
    ad_account_id: uuid.UUID | None = None
    objective: OptShort = None
    primary_copy: str = Field(default="", max_length=5000)
    headline: OptShort = None
    description: OptText = None
    call_to_action: OptShort = None
    landing_page_url: OptUrl = None
    creative_reference: OptUrl = None
    budget_amount: Decimal | None = None
    budget_currency: Annotated[str | None, Field(default=None, min_length=3, max_length=8)] = None
    budget_change_percent: Decimal | None = None
    targeting_summary: OptText = None

    @field_validator("landing_page_url")
    @classmethod
    def _http_only(cls, value: str | None) -> str | None:
        if value and not value.lower().startswith(("http://", "https://")):
            raise ValueError("landing_page_url must start with http:// or https://")
        return value


class CampaignDraftUpdate(StrictPayload):
    title: Title | None = None
    ad_account_id: uuid.UUID | None = None
    objective: OptShort = None
    primary_copy: str | None = Field(default=None, max_length=5000)
    headline: OptShort = None
    description: OptText = None
    call_to_action: OptShort = None
    landing_page_url: OptUrl = None
    creative_reference: OptUrl = None
    budget_amount: Decimal | None = None
    budget_currency: Annotated[str | None, Field(default=None, min_length=3, max_length=8)] = None
    budget_change_percent: Decimal | None = None
    targeting_summary: OptText = None

    @field_validator("landing_page_url")
    @classmethod
    def _http_only(cls, value: str | None) -> str | None:
        if value and not value.lower().startswith(("http://", "https://")):
            raise ValueError("landing_page_url must start with http:// or https://")
        return value


class CampaignDraftOut(TimestampsOut):
    id: uuid.UUID
    workspace_id: uuid.UUID
    ad_account_id: uuid.UUID | None
    account_display_name: str | None = None
    title: str
    objective: str | None
    primary_copy: str
    headline: str | None
    description: str | None
    call_to_action: str | None
    landing_page_url: str | None
    creative_reference: str | None
    budget_amount: Decimal | None
    budget_currency: str | None
    budget_change_percent: Decimal | None
    targeting_summary: str | None
    draft_status: DraftStatus
    last_evaluated_at: datetime | None
    open_blocking_count: int = 0
    open_warning_count: int = 0
    created_by: uuid.UUID
    updated_by: uuid.UUID | None


# --------------------------------------------------------------------- PreflightFinding


class PreflightFindingOut(TimestampsOut):
    id: uuid.UUID
    draft_id: uuid.UUID
    evaluation_run_id: uuid.UUID
    category: FindingCategory
    severity: FindingSeverity
    rule_key: str
    rule_version: int
    message: str
    field_reference: str | None
    evidence_reference: str | None
    recommended_action: str
    status: FindingStatus
    resolved_at: datetime | None
    resolved_by: uuid.UUID | None
    resolution_reason: str | None


class FindingActionRequest(StrictPayload):
    reason: Reason


# --------------------------------------------------------------------- PreflightEvaluationRun


class PreflightEvaluationRunOut(ORMModel):
    id: uuid.UUID
    draft_id: uuid.UUID
    status: PreflightEvaluationRunStatus
    engine_version: str
    started_at: datetime
    completed_at: datetime | None
    error_code: str | None
    error_summary: str | None
    result_summary_json: dict | None
    created_at: datetime


# --------------------------------------------------------------------- LandingPageEvidence


class LandingPageEvidenceOut(ORMModel):
    id: uuid.UUID
    draft_id: uuid.UUID
    url: str
    final_url: str | None
    http_status: int | None
    is_https: bool
    redirect_count: int | None
    response_time_ms: int | None
    mobile_viewport_meta_present: bool | None
    contact_or_policy_link_detected: bool | None
    fetch_error: str | None
    checked_at: datetime
    expires_at: datetime | None
