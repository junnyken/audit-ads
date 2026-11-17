from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, Field, field_validator

from app.core.enums import ChecklistReviewStatus, EvidenceStatus, ReadinessStatus
from app.schemas.common import ORMModel, StrictPayload, reject_credential_like


class ReadinessReasonOut(BaseModel):
    code: str
    severity: str
    source_type: str
    source_id: str | None
    message: str


class ReadinessItemOut(BaseModel):
    item_key: str
    label: str
    category: str
    state: str
    required: bool
    is_mandatory: bool
    requirement_reason: str
    derived_from: str | None
    requires_evidence: bool
    evidence_status: str
    review_status: str
    expires_at: datetime | None
    message: str
    checklist_item_id: str | None


class DataFreshnessOut(BaseModel):
    status: str
    last_synced_at: str | None


class ReadinessOut(BaseModel):
    ad_account_id: str
    readiness_status: ReadinessStatus
    evaluated_at: str
    required_item_count: int
    completed_item_count: int
    reasons: list[ReadinessReasonOut]
    items: list[ReadinessItemOut]
    data_freshness: DataFreshnessOut
    #: Repeated on every readiness payload so no consumer can present it as platform approval.
    disclaimer: str = (
        "Readiness is an internal operational state derived from recorded evidence. It is not a "
        "platform approval, and it does not guarantee that an account cannot be restricted."
    )


class ReadinessSummaryOut(BaseModel):
    total_active: int
    operationally_ready: int
    ready_with_warnings: int
    not_ready: int
    unknown: int
    archived: int


class ChecklistItemOut(ORMModel):
    id: uuid.UUID
    ad_account_id: uuid.UUID
    item_key: str
    label: str
    category: str
    is_mandatory: bool
    evidence_status: EvidenceStatus
    review_status: ChecklistReviewStatus
    reviewed_at: datetime | None
    reviewed_by: uuid.UUID | None
    expires_at: datetime | None
    waiver_reason: str
    notes: str
    created_at: datetime
    updated_at: datetime


class ChecklistItemUpdate(StrictPayload):
    review_status: ChecklistReviewStatus | None = None
    notes: str | None = Field(default=None, max_length=5000)
    expires_at: datetime | None = None
    waiver_reason: str | None = Field(default=None, max_length=2000)


class EvidenceCreate(StrictPayload):
    evidence_type: Annotated[str, Field(min_length=1, max_length=80)]
    summary: Annotated[str, Field(min_length=1, max_length=5000)]
    storage_reference: str | None = Field(default=None, max_length=500)
    external_url: str | None = Field(default=None, max_length=2048)
    expires_at: datetime | None = None
    status: EvidenceStatus = EvidenceStatus.PROVIDED

    @field_validator("summary", "storage_reference", "external_url")
    @classmethod
    def _no_credentials(cls, value: str | None) -> str | None:
        return reject_credential_like(value, field="evidence")

    @field_validator("external_url")
    @classmethod
    def _http_only(cls, value: str | None) -> str | None:
        if value and not value.lower().startswith(("http://", "https://")):
            raise ValueError("external_url must start with http:// or https://")
        return value

    @field_validator("status")
    @classmethod
    def _no_direct_expiry(cls, value: EvidenceStatus) -> EvidenceStatus:
        if value == EvidenceStatus.EXPIRED:
            raise ValueError("Expiry is derived from expires_at, not set directly.")
        return value


class EvidenceUpdate(StrictPayload):
    status: EvidenceStatus | None = None
    summary: str | None = Field(default=None, max_length=5000)
    expires_at: datetime | None = None


class EvidenceOut(ORMModel):
    id: uuid.UUID
    checklist_item_id: uuid.UUID
    evidence_type: str
    storage_reference: str | None
    external_url: str | None
    summary: str
    provided_at: datetime
    provided_by: uuid.UUID | None
    verified_at: datetime | None
    verified_by: uuid.UUID | None
    expires_at: datetime | None
    status: EvidenceStatus
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ChecklistItemDetail(BaseModel):
    item: ChecklistItemOut
    evidence: list[EvidenceOut]
    evaluation: ReadinessItemOut | None = None


class ReadinessBoardRow(BaseModel):
    ad_account_id: uuid.UUID
    display_name: str
    external_account_id: str | None
    readiness_status: ReadinessStatus
    status: str
    required_item_count: int
    completed_item_count: int
    reasons: list[ReadinessReasonOut]


class ReadinessBoardGroup(BaseModel):
    code: str
    message: str
    severity: str
    accounts: list[dict[str, Any]]
