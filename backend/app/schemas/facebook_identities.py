"""F1 request/response shapes for Facebook account profiles and the reveal PIN.

Two request bodies here are deliberate exceptions to `StrictPayload` (CLAUDE.md rule 1), each a plain
`BaseModel` with `extra="forbid"`: they must carry a value that is *verified*, never stored — the PIN
(compared with a PBKDF2 hash) and, to set a PIN, the current login password. The redactor masks both
names (`pin`, `*_pin`, `*password*`) in every log line and audit row.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.enums import IdentityBusinessRole, IdentityOwnershipType, ReferenceStatus, TwoFactorMethod
from app.schemas.common import StrictPayload


class RevealEmailRequest(BaseModel):
    """Rule 1 exception (F1): the viewer's own PIN, checked against its hash, never stored."""

    model_config = ConfigDict(extra="forbid")

    pin: str = Field(min_length=1, max_length=12)


class RevealPinSetRequest(BaseModel):
    """Rule 1 exception (F1): the current login password proves who is setting the PIN; the new PIN is
    hashed. Neither is stored in plaintext, echoed, logged or audited."""

    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(min_length=1, max_length=200)
    new_pin: str = Field(min_length=1, max_length=12)


class RevealPinStatusOut(BaseModel):
    is_set: bool
    locked_until: datetime | None = None


class RevealEmailOut(BaseModel):
    email: str


class IdentityEmailUpdate(StrictPayload):
    """`null` or empty clears the stored email."""

    email: str | None = Field(default=None, max_length=320)


class IdentityEmailOut(BaseModel):
    email_hint: str | None
    #: False when the server has no vault key: only the masked hint was kept.
    email_stored: bool


class BusinessLinkCreate(StrictPayload):
    business_manager_id: uuid.UUID
    role: IdentityBusinessRole = IdentityBusinessRole.UNKNOWN
    note: str = Field(default="", max_length=1000)


class BusinessLinkOut(BaseModel):
    id: uuid.UUID
    business_manager_id: uuid.UUID
    business_manager_name: str
    business_manager_external_id: str | None
    role: IdentityBusinessRole
    note: str
    linked_at: datetime
    unlinked_at: datetime | None = None


class IdentitySummaryOut(BaseModel):
    id: uuid.UUID
    business_manager_count: int
    ad_account_count: int
    owner_member_name: str | None = None


class IdentityAdAccountOut(BaseModel):
    id: uuid.UUID
    display_name: str
    external_account_id: str | None
    business_manager_id: uuid.UUID | None
    status: str


class IdentityReaderOut(BaseModel):
    id: uuid.UUID
    label: str
    status: str


class IdentityProfileOut(BaseModel):
    business_links: list[BusinessLinkOut]
    ad_accounts: list[IdentityAdAccountOut]
    readers: list[IdentityReaderOut]
    owner_member_name: str | None = None
    has_full_email: bool
    can_reveal_email: bool


class AccountIdentityOut(BaseModel):
    """What an ad account shows under "Log in to fix this"."""

    id: uuid.UUID
    label: str
    status: ReferenceStatus
    two_factor_method: TwoFactorMethod
    vault_reference: str
    email_hint: str | None
    owner_member_id: uuid.UUID | None
    owner_member_name: str | None
    #: `direct` (the account is personal and points at this profile) or `business_manager`.
    via: str
    role: IdentityBusinessRole | None = None
    ownership_type: IdentityOwnershipType = IdentityOwnershipType.AGENCY_OWNED
    client_name: str = ""
    device_label: str = ""
    browser_profile_label: str = ""
    network_label: str = ""


class ReaderIdentityAssign(StrictPayload):
    """Which Facebook account granted a stored Meta reader. `null` clears it."""

    personal_account_reference_id: uuid.UUID | None = None
