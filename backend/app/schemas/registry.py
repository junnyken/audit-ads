from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import Field, field_validator

from app.core.enums import (
    AccountStatus,
    AccountType,
    AssetType,
    ReadinessStatus,
    ReferenceStatus,
)
from app.schemas.common import ORMModel, StrictPayload, reject_credential_like

Name = Annotated[str, Field(min_length=1, max_length=200)]
OptName = Annotated[str | None, Field(default=None, max_length=200)]
Notes = Annotated[str, Field(default="", max_length=5000)]
ExternalId = Annotated[str | None, Field(default=None, max_length=120)]
Country = Annotated[str | None, Field(default=None, min_length=2, max_length=2)]
Currency = Annotated[str | None, Field(default=None, min_length=3, max_length=3)]
Url = Annotated[str | None, Field(default=None, max_length=2048)]


def _upper(value: str | None) -> str | None:
    return value.upper() if value else value


class TimestampsOut(ORMModel):
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None


# --------------------------------------------------------------------- Business Manager
class BusinessManagerCreate(StrictPayload):
    name: Name
    external_id: ExternalId = None
    status: ReferenceStatus = ReferenceStatus.UNKNOWN
    country: Country = None
    currency: Currency = None
    notes: Notes = ""

    @field_validator("country")
    @classmethod
    def _norm_country(cls, value: str | None) -> str | None:
        return _upper(value)

    @field_validator("currency")
    @classmethod
    def _norm_currency(cls, value: str | None) -> str | None:
        return _upper(value)


class BusinessManagerUpdate(StrictPayload):
    name: OptName = None
    external_id: ExternalId = None
    status: ReferenceStatus | None = None
    country: Country = None
    currency: Currency = None
    notes: str | None = Field(default=None, max_length=5000)


class BusinessManagerOut(TimestampsOut):
    id: uuid.UUID
    name: str
    external_id: str | None
    status: ReferenceStatus
    country: str | None
    currency: str | None
    notes: str


# ------------------------------------------------------- Personal account reference
class PersonalAccountReferenceCreate(StrictPayload):
    label: Name
    display_name: str = Field(default="", max_length=200)
    external_reference_id: ExternalId = None
    status: ReferenceStatus = ReferenceStatus.UNKNOWN
    country: Country = None
    timezone: str | None = Field(default=None, max_length=64)
    notes: Notes = ""


class PersonalAccountReferenceUpdate(StrictPayload):
    label: OptName = None
    display_name: OptName = None
    external_reference_id: ExternalId = None
    status: ReferenceStatus | None = None
    country: Country = None
    timezone: str | None = Field(default=None, max_length=64)
    notes: str | None = Field(default=None, max_length=5000)


class PersonalAccountReferenceOut(TimestampsOut):
    id: uuid.UUID
    label: str
    display_name: str
    external_reference_id: str | None
    status: ReferenceStatus
    country: str | None
    timezone: str | None
    notes: str


# ------------------------------------------------------------------------------ Page
class PageCreate(StrictPayload):
    name: Name
    external_page_id: ExternalId = None
    url: Url = None
    category: str | None = Field(default=None, max_length=120)
    status: ReferenceStatus = ReferenceStatus.UNKNOWN
    notes: Notes = ""


class PageUpdate(StrictPayload):
    name: OptName = None
    external_page_id: ExternalId = None
    url: Url = None
    category: str | None = Field(default=None, max_length=120)
    status: ReferenceStatus | None = None
    notes: str | None = Field(default=None, max_length=5000)


class PageOut(TimestampsOut):
    id: uuid.UUID
    name: str
    external_page_id: str | None
    url: str | None
    category: str | None
    status: ReferenceStatus
    notes: str


# ----------------------------------------------------------------------------- Pixel
class PixelCreate(StrictPayload):
    name: Name
    external_pixel_id: ExternalId = None
    status: ReferenceStatus = ReferenceStatus.UNKNOWN
    notes: Notes = ""


class PixelUpdate(StrictPayload):
    name: OptName = None
    external_pixel_id: ExternalId = None
    status: ReferenceStatus | None = None
    notes: str | None = Field(default=None, max_length=5000)


