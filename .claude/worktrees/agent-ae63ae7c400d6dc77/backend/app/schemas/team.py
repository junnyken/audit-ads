"""MINI-SPEC A9 schemas."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.enums import AssignmentStatus, DeviceSessionType, InvitationStatus, WorkspaceMemberStatus
from app.schemas.common import ORMModel, StrictPayload

ReasonField = Annotated[str, Field(min_length=1, max_length=200)]


class DeviceSessionOut(ORMModel):
    id: uuid.UUID
    session_type: DeviceSessionType
    label: str
    browser_family: str | None
    os_family: str | None
    last_seen_at: datetime | None
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    revoked_reason: str | None
    is_current: bool = False

    #: Never `ip_hash` here — it exists only for a later abuse-investigation lookup, not for
    #: display (A9 guardrail 20: no raw IP, and the hash itself is not operator-facing data).


class RevokeSessionResult(ORMModel):
    revoked_count: int


class SessionRevokeRequest(StrictPayload):
    #: Required when revoking *another* member's session (owner-only); ignored/optional when
    #: revoking your own.
    reason: Annotated[str, Field(max_length=200)] | None = None


# ---------------------------------------------------------------------------------------- seats


class SeatPlanOut(ORMModel):
    id: uuid.UUID
    seat_limit: int
    plan_reference: str | None
    created_at: datetime
    updated_at: datetime


class SeatPlanUpdateRequest(StrictPayload):
    seat_limit: Annotated[int, Field(ge=0)]
    plan_reference: Annotated[str, Field(max_length=120)] | None = None


class TeamSummaryOut(ORMModel):
    seat_limit: int | None
    active_members: int
    available_seats: int | None
    pending_invitations: int
    plan_reference: str | None


# -------------------------------------------------------------------------------------- members


class MemberOut(ORMModel):
    id: uuid.UUID
    user_id: uuid.UUID
    email: str
    full_name: str
    role: str  # A9 vocabulary (owner/admin/operator/viewer) or the pass-through existing value
    status: WorkspaceMemberStatus
    is_archived: bool
    assigned_business_manager_count: int
    assigned_ad_account_count: int
    active_session_count: int
    created_at: datetime


class RoleChangeRequest(StrictPayload):
    role: Annotated[str, Field(pattern="^(admin|operator|viewer)$")]


class ReasonRequest(StrictPayload):
    reason: ReasonField


class AccessPreviewOut(ORMModel):
    is_owner: bool
    business_manager_ids: list[uuid.UUID]
    ad_account_ids: list[uuid.UUID]


# ----------------------------------------------------------------------------------- invitations


class InvitationOut(ORMModel):
    id: uuid.UUID
    email_normalized: str
    invited_role: str
    status: InvitationStatus
    token_last_four: str | None
    expires_at: datetime
    sent_at: datetime | None
    accepted_at: datetime | None
    revoked_at: datetime | None
    revoke_reason: str | None
    created_at: datetime


class InvitationCreateRequest(StrictPayload):
    email: EmailStr
    role: Annotated[str, Field(pattern="^(admin|operator|viewer)$")]


class InvitationCreateResponse(ORMModel):
    invitation: InvitationOut
    #: Present only in this one response, right after creation/resend — never persisted,
    #: never returned by any other endpoint (A9 guardrail 16).
    invite_link_token: str


class InvitationAcceptRequest(BaseModel):
    """The *second* endpoint where credential-shaped fields legitimately appear in a request
    body — `LoginRequest` is the first, and carries the same note.

    `StrictPayload` refuses any field whose name contains "token" or "password" (CLAUDE.md
    rule 1), which is exactly right everywhere else: no other route in this product has any
    business receiving one. Accepting an invitation genuinely needs both — the one-time
    invitation token that proves the invite, and the password a brand-new employee is choosing
    for the account being created right here. Neither is ever stored as given: the token is
    compared by hash and never persisted, the password becomes a PBKDF2 hash. The log/audit
    redactor masks both by name regardless.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    token: str
    #: Required only for a brand-new email; ignored (and never used to change a password) when
    #: the caller is already authenticated as the invitation's existing account.
    password: Annotated[str, Field(min_length=8, max_length=200)] | None = None
    full_name: Annotated[str, Field(max_length=200)] = ""


class InvitationAcceptResponse(ORMModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime


# ---------------------------------------------------------------------------------- assignments


class BusinessManagerAssignmentCreateRequest(StrictPayload):
    business_manager_id: uuid.UUID


class AdAccountAssignmentCreateRequest(StrictPayload):
    ad_account_id: uuid.UUID


class AssignmentOut(ORMModel):
    id: uuid.UUID
    member_id: uuid.UUID
    business_manager_id: uuid.UUID | None = None
    ad_account_id: uuid.UUID | None = None
    status: AssignmentStatus
    assigned_at: datetime
    revoked_at: datetime | None
    revoke_reason: str | None


class MemberAssignmentsOut(ORMModel):
    business_managers: list[AssignmentOut]
    ad_accounts: list[AssignmentOut]
