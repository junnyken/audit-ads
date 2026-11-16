from __future__ import annotations

import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import Ctx
from app.core.config import get_settings
from app.core.email_and_bot_guard import (
    create_bot_challenge,
    validate_reputable_registration_email,
    validate_strong_password,
    verify_bot_challenge,
)
from app.core.enums import WorkspaceMemberStatus, WorkspaceRole
from app.core.errors import AuthenticationError, ConflictError
from app.core.security import create_access_token, hash_password, verify_password
from app.db.session import get_db
from app.models.entities import User, Workspace, WorkspaceMember
from app.schemas.auth import (
    BotChallengeResponse,
    CurrentUserResponse,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
)
from app.services.audit import AuditLogService
from app.services.community_quota import (
    is_require_invite_code_enabled,
    is_user_platform_admin,
    normalize_invite_code,
    validate_and_consume_invite_code,
)
from app.services.session_registry import SessionRegistryService

router = APIRouter(prefix="/auth", tags=["auth"])


def _unique_workspace_slug(session: Session, name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:45] or "agency-workspace"
    slug = base
    for _ in range(10):
        exists = session.execute(sa.select(Workspace.id).where(Workspace.slug == slug)).scalar_one_or_none()
        if exists is None:
            return slug
        slug = f"{base}-{secrets.token_hex(3)}"
    return f"{base}-{secrets.token_hex(5)}"


@router.get("/bot-challenge", response_model=BotChallengeResponse)
def get_bot_challenge() -> BotChallengeResponse:
    return BotChallengeResponse(**create_bot_challenge())


