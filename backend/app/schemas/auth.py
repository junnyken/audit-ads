from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.enums import WorkspaceRole


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    replace_oldest_device: bool = False
    turnstile_token: str | None = Field(default=None, max_length=2048)


class ForgotPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    turnstile_token: str | None = Field(default=None, max_length=2048)


class ResetPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=16, max_length=512)
    new_password: str = Field(min_length=8, max_length=200)


class PrecheckSignupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=320)


class PrecheckSignupResponse(BaseModel):
    ok: bool
    reason: str | None = None
    message: str | None = None
    normalized_email: str


class VerifyEmailRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=16, max_length=512)


class ResendVerificationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr | None = None


class ChangePasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(min_length=8, max_length=200)
    new_password: str = Field(min_length=8, max_length=200)


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
    invite_code: str | None = Field(default=None, max_length=64)
    turnstile_token: str | None = Field(default=None, max_length=2048)


class BotChallengeResponse(BaseModel):
    challenge_token: str
    captcha_svg: str
    math_question: str
    expires_in_seconds: int
    turnstile_enabled: bool = False
    turnstile_site_key: str = ""


class TokenResponse(BaseModel):
    access_token: str = ""
    token_type: str = "bearer"
    expires_at: datetime
    email_verified: bool = True
    verification_required: bool = False


class WorkspaceSummary(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    plan_tier: str = "agency"
    max_vias: int = 500
    max_ad_accounts: int = 500
    max_members: int = 25
    max_desktop_devices: int | None = None
    plan_expires_at: datetime | None = None
    community_status: str = "active"
    license: dict[str, Any] | None = None


class CurrentUserResponse(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: WorkspaceRole
    is_platform_admin: bool = False
    email_verified: bool = True
    workspace: WorkspaceSummary
