"""A5 extension schemas.

Field naming is constrained by A1's credential guard: any field whose name contains `token`,
`session`, `cookie`, `secret` or `authorization` is rejected before validation runs. That guard
is right, so the request models below use words like `client` and `connection` instead — the
same lesson A4 learned with `preview_token`.

No request model accepts a workspace id, a raw URL, a query string or anything credential-like.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, Field

from app.core.enums import ExtensionContextStatus, ExtensionEventType, ExtensionPageType
from app.schemas.common import StrictPayload


class ExtensionConnectRequest(StrictPayload):
    """Exchange a dashboard session for an extension session.

    There is no `workspace_id` field: the workspace comes from the authenticated membership,
    as it does everywhere else in this product.
    """

    extension_instance_id: Annotated[str, Field(min_length=8, max_length=64)]
    extension_version: Annotated[str, Field(min_length=1, max_length=32)]
    label: str = Field(default="", max_length=120)


class ExtensionConnectResponse(BaseModel):
    access_token: str
    expires_at: datetime
    installation_id: uuid.UUID
    workspace_name: str
    user_email: str
    token_use: str = "extension"


class ExtensionInstallationOut(BaseModel):
    id: uuid.UUID
    label: str
    extension_version: str
    last_seen_at: datetime | None
    revoked_at: datetime | None
    revoked_reason: str | None
    created_at: datetime
    is_active: bool


class ExtensionRevokeRequest(StrictPayload):
    installation_id: uuid.UUID | None = None
    reason: Annotated[str, Field(min_length=1, max_length=200)]


class ContextResolveRequest(StrictPayload):
    """What the content script observed.

    `safe_path` is a path, never a URL: the backend sanitises it again regardless, and anything
    unrecognised is discarded rather than stored.
    """

    external_account_id: str | None = Field(default=None, max_length=120)
    page_type: ExtensionPageType | None = None
    safe_path: str | None = Field(default=None, max_length=200)
    extension_version: str = Field(default="", max_length=32)


class ContextAccountOut(BaseModel):
    id: uuid.UUID
    display_name: str
    external_account_id: str | None
    business_manager_name: str | None
    owner_label: str | None
    status: str
    archived: bool


class ContextResolveResponse(BaseModel):
    context_status: ExtensionContextStatus
    reason_code: str | None = None
    message: str | None = None
    page_type: ExtensionPageType = ExtensionPageType.UNKNOWN
    safe_path: str | None = None
    account: ContextAccountOut | None = None
    readiness: dict[str, Any] | None = None
    health: dict[str, Any] | None = None
    alerts: dict[str, int] | None = None
    dashboard_paths: dict[str, str] | None = None
    disclaimer: str | None = None
    generated_at: datetime | None = None


class ExtensionSummaryResponse(BaseModel):
    account: ContextAccountOut
    readiness: dict[str, Any]
    health: dict[str, Any]
    alerts: dict[str, int]
    dashboard_paths: dict[str, str]
    disclaimer: str
    generated_at: datetime


class ExtensionEventRequest(StrictPayload):
    """An operator action recorded from the browser.

    The severity is not a field: the server decides it from the event type, because a client
    that could mark its own note "critical" would make the timeline worthless.
    """

    ad_account_id: uuid.UUID
    event_type: ExtensionEventType
    note: str = Field(default="", max_length=2000)
    occurred_at: datetime | None = None
    page_type: ExtensionPageType | None = None
    context_status: ExtensionContextStatus | None = None
    safe_path: str | None = Field(default=None, max_length=200)
    extension_version: str = Field(default="", max_length=32)


class ExtensionEventResponse(BaseModel):
    id: uuid.UUID
    ad_account_id: uuid.UUID
    event_type: str
    severity: str
    source: str
    occurred_at: datetime
    summary: str
    source_context: dict[str, Any] | None = None
    timeline_path: str
