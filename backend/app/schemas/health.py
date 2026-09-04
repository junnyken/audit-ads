from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, Field, field_validator

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
from app.schemas.common import ORMModel, StrictPayload, reject_credential_like

#: Repeated on every health payload so no consumer can present a health state as a platform
#: verdict. `clear_signals` in particular means "no current issues found by configured checks".
HEALTH_DISCLAIMER = (
    "Account health is an internal operational state derived from records you entered. "
    "clear_signals means no current issues were found by the configured checks; it is not a "
    "platform approval, not a safety guarantee, and not a prediction of enforcement."
)


class HealthReasonOut(BaseModel):
    code: str
    severity: str
    signal_id: str | None = None
    message: str
    observed_at: str = ""
    rule_key: str
    rule_version: int
    status: str


class HealthCountsOut(BaseModel):
    critical: int = 0
    warning: int = 0
    attention: int = 0
    unknown: int = 0


class ReadinessRefOut(BaseModel):
    """A1 readiness travels alongside health but is never merged into it."""

    status: str
    evaluated_at: str | None = None


class AccountHealthOut(BaseModel):
    ad_account_id: str
    health_status: HealthStatus
    status_description: str
    freshness_status: HealthFreshness
    evaluated_at: str | None
    engine_version: str
    counts: HealthCountsOut
    summary_reasons: list[HealthReasonOut]
    readiness: ReadinessRefOut
    disclaimer: str = HEALTH_DISCLAIMER


class HealthSignalOut(ORMModel):
    id: uuid.UUID
    ad_account_id: uuid.UUID
    rule_key: str
    rule_version: int
    signal_key: str
    category: HealthCategory
    severity: SignalSeverity
    status: SignalStatus
    source_type: HealthSourceType
    source_entity_type: str | None
    source_entity_id: str | None
    evidence_json: dict[str, Any]
    observed_at: datetime
    last_evaluated_at: datetime
    expires_at: datetime | None
    acknowledged_at: datetime | None
    acknowledged_by: uuid.UUID | None
    acknowledgement_note: str | None
    resolved_at: datetime | None
    resolved_by: uuid.UUID | None
    resolution_reason: str | None
    resolution_evidence_reference: str | None
    superseded_at: datetime | None
    superseded_by_signal_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None
    # Filled from the rule registry so the UI never has to hard-code guidance text.
    rule_name: str | None = None
    why_it_matters: str | None = None
    recommended_next_step: str | None = None
    resolution_guidance: str | None = None


class AccountHealthRow(BaseModel):
    ad_account_id: str
    display_name: str
    external_account_id: str | None
    business_manager_name: str | None
    personal_account_reference_label: str | None
    owner_label: str
    account_status: str
    account_type: str
    readiness_status: str
    health_status: HealthStatus
    freshness_status: HealthFreshness
    open_critical_count: int
    open_warning_count: int
    open_attention_count: int
    open_unknown_count: int
    last_evaluated_at: str | None
    top_reason: HealthReasonOut | None
    archived: bool


class HealthSummaryOut(BaseModel):
    total_active: int
    critical: int
    warning: int
    attention_needed: int
    unknown: int
    clear_signals: int
    stale_data: int
    never_evaluated: int
    last_evaluation_at: datetime | None
    failed_runs_recent: int
    disclaimer: str = HEALTH_DISCLAIMER


class AcknowledgeRequest(StrictPayload):
    note: Annotated[str, Field(min_length=1, max_length=2000)]


class ResolveRequest(StrictPayload):
    reason: Annotated[str, Field(min_length=1, max_length=2000)]
    evidence_reference: str | None = Field(default=None, max_length=500)

    @field_validator("evidence_reference")
    @classmethod
    def _no_credentials(cls, value: str | None) -> str | None:
        return reject_credential_like(value, field="evidence_reference")


class ReopenRequest(StrictPayload):
    reason: Annotated[str, Field(min_length=1, max_length=2000)]


class BackfillRequest(StrictPayload):
    #: The UI must ask before starting a batch; the API refuses without it.
    confirm: bool = False
    batch_size: int | None = Field(default=None, ge=1, le=50)


class HealthRuleOut(ORMModel):
    id: uuid.UUID
    rule_key: str
    version: int
    name: str
    description: str
    category: HealthCategory
    enabled: bool
    severity: SignalSeverity
    source_requirements_json: dict[str, Any]
    resolution_guidance: str
    created_at: datetime
    updated_at: datetime
    why_it_matters: str | None = None
    recommended_next_step: str | None = None
    applicability: str | None = None


class EvaluationRunOut(ORMModel):
    id: uuid.UUID
    ad_account_id: uuid.UUID | None
    trigger_type: EvaluationTrigger
    trigger_reference_id: str | None
    status: EvaluationRunStatus
    engine_version: str
    started_at: datetime
    completed_at: datetime | None
    error_code: str | None
    error_summary: str | None
    result_summary_json: dict[str, Any] | None
    request_id: str | None
    created_at: datetime