class PixelOut(TimestampsOut):
    id: uuid.UUID
    name: str
    external_pixel_id: str | None
    status: ReferenceStatus
    notes: str


# ------------------------------------------------------- Payment profile reference
class PaymentProfileReferenceCreate(StrictPayload):
    """A label pointing at a payment arrangement managed elsewhere. No card data, ever."""

    reference_code: Annotated[str, Field(min_length=1, max_length=120)]
    label: str = Field(default="", max_length=200)
    provider: str | None = Field(default=None, max_length=120)
    billing_country: Country = None
    currency: Currency = None
    status: ReferenceStatus = ReferenceStatus.UNKNOWN
    notes: Notes = ""


class PaymentProfileReferenceUpdate(StrictPayload):
    reference_code: str | None = Field(default=None, max_length=120)
    label: OptName = None
    provider: str | None = Field(default=None, max_length=120)
    billing_country: Country = None
    currency: Currency = None
    status: ReferenceStatus | None = None
    notes: str | None = Field(default=None, max_length=5000)


class PaymentProfileReferenceOut(TimestampsOut):
    id: uuid.UUID
    reference_code: str
    label: str
    provider: str | None
    billing_country: str | None
    currency: str | None
    status: ReferenceStatus
    notes: str


# ------------------------------------------------------- Browser profile reference
class BrowserProfileReferenceCreate(StrictPayload):
    profile_reference: Annotated[str, Field(min_length=1, max_length=200)]
    provider: str = Field(default="chrome", max_length=120)
    label: str = Field(default="", max_length=200)
    local_or_remote: str = Field(default="local", pattern="^(local|remote)$")
    status: ReferenceStatus = ReferenceStatus.UNKNOWN
    notes: Notes = ""

    @field_validator("profile_reference")
    @classmethod
    def _no_credentials(cls, value: str) -> str:
        return reject_credential_like(value, field="profile_reference")


class BrowserProfileReferenceUpdate(StrictPayload):
    profile_reference: str | None = Field(default=None, max_length=200)
    provider: str | None = Field(default=None, max_length=120)
    label: OptName = None
    local_or_remote: str | None = Field(default=None, pattern="^(local|remote)$")
    status: ReferenceStatus | None = None
    notes: str | None = Field(default=None, max_length=5000)

    @field_validator("profile_reference")
    @classmethod
    def _no_credentials(cls, value: str | None) -> str | None:
        return reject_credential_like(value, field="profile_reference")


class BrowserProfileReferenceOut(TimestampsOut):
    id: uuid.UUID
    profile_reference: str
    provider: str
    label: str
    local_or_remote: str
    status: ReferenceStatus
    last_used_at: datetime | None
    notes: str


# ----------------------------------------------------------------- Proxy reference
class ProxyReferenceCreate(StrictPayload):
    """An opaque operator label. Hostnames, credentials and connection strings are refused."""

    proxy_reference: Annotated[str, Field(min_length=1, max_length=200)]
    provider: str = Field(default="", max_length=120)
    label: str = Field(default="", max_length=200)
    country: Country = None
    region: str | None = Field(default=None, max_length=120)
    protocol: str | None = Field(default=None, pattern="^(http|https|socks5)$")
    status: ReferenceStatus = ReferenceStatus.UNKNOWN
    notes: Notes = ""

    @field_validator("proxy_reference")
    @classmethod
    def _no_credentials(cls, value: str) -> str:
        return reject_credential_like(value, field="proxy_reference")


class ProxyReferenceUpdate(StrictPayload):
    proxy_reference: str | None = Field(default=None, max_length=200)
    provider: str | None = Field(default=None, max_length=120)
    label: OptName = None
    country: Country = None
    region: str | None = Field(default=None, max_length=120)
    protocol: str | None = Field(default=None, pattern="^(http|https|socks5)$")
    status: ReferenceStatus | None = None
    notes: str | None = Field(default=None, max_length=5000)

    @field_validator("proxy_reference")
    @classmethod
    def _no_credentials(cls, value: str | None) -> str | None:
        return reject_credential_like(value, field="proxy_reference")


