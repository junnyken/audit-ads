from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.enums import WorkspaceRole


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str = Field(min_length=2, max_length=120)
    workspace_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    challenge_token: str = Field(min_length=16, max_length=2048)
    captcha_code: str = Field(min_length=4, max_length=12)
    math_answer: str = Field(min_length=1, max_length=10)
    human_confirmed: bool = False
    website_honeypot: str | None = Field(default="", max_length=200)


class BotChallengeResponse(BaseModel):
    challenge_token: str
    captcha_svg: str
    math_question: str
    expires_in_seconds: int


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
