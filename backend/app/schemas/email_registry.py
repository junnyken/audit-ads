"""P1 strict intake. All errors use constant messages, never rejected values."""

from __future__ import annotations

import re
import unicodedata
import uuid
from datetime import UTC, datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AwareDatetime, BaseModel, ConfigDict, StrictBool, field_validator, model_validator

from app.schemas.common import StrictPayload, reject_credential_like

Provider = Literal["gmail", "microsoft"]
Kind = Literal["personal", "managed", "unknown"]
State = Literal["unknown", "pending", "recorded", "blocked"]


def normalize_address(value: str) -> str:
    if any(unicodedata.category(c).startswith("C") for c in value):
        raise ValueError("Invalid contact address.")
    value = value.strip()
    if not value.isascii() or not 3 <= len(value) <= 320 or value.count("@") != 1:
        raise ValueError("Invalid contact address.")
    local, domain = value.split("@")
    if (
        not 1 <= len(local) <= 64
        or not re.fullmatch(r"[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+", local)
        or local.startswith(".")
        or local.endswith(".")
        or ".." in local
    ):
        raise ValueError("Invalid contact address.")
    if "." not in domain or any(
        not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label)
        for label in domain.split(".")
    ):
        raise ValueError("Invalid contact address.")
    return value.lower()


class Metadata(StrictPayload):
    @model_validator(mode="before")
    @classmethod
    def reject_raw_controls(cls, data):
        # Run before StrictPayload whitespace coercion can erase CR/LF at either end.
        if isinstance(data, dict):
            for name in ("contact_address", "next_action", "reason", "review_timezone"):
                value = data.get(name)
                if isinstance(value, str) and any(unicodedata.category(c).startswith("C") for c in value):
                    raise ValueError("Control characters are not permitted.")
        return data

    review_due_at: AwareDatetime | None = None
    review_timezone: str | None = None
    next_action: str | None = None

    @field_validator("review_due_at", mode="before")
    @classmethod
    def timestamp(cls, v):
        if v is not None and (
            not isinstance(v, str)
            or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)", v)
        ):
            raise ValueError("An offset RFC3339 timestamp is required.")
        return v

    @field_validator("next_action", "review_timezone")
    @classmethod
    def text(cls, v, info):
        if v is None:
            return v
        limit = 240 if info.field_name == "next_action" else 64
        if (
            re.search(r"(?i)(?:password|passwd|secret|token|cookie|otp|totp|pin)\s*[:=]", v)
            or not v
            or len(v) > limit
            or any(ord(c) < 32 or ord(c) == 127 for c in v)
            or "@" in v
        ):
            raise ValueError("Invalid metadata text.")
        return reject_credential_like(v, field=info.field_name)

    @model_validator(mode="after")
    def due(self):
        # PATCH may omit either side; service validates the merged pair as well.
        if self.review_timezone is not None:
            try:
                zone = ZoneInfo(self.review_timezone)
            except (ZoneInfoNotFoundError, ValueError):
                raise ValueError("Invalid review timezone.") from None
            if (
                self.review_due_at is not None
                and self.review_due_at.utcoffset() != self.review_due_at.astimezone(zone).utcoffset()
            ):
                raise ValueError("Review timezone offset mismatch.")
        return self


class Create(Metadata):
    contact_address: str
    provider: Provider
    account_kind: Kind | None = None
    responsible_member_id: uuid.UUID | None = None

    @field_validator("contact_address")
    @classmethod
    def address(cls, v):
        return normalize_address(v)

    @model_validator(mode="after")
    def kind(self):
        if "account_kind" in self.model_fields_set and self.account_kind is None:
            raise ValueError("Account kind cannot be null.")
        self.account_kind = self.account_kind or ("personal" if self.provider == "gmail" else "unknown")
        if self.account_kind == "managed" or (self.provider == "gmail" and self.account_kind != "personal"):
            raise ValueError("Invalid initial account kind.")
        if (self.review_due_at is None) != (self.review_timezone is None):
            raise ValueError("Review date and timezone must be supplied together.")
        return self


class Patch(Metadata):
    account_kind: Kind | None = None
    state: State | None = None
    evidence_observed_at: AwareDatetime | None = None
    reason: str | None = None

    @field_validator("evidence_observed_at", mode="before")
    @classmethod
    def observed(cls, v):
        return Metadata.timestamp(v)

    @field_validator("reason")
    @classmethod
    def reason_text(cls, v):
        if v is not None:
            if (
                re.search(r"(?i)(?:password|passwd|secret|token|cookie|otp|totp|pin)\s*[:=]", v)
                or not v
                or len(v) > 500
                or "@" in v
                or any(ord(c) < 32 or ord(c) == 127 for c in v)
            ):
                raise ValueError("Invalid reason.")
            reject_credential_like(v, field="reason")
        return v

    @model_validator(mode="after")
    def nonempty(self):
        if not self.model_fields_set or any(
            getattr(self, k) is None
            for k in self.model_fields_set & {"state", "account_kind", "evidence_observed_at"}
        ):
            raise ValueError("Empty patch or null required field.")
        if self.evidence_observed_at and self.evidence_observed_at > datetime.now(UTC):
            raise ValueError("Observation cannot be in the future.")
        return self


class Reassign(StrictPayload):
    responsible_member_id: uuid.UUID | None


# Explicit outbound allowlists; never construct responses with ORM serialization.


class ListOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: uuid.UUID
    address_hint: str
    provider: Provider
    account_kind: Kind
    responsible_member_id: uuid.UUID | None
    state: State
    review_due_at: str | None
    overdue: bool
    updated_at: str
    version: int
    archived_at: str | None


class DetailOut(ListOut):
    evidence_source: Literal["manual_attestation"] | None
    evidence_observed_at: str | None
    evidence_recorded_at: str | None
    evidence_recorded_by: uuid.UUID | None
    review_timezone: str | None
    next_action: str | None
    reason: str | None
    created_at: str
    created_by: uuid.UUID
    updated_by: uuid.UUID
    archived_by: uuid.UUID | None
    can_reveal_address: bool


class RevealOut(BaseModel):
    address: str


class HistoryOut(BaseModel):
    id: uuid.UUID
    action: str
    entity_id: uuid.UUID
    actor_id: uuid.UUID | None
    created_at: str
    request_id: str | None
    before: dict
    after: dict
    metadata: dict


class EligibleMemberOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: uuid.UUID
    full_name: str


class ReminderPolicy(StrictPayload):
    email_registry_in_app_reminders_enabled: StrictBool
