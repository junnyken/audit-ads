from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import Ctx, OptionalUser
from app.core.config import get_settings
from app.core.email_and_bot_guard import (
    create_bot_challenge,
    normalize_canonical_email,
    precheck_registration_email,
    validate_reputable_registration_email,
    validate_strong_password,
    verify_bot_challenge,
)
from app.core.enums import WorkspaceMemberStatus, WorkspaceRole
from app.core.errors import (
    AuthenticationError,
    AuthorizationError,
    ConflictError,
    TooManyRequestsError,
    ValidationError,
)
from app.core.security import create_access_token, hash_password, verify_password
from app.db.session import get_db
from app.models.entities import (
    EmailVerificationToken,
    PasswordResetToken,
    User,
    Workspace,
    WorkspaceMember,
)
from app.models.team import DeviceSession
from app.schemas.auth import (
    BotChallengeResponse,
    ChangePasswordRequest,
    CurrentUserResponse,
    ForgotPasswordRequest,
    LoginRequest,
    PrecheckSignupRequest,
    PrecheckSignupResponse,
    RegisterRequest,
    ResendVerificationRequest,
    ResetPasswordRequest,
    TokenResponse,
    VerifyEmailRequest,
)
from app.services.audit import AuditLogService
from app.services.community_quota import (
    is_require_invite_code_enabled,
    is_user_platform_admin,
    normalize_invite_code,
    validate_and_consume_invite_code,
)
from app.services.email_sender import (
    build_email_verification_url,
    build_password_reset_url,
    send_email_verification_email,
    send_password_reset_email,
)
from app.services.license_service import (
    DEFAULT_MAX_DESKTOP_DEVICES,
    count_active_desktop_sessions,
    effective_max_desktop_devices,
    evaluate_workspace_license,
)
from app.services.session_registry import SessionRegistryService, hash_ip
from app.services.turnstile_verifier import verify_turnstile_token

router = APIRouter(prefix="/auth", tags=["auth"])
_DUMMY_PASSWORD_HASH = hash_password("AdsOpsDummyConstantTimeCompare!2026")


def _extract_desktop_client_info(request: Request) -> tuple[str, str | None, str | None]:
    """Return `(client_channel, installation_hash, desktop_label)` without trusting raw fingerprints."""
    raw_client = (request.headers.get("x-adsops-client") or "").strip()
    if not raw_client.lower().startswith("desktop/"):
        return "web", None, None
    ver = raw_client.split("/", 1)[1].strip()[:32]
    raw_inst = (request.headers.get("x-adsops-installation") or "").strip()[:128]
    inst_hash = (
        hashlib.sha256(f"adsops-inst:{raw_inst}".encode()).hexdigest()
        if raw_inst
        else None
    )
    label = f"AdsOps Desktop Pro {f'v{ver}' if ver else '(Windows)'}"[:120]
    return "desktop", inst_hash, label


def _hash_reset_token(raw_token: str) -> str:
    return hashlib.sha256((raw_token or "").encode("utf-8")).hexdigest()


def _verify_turnstile_if_enabled(request: Request, token: str | None) -> None:
    settings = get_settings()
    if not (settings.turnstile_secret_key or "").strip():
        return
    ok, reason = verify_turnstile_token(
        settings.turnstile_secret_key,
        token or "",
        remote_ip=request.client.host if request.client else None,
    )
    if not ok:
        raise ValidationError(
            "Xác thực bảo vệ Cloudflare Turnstile chưa hợp lệ hoặc đã hết hạn. Vui lòng thử lại.",
            details={"field": "turnstile_token", "reason": reason},
        )


def _issue_email_verification(
    session: Session,
    *,
    user: User,
    request: Request,
    settings: Any,
) -> tuple[bool, bool]:
    """Create 24h single-use EmailVerificationToken and dispatch if SMTP is configured."""
    now_utc = datetime.now(UTC)
    raw_token = secrets.token_urlsafe(32)
    row = EmailVerificationToken(
        user_id=user.id,
        email=user.email,
        token_hash=_hash_reset_token(raw_token),
        expires_at=now_utc + timedelta(hours=24),
        requested_ip_hash=hash_ip(request.client.host if request.client else None),
    )
    session.add(row)
    session.flush()
    sent = False
    if settings.smtp_configured:
        verify_url = build_email_verification_url(settings, raw_token)
        sent, _ = send_email_verification_email(settings, user.email, verify_url, full_name=user.full_name)
    return True, sent