class ProxyReferenceOut(TimestampsOut):
    id: uuid.UUID
    proxy_reference: str
    provider: str
    label: str
    country: str | None
    region: str | None
    protocol: str | None
    status: ReferenceStatus
    notes: str


# -------------------------------------------------------------------------- Ad account
class AdAccountCreate(StrictPayload):
    display_name: Name
    external_account_id: ExternalId = None
    account_type: AccountType = AccountType.UNKNOWN
    business_manager_id: uuid.UUID | None = None
    personal_account_reference_id: uuid.UUID | None = None
    owner_label: str = Field(default="", max_length=200)
    country: Country = None
    currency: Currency = None
    timezone: str | None = Field(default=None, max_length=64)
    status: AccountStatus = AccountStatus.UNKNOWN
    requires_page: bool = False
    requires_pixel: bool = False
    landing_page_url: Url = None
    tags: list[Annotated[str, Field(max_length=48)]] = Field(default_factory=list, max_length=20)
    notes: Notes = ""

    @field_validator("country")
    @classmethod
    def _norm_country(cls, value: str | None) -> str | None:
        return _upper(value)

    @field_validator("currency")
    @classmethod
    def _norm_currency(cls, value: str | None) -> str | None:
        return _upper(value)

    @field_validator("landing_page_url")
    @classmethod
    def _http_only(cls, value: str | None) -> str | None:
        if value and not value.lower().startswith(("http://", "https://")):
            raise ValueError("landing_page_url must start with http:// or https://")
        return value


class AdAccountUpdate(StrictPayload):
    display_name: OptName = None
    external_account_id: ExternalId = None
    account_type: AccountType | None = None
    business_manager_id: uuid.UUID | None = None
    personal_account_reference_id: uuid.UUID | None = None
    owner_label: OptName = None
    country: Country = None
    currency: Currency = None
    timezone: str | None = Field(default=None, max_length=64)
    status: AccountStatus | None = None
    requires_page: bool | None = None
    requires_pixel: bool | None = None
    landing_page_url: Url = None
    tags: list[Annotated[str, Field(max_length=48)]] | None = Field(default=None, max_length=20)
    notes: str | None = Field(default=None, max_length=5000)

    @field_validator("landing_page_url")
    @classmethod
    def _http_only(cls, value: str | None) -> str | None:
        if value and not value.lower().startswith(("http://", "https://")):
            raise ValueError("landing_page_url must start with http:// or https://")
        return value


class OwnershipRef(ORMModel):
    id: uuid.UUID
    name: str


class AdAccountOut(TimestampsOut):
    id: uuid.UUID
    display_name: str
    external_account_id: str | None
    account_type: AccountType
    business_manager_id: uuid.UUID | None
    personal_account_reference_id: uuid.UUID | None
    business_manager_name: str | None = None
    personal_account_reference_label: str | None = None
    owner_label: str
    country: str | None
    currency: str | None
    timezone: str | None
    status: AccountStatus
    readiness_status: ReadinessStatus
    readiness_evaluated_at: datetime | None
    last_manual_review_at: datetime | None
    last_synced_at: datetime | None
    last_activity_at: datetime | None
    requires_page: bool
    requires_pixel: bool
    landing_page_url: str | None
    tags: list[str]
    notes: str


class AdAccountListItem(AdAccountOut):
    required_item_count: int = 0
    completed_item_count: int = 0
    has_browser_reference: bool = False
    has_proxy_reference: bool = False


class ManualReviewRequest(StrictPayload):
    note: Annotated[str, Field(min_length=1, max_length=2000)]


# ------------------------------------------------------------------------- Asset links
class AssetLinkCreate(StrictPayload):
    asset_type: AssetType
    asset_id: uuid.UUID
    note: str = Field(default="", max_length=2000)


class AssetLinkUpdate(StrictPayload):
    note: str = Field(default="", max_length=2000)


class AssetLinkOut(ORMModel):
    id: uuid.UUID
    ad_account_id: uuid.UUID
    asset_type: AssetType
    asset_id: uuid.UUID
    asset_label: str | None = None
    linked_at: datetime
    linked_by: uuid.UUID | None
    unlinked_at: datetime | None
    unlinked_by: uuid.UUID | None
    note: str
    is_active: bool
