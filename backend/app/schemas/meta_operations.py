"""A7 request/response schemas — BM + ad account creation & sharing via the official Meta API."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import Field

from app.core.enums import MetaBatchItemStatus, MetaEnvironment, ReferenceStatus
from app.schemas.common import ORMModel, StrictPayload

Label = Annotated[str, Field(min_length=1, max_length=200)]
Currency = Annotated[str, Field(min_length=3, max_length=3)]
OptCountry = Annotated[str | None, Field(default=None, min_length=2, max_length=2)]
OptShort = Annotated[str | None, Field(default=None, max_length=200)]


class TimestampsOut(ORMModel):
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None


# --------------------------------------------------------------------- MetaConnection


class MetaConnectionCreate(StrictPayload):
    label: Label
    environment: MetaEnvironment = MetaEnvironment.FAKE
    notes: str = Field(default="", max_length=2000)


class DiscoveryImportRequest(StrictPayload):
    """A10.3. One ad account, named by the id the run itself returned.

    Deliberately not a list: an import writes a registry record this workspace is then answerable
    for, so each one is its own decision with its own audit row. A bulk variant would need A7's
    preview/confirm machinery, and A10.1 already established that copying that state machine a
    fourth time is the thing to avoid.
    """

    external_account_id: str = Field(min_length=1, max_length=120)


class MetaConnectionOut(TimestampsOut):
    """Built by the router as a plain dict, not `model_validate`ed straight off the ORM row —
    `token_configured` has no column (CLAUDE.md rule 18: never a stored token), it is computed
    from server config at request time."""

    id: uuid.UUID
    label: str
    environment: MetaEnvironment
    status: ReferenceStatus
    capabilities: dict | None
    last_capability_check_at: datetime | None
    business_managers: list[dict] | None
    #: Never the token itself — only whether server config has one for this environment.
    token_configured: bool
    notes: str


# --------------------------------------------------------------------- Account creation


class AccountCreationItemInput(StrictPayload):
    name: Label
    currency: Currency
    country: OptCountry = None
    #: Free text for people to read. Never sent to Meta.
    timezone: OptShort = None
    #: Meta's integer timezone identifier, which is what its create endpoint takes. Optional
    #: here because a draft is useful before it is known; a real create refuses without it
    #: rather than choosing one.
    timezone_id: int | None = None


class AccountCreationDraftRequest(StrictPayload):
    meta_connection_id: uuid.UUID
    business_manager_external_id: Annotated[str, Field(min_length=1, max_length=120)]
    items: list[AccountCreationItemInput] = Field(min_length=1, max_length=50)


class ConfirmBatchRequest(StrictPayload):
    preview_hash: Annotated[str, Field(min_length=1, max_length=64)]


class AccountCreationItemOut(ORMModel):
    id: uuid.UUID
    batch_id: uuid.UUID
    name: str
    currency: str
    country: str | None
    timezone: str | None
    timezone_id: int | None
    status: MetaBatchItemStatus
    external_account_id: str | None
    synced_ad_account_id: uuid.UUID | None
    failure_code: str | None
    failure_summary: str | None
    retry_count: int
    last_attempted_at: datetime | None


class AccountCreationBatchOut(TimestampsOut):
    id: uuid.UUID
    meta_connection_id: uuid.UUID
    business_manager_external_id: str
    preview_hash: str
    confirmed_at: datetime | None


class AccountCreationBatchDetailOut(ORMModel):
    batch: AccountCreationBatchOut
    items: list[AccountCreationItemOut]
    #: The *current* hash — compare against `batch.preview_hash` to see staleness before confirm.
    current_preview_hash: str


# --------------------------------------------------------------------- Access share


class ShareItemInput(StrictPayload):
    source_external_account_id: Annotated[str, Field(min_length=1, max_length=120)]
    recipient_reference: Annotated[str, Field(min_length=1, max_length=200)]
    role: Annotated[str, Field(min_length=1, max_length=64)]


class AccessShareDraftRequest(StrictPayload):
    meta_connection_id: uuid.UUID
    items: list[ShareItemInput] = Field(min_length=1, max_length=50)


class AccessShareItemOut(ORMModel):
    id: uuid.UUID
    batch_id: uuid.UUID
    source_ad_account_id: uuid.UUID | None
    source_external_account_id: str
    recipient_reference: str
    role: str
    status: MetaBatchItemStatus
    access_grant_reference: str | None
    failure_code: str | None
    failure_summary: str | None
    retry_count: int
    last_attempted_at: datetime | None


class AccessShareBatchOut(TimestampsOut):
    id: uuid.UUID
    meta_connection_id: uuid.UUID
    preview_hash: str
    confirmed_at: datetime | None


class AccessShareBatchDetailOut(ORMModel):
    batch: AccessShareBatchOut
    items: list[AccessShareItemOut]
    current_preview_hash: str


# --------------------------------------------------------------------- Pixel share (A8)


class PixelShareItemInput(StrictPayload):
    source_external_pixel_id: Annotated[str, Field(min_length=1, max_length=120)]
    target_ad_account_external_id: Annotated[str, Field(min_length=1, max_length=120)]


class PixelShareDraftRequest(StrictPayload):
    meta_connection_id: uuid.UUID
    items: list[PixelShareItemInput] = Field(min_length=1, max_length=50)


class PixelShareItemOut(ORMModel):
    id: uuid.UUID
    batch_id: uuid.UUID
    source_pixel_id: uuid.UUID | None
    source_external_pixel_id: str
    target_ad_account_id: uuid.UUID | None
    target_ad_account_external_id: str
    status: MetaBatchItemStatus
    access_grant_reference: str | None
    failure_code: str | None
    failure_summary: str | None
    retry_count: int
    last_attempted_at: datetime | None


class PixelShareBatchOut(TimestampsOut):
    id: uuid.UUID
    meta_connection_id: uuid.UUID
    preview_hash: str
    confirmed_at: datetime | None


class PixelShareBatchDetailOut(ORMModel):
    batch: PixelShareBatchOut
    items: list[PixelShareItemOut]
    current_preview_hash: str
