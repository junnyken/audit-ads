from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.enums import WorkspaceRole


class LoginRequest(BaseModel):
    """The one endpoint where a password legitimately appears in a request body.

    It is verified against a PBKDF2 hash and never stored, echoed or logged: the log/audit
    redactor masks any key containing "password" before a record is written.
    """

    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime


class WorkspaceSummary(BaseModel):
    id: uuid.UUID
    name: str
    slug: str


class CurrentUserResponse(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: WorkspaceRole
    workspace: WorkspaceSummary