def _find_user_by_email(session: Session, raw_email: str) -> User | None:
    lowered = (raw_email or "").strip().lower()
    if not lowered:
        return None
    user = session.execute(
        sa.select(User).where(sa.func.lower(User.email) == lowered)
    ).scalar_one_or_none()
    if user is not None:
        return user
    canonical = normalize_canonical_email(lowered)
    if canonical != lowered:
        user = session.execute(
            sa.select(User).where(sa.func.lower(User.email) == canonical)
        ).scalar_one_or_none()
        if user is not None:
            return user
    # Also scan legacy dotted Gmail accounts if login attempts stripped email
    if canonical.endswith("@gmail.com"):
        gmail_candidates = (
            session.execute(
                sa.select(User).where(
                    sa.or_(
                        sa.func.lower(User.email).like("%@gmail.com"),
                        sa.func.lower(User.email).like("%@googlemail.com"),
                    )
                )
            )
            .scalars()
            .all()
        )
        for cand in gmail_candidates:
            if normalize_canonical_email(cand.email) == canonical:
                return cand
    return None


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
    settings = get_settings()
    data = create_bot_challenge()
    data["turnstile_site_key"] = (settings.turnstile_site_key or "").strip()
    data["turnstile_enabled"] = bool(data["turnstile_site_key"] and (settings.turnstile_secret_key or "").strip())
    return BotChallengeResponse(**data)


@router.post("/precheck-signup", response_model=PrecheckSignupResponse)
def precheck_signup(
    payload: PrecheckSignupRequest, session: Annotated[Session, Depends(get_db)]
) -> PrecheckSignupResponse:
    result = precheck_registration_email(payload.email, session)
    return PrecheckSignupResponse(**result)


@router.post("/register", response_model=TokenResponse, status_code=201)
def register(
    payload: RegisterRequest,
    request: Request,
    session: Annotated[Session, Depends(get_db)],
) -> TokenResponse:
    # 0. Verify optional Cloudflare Turnstile before DB work
    _verify_turnstile_if_enabled(request, payload.turnstile_token)

    # 1. Verify 4-layer anti-bot challenge first (before touching DB)
    verify_bot_challenge(
        challenge_token=payload.challenge_token,
        captcha_code=payload.captcha_code,
        math_answer=payload.math_answer,
        human_confirmed=payload.human_confirmed,
        honeypot=payload.website_honeypot,
    )

    # 2. Validate reputable email provider (blocks fake/disposable/temp mails, allows DB allowlist)
    clean_email = validate_reputable_registration_email(str(payload.email), session=session)

    # 3. Validate password complexity
    validate_strong_password(payload.password)

    # 4. Ensure email (and canonical Gmail equivalent) is not already registered
    existing = _find_user_by_email(session, clean_email)
    if existing is not None:
        raise ConflictError(
            "Địa chỉ email này đã được đăng ký trên hệ thống. Vui lòng chuyển sang tab Đăng nhập.",
            details={"field": "email", "reason": "email_already_registered"},
        )

    settings = get_settings()
    now_utc = datetime.now(UTC)
    existing_user_count = int(session.execute(sa.select(sa.func.count(User.id))).scalar_one() or 0)
    is_first_user = existing_user_count == 0
    raw_invite = normalize_invite_code(payload.invite_code)

    ws_plan_expires_at: datetime | None = None
    if raw_invite:
        invite = validate_and_consume_invite_code(session, raw_invite)
        ws_plan_tier = invite.plan_tier
        ws_max_vias = invite.max_vias
        ws_max_ads = invite.max_ad_accounts
        ws_max_members = invite.max_members
        ws_invited_code = invite.code
        if getattr(invite, "duration_days", None):
            ws_plan_expires_at = now_utc + timedelta(days=int(invite.duration_days))
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

    ws_max_desktop = DEFAULT_MAX_DESKTOP_DEVICES.get(ws_plan_tier, 10)

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
        max_desktop_devices=ws_max_desktop,
        plan_expires_at=ws_plan_expires_at,
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
        email_verified=bool(is_first_user),
        email_verified_at=now_utc if is_first_user else None,
        failed_login_count=0,
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

    if not user.email_verified:
        _issue_email_verification(session, user=user, request=request, settings=settings)

    if settings.require_email_verification and settings.smtp_configured and not user.email_verified:
        session.commit()
        return TokenResponse(
            access_token="",
            expires_at=now_utc,
            email_verified=False,
            verification_required=True,
        )

    expires_at = now_utc + timedelta(minutes=settings.access_token_expire_minutes)
    registry = SessionRegistryService(session, workspace.id, audit)
    client_channel, inst_hash, desktop_label = _extract_desktop_client_info(request)
    device_session = registry.create(
        user_id=user.id,
        expires_at=expires_at,
        user_agent=request.headers.get("user-agent"),
        ip=request.client.host if request.client else None,
        client_channel=client_channel,
        installation_hash=inst_hash,
        label_override=desktop_label,
    )
    token, expires_at = create_access_token(
        subject=str(user.id),
        workspace_id=str(workspace.id),
        role=membership.role.value,
        expires_in_minutes=settings.access_token_expire_minutes,
        extra_claims={"session_id": str(device_session.id)},
    )
    session.commit()
    return TokenResponse(
        access_token=token,
        expires_at=expires_at,
        email_verified=bool(user.email_verified),
        verification_required=False,
    )


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest, request: Request, session: Annotated[Session, Depends(get_db)]
) -> TokenResponse:
    _verify_turnstile_if_enabled(request, payload.turnstile_token)
    settings = get_settings()
    now_utc = datetime.now(UTC)

    user = _find_user_by_email(session, str(payload.email))
    invalid = AuthenticationError("Email or password is incorrect.")
    if user is None or not user.is_active:
        verify_password(payload.password, _DUMMY_PASSWORD_HASH)
        raise invalid

    locked_until = getattr(user, "login_locked_until", None)
    if locked_until is not None:
        if locked_until.tzinfo is None:
            locked_until = locked_until.replace(tzinfo=UTC)
        if locked_until > now_utc:
            raise TooManyRequestsError(
                "Tài khoản tạm thời bị khóa đăng nhập do nhập sai mật khẩu quá nhiều lần. Vui lòng thử lại sau hoặc đặt lại mật khẩu.",
                details={
                    "reason": "account_temporarily_locked",
                    "retry_after_seconds": max(1, int((locked_until - now_utc).total_seconds())),
                },
            )
        user.login_locked_until = None
        user.failed_login_count = 0

    if not verify_password(payload.password, user.password_hash):
        fails = int(getattr(user, "failed_login_count", 0) or 0) + 1
        user.failed_login_count = fails
        max_fails = max(3, int(settings.login_max_failed_attempts or 8))
        if fails >= max_fails:
            lock_mins = max(1, int(settings.login_lockout_minutes or 15))
            user.login_locked_until = now_utc + timedelta(minutes=lock_mins)
            session.commit()
            raise TooManyRequestsError(
                "Tài khoản tạm thời bị khóa đăng nhập do nhập sai mật khẩu quá nhiều lần. Vui lòng thử lại sau hoặc đặt lại mật khẩu.",
                details={"reason": "account_temporarily_locked", "retry_after_seconds": lock_mins * 60},
            )
        session.commit()
        raise invalid

    if getattr(user, "failed_login_count", 0) or getattr(user, "login_locked_until", None):
        user.failed_login_count = 0
        user.login_locked_until = None

    if settings.require_email_verification and settings.smtp_configured and not getattr(user, "email_verified", True):
        session.commit()
        raise AuthorizationError(
            "Tài khoản chưa xác nhận địa chỉ email. Vui lòng kiểm tra hộp thư hoặc yêu cầu gửi lại liên kết xác nhận.",
            details={"reason": "email_not_confirmed"},
        )

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

    workspace = session.get(Workspace, membership.workspace_id)
    if workspace is None:
        raise AuthenticationError("The workspace is not available.")

    expires_at = now_utc + timedelta(minutes=settings.access_token_expire_minutes)
    audit = AuditLogService(session, membership.workspace_id, user.id)
    registry = SessionRegistryService(session, membership.workspace_id, audit)

    client_channel, inst_hash, desktop_label = _extract_desktop_client_info(request)
    if client_channel == "desktop":
        active_desktop = [
            row
            for row in session.execute(
                sa.select(DeviceSession)
                .where(
                    DeviceSession.workspace_id == membership.workspace_id,
                    DeviceSession.client_channel == "desktop",
                    DeviceSession.revoked_at.is_(None),
                )
                .order_by(DeviceSession.last_seen_at.asc().nulls_first(), DeviceSession.created_at.asc())
            )
            .scalars()
            .all()
            if row.is_active
        ]
        # Replace previous session from the exact same Desktop installation without counting extra slot
        remaining_desktop: list[DeviceSession] = []
        for row in active_desktop:
            if inst_hash and row.installation_hash and hmac.compare_digest(row.installation_hash, inst_hash):
                registry._revoke(row, reason="relogin_same_installation", actor_id=user.id)
            else:
                remaining_desktop.append(row)

        max_devices = effective_max_desktop_devices(workspace)
        if len(remaining_desktop) >= max_devices:
            if payload.replace_oldest_device and remaining_desktop:
                registry._revoke(
                    remaining_desktop[0],
                    reason="replaced_by_new_desktop_login",
                    actor_id=user.id,
                )
            else:
                raise ConflictError(
                    f"Workspace đã đạt giới hạn {max_devices} thiết bị Desktop đăng nhập đồng thời.",
                    details={
                        "reason": "device_limit_reached",
                        "max_desktop_devices": max_devices,
                        "active_devices": [
                            {
                                "id": str(d.id),
                                "label": d.label,
                                "last_seen_at": d.last_seen_at.isoformat() if d.last_seen_at else None,
                            }
                            for d in remaining_desktop
                        ],
                    },
                )

    device_session = registry.create(
        user_id=user.id,
        expires_at=expires_at,
        user_agent=request.headers.get("user-agent"),
        ip=request.client.host if request.client else None,
        client_channel=client_channel,
        installation_hash=inst_hash,
        label_override=desktop_label,
    )
    token, expires_at = create_access_token(
        subject=str(user.id),
        workspace_id=str(membership.workspace_id),
        role=membership.role.value,
        expires_in_minutes=settings.access_token_expire_minutes,
        extra_claims={"session_id": str(device_session.id)},
    )
    session.commit()
    return TokenResponse(
        access_token=token,
        expires_at=expires_at,
        email_verified=bool(getattr(user, "email_verified", True)),
    )


@router.post("/verify-email")
def verify_email(
    payload: VerifyEmailRequest, session: Annotated[Session, Depends(get_db)]
) -> dict[str, Any]:
    """Consume a 24h single-use email verification token and mark user.email_verified = True."""
    now_utc = datetime.now(UTC)
    target_hash = _hash_reset_token(payload.token.strip())
    row = session.execute(
        sa.select(EmailVerificationToken).where(EmailVerificationToken.token_hash == target_hash)
    ).scalar_one_or_none()
    invalid_err = ValidationError(
        "Liên kết xác nhận email không hợp lệ hoặc đã hết hạn.",
        details={"reason": "invalid_or_expired_verification_link"},
    )
    if row is None or not hmac.compare_digest(row.token_hash, target_hash) or row.used_at is not None:
        raise invalid_err
    row_exp = row.expires_at if row.expires_at.tzinfo is not None else row.expires_at.replace(tzinfo=UTC)
    if row_exp <= now_utc:
        raise invalid_err

    user = session.get(User, row.user_id)
    if user is None or not user.is_active:
        raise invalid_err

    user.email_verified = True
    if user.email_verified_at is None:
        user.email_verified_at = now_utc

    sibling_tokens = (
        session.execute(
            sa.select(EmailVerificationToken).where(
                EmailVerificationToken.user_id == user.id,
                EmailVerificationToken.used_at.is_(None),
            )
        )
        .scalars()
        .all()
    )
    for tok_row in sibling_tokens:
        tok_row.used_at = now_utc

    primary_member = (
        session.execute(
            sa.select(WorkspaceMember)
            .where(WorkspaceMember.user_id == user.id, WorkspaceMember.archived_at.is_(None))
            .order_by(WorkspaceMember.created_at.asc())
        )
        .scalars()
        .first()
    )
    if primary_member is not None:
        AuditLogService(session, primary_member.workspace_id, user.id).record(
            action="user.email_verified",
            entity_type="user",
            entity_id=user.id,
            metadata={"email": user.email},
        )
    session.commit()
    return {"status": "ok", "email_verified": True, "email": user.email}


@router.post("/resend-verification")
def resend_verification(
    request: Request,
    session: Annotated[Session, Depends(get_db)],
    current_user: OptionalUser,
    payload: ResendVerificationRequest | None = None,
) -> dict[str, Any]:
    """Re-send a 24h email verification link without enumerating unauthenticated emails."""
    settings = get_settings()
    now_utc = datetime.now(UTC)
    window_start = now_utc - timedelta(hours=1)
    ip_hash = hash_ip(request.client.host if request.client else None)

    if current_user is not None:
        if getattr(current_user, "email_verified", False):
            return {"status": "ok", "already_verified": True, "message": "Email của bạn đã được xác nhận."}
        recent_user = int(
            session.execute(
                sa.select(sa.func.count(EmailVerificationToken.id)).where(
                    EmailVerificationToken.user_id == current_user.id,
                    EmailVerificationToken.created_at >= window_start,
                )
            ).scalar_one()
            or 0
        )
        if recent_user >= 3:
            raise TooManyRequestsError(
                "Bạn đã yêu cầu gửi lại email xác nhận quá nhiều lần. Vui lòng thử lại sau ít phút.",
                details={"reason": "verification_resend_rate_limited"},
            )
        _, sent = _issue_email_verification(session, user=current_user, request=request, settings=settings)
        session.commit()
        return {
            "status": "ok",
            "sent": sent,
            "message": (
                "Đã gửi lại liên kết xác nhận email (hiệu lực 24 giờ)."
                if sent
                else "Đã tạo mã xác nhận mới (máy chủ chưa bật SMTP để gửi thư tự động)."
            ),
        }

    ok_reply = {
        "status": "ok",
        "message": "Nếu tài khoản tồn tại và chưa xác nhận email, liên kết xác nhận mới đã được gửi (hiệu lực 24 giờ).",
    }
    raw_email = str(payload.email) if payload and payload.email else ""
    if not raw_email:
        return ok_reply
    target = _find_user_by_email(session, raw_email)
    if target is None or not target.is_active or getattr(target, "email_verified", False):
        return ok_reply

    recent_user = int(
        session.execute(
            sa.select(sa.func.count(EmailVerificationToken.id)).where(
                EmailVerificationToken.user_id == target.id,
                EmailVerificationToken.created_at >= window_start,
            )
        ).scalar_one()
        or 0
    )
    if recent_user >= 3:
        return ok_reply
    if ip_hash:
        recent_ip = int(
            session.execute(
                sa.select(sa.func.count(EmailVerificationToken.id)).where(
                    EmailVerificationToken.requested_ip_hash == ip_hash,
                    EmailVerificationToken.created_at >= window_start,
                )
            ).scalar_one()
            or 0
        )
        if recent_ip >= 5:
            return ok_reply

    _issue_email_verification(session, user=target, request=request, settings=settings)
    session.commit()
    return ok_reply


@router.post("/logout")
def logout(ctx: Ctx) -> dict[str, Any]:
    """Revoke the current caller's DeviceSession server-side immediately."""
    now_utc = datetime.now(UTC)
    revoked = False
    if ctx.device_session_id is not None:
        ds = ctx.session.get(DeviceSession, ctx.device_session_id)
        if ds is not None and ds.revoked_at is None:
            ds.revoked_at = now_utc
            ds.revoked_reason = "user_logout"
            revoked = True
            ctx.audit.record(
                action="auth.logout",
                entity_type="device_session",
                entity_id=ds.id,
                metadata={"client_channel": ds.client_channel},
            )
    ctx.commit()
    return {"status": "ok", "revoked": revoked}


@router.post("/change-password")
def change_password(payload: ChangePasswordRequest, ctx: Ctx) -> dict[str, Any]:
    """Verify current password, update to a new strong password, and revoke all other device sessions."""
    if not verify_password(payload.current_password, ctx.user.password_hash):
        raise AuthenticationError("Mật khẩu hiện tại không chính xác.")
    validate_strong_password(payload.new_password)
    if verify_password(payload.new_password, ctx.user.password_hash):
        raise ValidationError(
            "Mật khẩu mới không được trùng mật khẩu hiện tại.",
            details={"field": "new_password"},
        )

    now_utc = datetime.now(UTC)
    ctx.user.password_hash = hash_password(payload.new_password)
    ctx.user.failed_login_count = 0
    ctx.user.login_locked_until = None

    other_sessions = (
        ctx.session.execute(
            sa.select(DeviceSession).where(
                DeviceSession.user_id == ctx.user.id,
                DeviceSession.revoked_at.is_(None),
            )
        )
        .scalars()
        .all()
    )
    revoked_count = 0
    for ds in other_sessions:
        if ctx.device_session_id is not None and ds.id == ctx.device_session_id:
            continue
        ds.revoked_at = now_utc
        ds.revoked_reason = "password_changed"
        revoked_count += 1

    ctx.audit.record(
        action="user.password_changed",
        entity_type="user",
        entity_id=ctx.user.id,
        metadata={"revoked_other_sessions": revoked_count},
    )
    ctx.commit()
    return {"status": "ok", "revoked_other_sessions": revoked_count}


@router.post("/forgot-password")
def forgot_password(
    payload: ForgotPasswordRequest, request: Request, session: Annotated[Session, Depends(get_db)]
) -> dict[str, Any]:
    """Always returns the same OK envelope so email existence is never disclosed."""
    _verify_turnstile_if_enabled(request, payload.turnstile_token)
    ok_reply = {
        "status": "ok",
        "message": "Nếu email đã đăng ký trên hệ thống, hướng dẫn đặt lại mật khẩu đã được gửi (hiệu lực 30 phút).",
    }
    user = _find_user_by_email(session, str(payload.email))
    if user is None or not user.is_active:
        return ok_reply

    now_utc = datetime.now(UTC)
    window_start = now_utc - timedelta(hours=1)
    ip_hash = hash_ip(request.client.host if request.client else None)

    recent_user_count = int(
        session.execute(
            sa.select(sa.func.count(PasswordResetToken.id)).where(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.created_at >= window_start,
            )
        ).scalar_one()
        or 0
    )
    if recent_user_count >= 3:
        return ok_reply

    if ip_hash:
        recent_ip_count = int(
            session.execute(
                sa.select(sa.func.count(PasswordResetToken.id)).where(
                    PasswordResetToken.requested_ip_hash == ip_hash,
                    PasswordResetToken.created_at >= window_start,
                )
            ).scalar_one()
            or 0
        )
        if recent_ip_count >= 5:
            return ok_reply

    settings = get_settings()
    raw_token = secrets.token_urlsafe(32)
    row = PasswordResetToken(
        user_id=user.id,
        token_hash=_hash_reset_token(raw_token),
        expires_at=now_utc + timedelta(minutes=30),
        requested_ip_hash=ip_hash,
    )
    session.add(row)
    session.flush()
    if settings.smtp_configured:
        reset_url = build_password_reset_url(settings, raw_token)
        send_password_reset_email(settings, user.email, reset_url, full_name=user.full_name)
    session.commit()
    return ok_reply


@router.post("/reset-password")
def reset_password(
    payload: ResetPasswordRequest, session: Annotated[Session, Depends(get_db)]
) -> dict[str, Any]:
    validate_strong_password(payload.new_password)
    now_utc = datetime.now(UTC)
    target_hash = _hash_reset_token(payload.token.strip())

    row = session.execute(
        sa.select(PasswordResetToken).where(PasswordResetToken.token_hash == target_hash)
    ).scalar_one_or_none()
    invalid_err = ValidationError(
        "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.",
        details={"reason": "invalid_or_expired_reset_link"},
    )
    if row is None or not hmac.compare_digest(row.token_hash, target_hash) or row.used_at is not None:
        raise invalid_err
    row_exp = row.expires_at if row.expires_at.tzinfo is not None else row.expires_at.replace(tzinfo=UTC)
    if row_exp <= now_utc:
        raise invalid_err

    user = session.get(User, row.user_id)
    if user is None or not user.is_active:
        raise invalid_err

    user.password_hash = hash_password(payload.new_password)
    user.failed_login_count = 0
    user.login_locked_until = None
    # Mark this token and any older unused tokens for this user as consumed
    sibling_tokens = (
        session.execute(
            sa.select(PasswordResetToken).where(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.used_at.is_(None),
            )
        )
        .scalars()
        .all()
    )
    for tok_row in sibling_tokens:
        tok_row.used_at = now_utc

    # Revoke ALL active sessions across ALL workspaces for this user
    active_sessions = (
        session.execute(
            sa.select(DeviceSession).where(
                DeviceSession.user_id == user.id,
                DeviceSession.revoked_at.is_(None),
            )
        )
        .scalars()
        .all()
    )
    revoked_count = 0
    for ds in active_sessions:
        ds.revoked_at = now_utc
        ds.revoked_reason = "password_reset"
        revoked_count += 1

    # Record clean audit trail in user's primary workspace (no sensitive keys)
    primary_member = (
        session.execute(
            sa.select(WorkspaceMember)
            .where(WorkspaceMember.user_id == user.id, WorkspaceMember.archived_at.is_(None))
            .order_by(WorkspaceMember.created_at.asc())
        )
        .scalars()
        .first()
    )
    if primary_member is not None:
        AuditLogService(session, primary_member.workspace_id, user.id).record(
            action="user.credential_reset_completed",
            entity_type="user",
            entity_id=user.id,
            metadata={"revoked_device_count": revoked_count},
        )

    session.commit()
    return {"status": "ok", "revoked_sessions": revoked_count}


@router.get("/me", response_model=CurrentUserResponse)
def me(ctx: Ctx) -> CurrentUserResponse:
    ws = ctx.workspace
    active_desktop = count_active_desktop_sessions(ctx.session, ws.id)
    lic = evaluate_workspace_license(ws, active_desktop_devices=active_desktop)
    return CurrentUserResponse(
        id=ctx.user.id,
        email=ctx.user.email,
        full_name=ctx.user.full_name,
        role=ctx.membership.role,
        is_platform_admin=is_user_platform_admin(ctx.user, get_settings()),
        email_verified=bool(getattr(ctx.user, "email_verified", True)),
        workspace={
            "id": ws.id,
            "name": ws.name,
            "slug": ws.slug,
            "plan_tier": getattr(ws, "plan_tier", "agency") or "agency",
            "max_vias": int(getattr(ws, "max_vias", 500) or 500),
            "max_ad_accounts": int(getattr(ws, "max_ad_accounts", 500) or 500),
            "max_members": int(getattr(ws, "max_members", 25) or 25),
            "max_desktop_devices": lic["max_desktop_devices"],
            "plan_expires_at": getattr(ws, "plan_expires_at", None),
            "community_status": getattr(ws, "community_status", "active") or "active",
            "license": lic,
        },
    )