@router.post("/register", response_model=TokenResponse, status_code=201)
def register(
    payload: RegisterRequest,
    request: Request,
    session: Annotated[Session, Depends(get_db)],
) -> TokenResponse:
    # 1. Verify 4-layer anti-bot challenge first (before touching DB)
    verify_bot_challenge(
        challenge_token=payload.challenge_token,
        captcha_code=payload.captcha_code,
        math_answer=payload.math_answer,
        human_confirmed=payload.human_confirmed,
        honeypot=payload.website_honeypot,
    )

    # 2. Validate reputable email provider (blocks fake/disposable/temp mails)
    clean_email = validate_reputable_registration_email(str(payload.email))

    # 3. Validate password complexity
    validate_strong_password(payload.password)

    # 4. Ensure email is not already registered
    existing = session.execute(
        sa.select(User).where(sa.func.lower(User.email) == clean_email)
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError(
            "Địa chỉ email này đã được đăng ký trên hệ thống. Vui lòng chuyển sang tab Đăng nhập.",
            details={"field": "email", "reason": "email_already_registered"},
        )

    settings = get_settings()
    existing_user_count = int(session.execute(sa.select(sa.func.count(User.id))).scalar_one() or 0)
    is_first_user = existing_user_count == 0
    raw_invite = normalize_invite_code(payload.invite_code)

    if raw_invite:
        invite = validate_and_consume_invite_code(session, raw_invite)
        ws_plan_tier = invite.plan_tier
        ws_max_vias = invite.max_vias
        ws_max_ads = invite.max_ad_accounts
        ws_max_members = invite.max_members
        ws_invited_code = invite.code
    elif is_first_user:
        ws_plan_tier = "agency"
        ws_max_vias = 500
        ws_max_ads = 500
        ws_max_members = 25
        ws_invited_code = None
    else:
        if is_require_invite_code_enabled(session, settings):
            raise ConflictError(
                "Hệ thống Cộng đồng hiện đang bật chế độ Invite-Only. Vui lòng nhập Mã mời (Invite Code) hợp lệ để đăng ký.",
                details={"field": "invite_code", "reason": "invite_code_required"},
            )
        ws_plan_tier = "community_free"
        ws_max_vias = int(settings.community_free_max_vias)
        ws_max_ads = int(settings.community_free_max_ad_accounts)
        ws_max_members = int(settings.community_free_max_members)
        ws_invited_code = None

    # 5. Create isolated Workspace + User + Owner Membership
    ws_name = payload.workspace_name.strip()[:120]
    ws_slug = _unique_workspace_slug(session, ws_name)
    workspace = Workspace(
        name=ws_name,
        slug=ws_slug,
        plan_tier=ws_plan_tier,
        max_vias=ws_max_vias,
        max_ad_accounts=ws_max_ads,
        max_members=ws_max_members,
        community_status="active",
        invited_by_code=ws_invited_code,
    )
    session.add(workspace)
    session.flush()

    user = User(
        email=clean_email,
        full_name=payload.full_name.strip()[:120],
        password_hash=hash_password(payload.password),
        is_active=True,
        is_platform_admin=is_first_user,
    )
    session.add(user)
    session.flush()

    membership = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=user.id,
        role=WorkspaceRole.OWNER,
        status=WorkspaceMemberStatus.ACTIVE,
    )
    session.add(membership)
    session.flush()

    audit = AuditLogService(session, workspace.id, user.id)
    audit.record(
        action="user.registered_isolated_workspace",
        entity_type="workspace",
        entity_id=workspace.id,
        metadata={
            "email_domain": clean_email.split("@")[-1],
            "workspace_slug": ws_slug,
            "plan_tier": ws_plan_tier,
            "invited_by_code": ws_invited_code,
        },
    )

    expires_at = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)
    registry = SessionRegistryService(session, workspace.id, audit)
    device_session = registry.create(
        user_id=user.id,
        expires_at=expires_at,
        user_agent=request.headers.get("user-agent"),
        ip=request.client.host if request.client else None,
    )
    token, expires_at = create_access_token(
        subject=str(user.id),
        workspace_id=str(workspace.id),
        role=membership.role.value,
        expires_in_minutes=settings.access_token_expire_minutes,
        extra_claims={"session_id": str(device_session.id)},
    )
    session.commit()
    return TokenResponse(access_token=token, expires_at=expires_at)


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest, request: Request, session: Annotated[Session, Depends(get_db)]
) -> TokenResponse:
    user = session.execute(
        sa.select(User).where(sa.func.lower(User.email) == payload.email.lower())
    ).scalar_one_or_none()
    invalid = AuthenticationError("Email or password is incorrect.")
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise invalid

    membership = session.execute(
        sa.select(WorkspaceMember)
        .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
        .where(
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.archived_at.is_(None),
            Workspace.archived_at.is_(None),
        )
        .order_by(WorkspaceMember.created_at.asc())
    ).scalars().first()
    if membership is None:
        raise AuthenticationError("This user is not a member of any workspace.")

    settings = get_settings()
    expires_at = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)
    registry = SessionRegistryService(
        session, membership.workspace_id, AuditLogService(session, membership.workspace_id, user.id)
    )
    device_session = registry.create(
        user_id=user.id,
        expires_at=expires_at,
        user_agent=request.headers.get("user-agent"),
        ip=request.client.host if request.client else None,
    )
    token, expires_at = create_access_token(
        subject=str(user.id),
        workspace_id=str(membership.workspace_id),
        role=membership.role.value,
        expires_in_minutes=settings.access_token_expire_minutes,
        extra_claims={"session_id": str(device_session.id)},
    )
    session.commit()
    return TokenResponse(access_token=token, expires_at=expires_at)


@router.get("/me", response_model=CurrentUserResponse)
def me(ctx: Ctx) -> CurrentUserResponse:
    ws = ctx.workspace
    return CurrentUserResponse(
        id=ctx.user.id,
        email=ctx.user.email,
        full_name=ctx.user.full_name,
        role=ctx.membership.role,
        is_platform_admin=is_user_platform_admin(ctx.user, get_settings()),
        workspace={
            "id": ws.id,
            "name": ws.name,
            "slug": ws.slug,
            "plan_tier": getattr(ws, "plan_tier", "agency") or "agency",
            "max_vias": int(getattr(ws, "max_vias", 500) or 500),
            "max_ad_accounts": int(getattr(ws, "max_ad_accounts", 500) or 500),
            "max_members": int(getattr(ws, "max_members", 25) or 25),
            "community_status": getattr(ws, "community_status", "active") or "active",
        },
    )
