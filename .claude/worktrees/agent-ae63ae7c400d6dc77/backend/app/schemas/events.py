from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import Field

from app.core.enums import EventSeverity, EventStatus
from app.schemas.common import ORMModel, StrictPayload


class AccountEventCreate(StrictPayload):
    event_type: Annotated[str, Field(min_length=1, max_length=120)]
    severity: EventSeverity = EventSeverity.INFO
    source: str = Field(default="manual", max_length=80)
    occurred_at: datetime | None = None
    summary: Annotated[str, Field(min_length=1, max_length=5000)]
    evidence_reference: str | None = Field(default=None, max_length=500)


class AccountEventUpdate(StrictPayload):
    severity: EventSeverity | None = None
    status: EventStatus | None = None
    summary: str | None = Field(default=None, max_length=5000)
    evidence_reference: str | None = Field(default=None, max_length=500)


class AccountEventResolve(StrictPayload):
    resolution_note: Annotated[str, Field(min_length=1, max_length=2000)]


class AccountEventOut(ORMModel):
    id: uuid.UUID
    ad_account_id: uuid.UUID
    event_type: str
    severity: EventSeverity
    source: str
    occurred_at: datetime
    summary: str
    evidence_reference: str | None
    status: EventStatus
    resolved_at: datetime | None
    resolved_by: uuid.UUID | None
    resolution_note: str
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime
