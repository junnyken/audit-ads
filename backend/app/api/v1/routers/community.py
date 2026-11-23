"""Community governance: workspace quotas, invite-code redemption & Platform Super-Admin console."""
from __future__ import annotations

import calendar
import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import Ctx, OwnerCtx
from app.core.config import get_settings
from app.core.enums import WorkspaceRole
from app.core.errors import AuthorizationError, NotFoundError
from app.models.entities import (
    CommunityInviteCode,
    PasswordResetToken,
    User,
    Workspace,
    WorkspaceMember,
)
from app.services.community_quota import (
    PLAN_QUOTA_DEFAULTS,
    is_require_invite_code_enabled,
    is_user_platform_admin,
    normalize_plan_tier,
    validate_and_consume_invite_code,
    workspace_resource_usage,
)
from app.services.email_sender import build_password_reset_url
from app.services.license_service import (
    DEFAULT_MAX_DESKTOP_DEVICES,
    count_active_desktop_sessions,
    evaluate_workspace_license,
)

router = APIRouter(prefix="/community", tags=["community"])


def _require_platform_admin(ctx: Ctx) -> None:
    if not is_user_platform_admin(ctx.user, get_settings()):
        raise AuthorizationError("Chỉ Quản trị viên Nền tảng (Super-Admin) mới có quyền truy cập khu vực này.")


class RedeemCodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=3, max_length=64)


class InviteCodeCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str | None = Field(default=None, max_length=64)
    label: str = Field(default="", max_length=160)
    plan_tier: str = Field(default="pro", max_length=32)
    max_vias: int | None = Field(default=None, ge=1, le=50000)
    max_ad_accounts: int | None = Field(default=None, ge=1, le=50000)
    max_members: int | None = Field(default=None, ge=1, le=1000)
    max_uses: int = Field(default=20, ge=1, le=10000)
    expires_days: int | None = Field(default=None, ge=1, le=3650)
    duration_days: int | None = Field(default=None, ge=1, le=3650)


class InviteCodePatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_active: bool | None = None
    max_uses: int | None = Field(default=None, ge=1, le=10000)


class WorkspaceGovernancePatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan_tier: str | None = Field(default=None, max_length=32)
    max_vias: int | None = Field(default=None, ge=1, le=50000)
    max_ad_accounts: int | None = Field(default=None, ge=1, le=50000)
    max_members: int | None = Field(default=None, ge=1, le=1000)
    max_desktop_devices: int | None = Field(default=None, ge=1, le=500)
    plan_expires_at: datetime | None = None
    extend_months: int | None = Field(default=None, ge=1, le=120)
    clear_expiry: bool = False
    community_status: str | None = Field(default=None, pattern="^(active|suspended)$")


class CommunityPolicyPutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    require_invite_code: bool


def _add_months(dt: datetime, months: int) -> datetime:
    base = dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)
    zero_month = base.month - 1 + months
    year = base.year + zero_month // 12
    month = zero_month % 12 + 1
    day = min(base.day, calendar.monthrange(year, month)[1])
    return base.replace(year=year, month=month, day=day)


def _serialize_quota(ctx: Ctx) -> dict[str, Any]:
    vias_used, ad_accounts_used, members_used = workspace_resource_usage(ctx.session, ctx.workspace_id)
    ws = ctx.workspace
    active_desktop = count_active_desktop_sessions(ctx.session, ws.id)
    lic = evaluate_workspace_license(ws, active_desktop_devices=active_desktop)
    return {
        "plan_tier": getattr(ws, "plan_tier", "agency") or "agency",
        "community_status": getattr(ws, "community_status", "active") or "active",
        "max_vias": int(getattr(ws, "max_vias", 500) or 500),
        "vias_used": vias_used,
        "max_ad_accounts": int(getattr(ws, "max_ad_accounts", 500) or 500),
        "ad_accounts_used": ad_accounts_used,
        "max_members": int(getattr(ws, "max_members", 25) or 25),
        "members_used": members_used,
        "max_desktop_devices": lic["max_desktop_devices"],
        "active_desktop_devices": active_desktop,
        "plan_expires_at": lic["plan_expires_at"],
        "license": lic,
        "invited_by_code": getattr(ws, "invited_by_code", None),
        "is_platform_admin": is_user_platform_admin(ctx.user, get_settings()),
    }


def _serialize_invite(row: CommunityInviteCode) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "code": row.code,
        "label": row.label,
        "plan_tier": row.plan_tier,
        "max_vias": row.max_vias,
        "max_ad_accounts": row.max_ad_accounts,
        "max_members": row.max_members,
        "max_uses": row.max_uses,
        "used_count": row.used_count,
        "is_active": row.is_active,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "duration_days": getattr(row, "duration_days", None),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.get("/my-quota")
def get_my_quota(ctx: Ctx) -> dict[str, Any]:
    return _serialize_quota(ctx)


@router.post("/redeem-code")
def redeem_invite_code(ctx: OwnerCtx, payload: RedeemCodeRequest) -> dict[str, Any]:
    invite = validate_and_consume_invite_code(ctx.session, payload.code)
    ws = ctx.workspace
    old_tier = normalize_plan_tier(getattr(ws, "plan_tier", "community_free"))
    ws.plan_tier = invite.plan_tier
    ws.max_vias = max(int(ws.max_vias or 10), int(invite.max_vias))
    ws.max_ad_accounts = max(int(ws.max_ad_accounts or 5), int(invite.max_ad_accounts))
    ws.max_members = max(int(ws.max_members or 2), int(invite.max_members))
    tier_default_devices = DEFAULT_MAX_DESKTOP_DEVICES.get(invite.plan_tier, 1)
    if getattr(ws, "max_desktop_devices", None) is None or invite.plan_tier != old_tier:
        ws.max_desktop_devices = max(int(getattr(ws, "max_desktop_devices", 0) or 0), tier_default_devices)
    if getattr(invite, "duration_days", None):
        now_utc = datetime.now(UTC)
        cur_exp = getattr(ws, "plan_expires_at", None)
        if cur_exp is not None and cur_exp.tzinfo is None:
            cur_exp = cur_exp.replace(tzinfo=UTC)
        anchor = max(now_utc, cur_exp) if cur_exp else now_utc
        ws.plan_expires_at = anchor + timedelta(days=int(invite.duration_days))
    ws.invited_by_code = invite.code
    ctx.audit.record(
        action="community.code_redeemed",
        entity_type="workspace",
        entity_id=ws.id,
        metadata={
            "code": invite.code,
            "plan_tier": ws.plan_tier,
            "max_vias": ws.max_vias,
            "max_ad_accounts": ws.max_ad_accounts,
            "max_members": ws.max_members,
            "max_desktop_devices": ws.max_desktop_devices,
            "plan_expires_at": ws.plan_expires_at.isoformat() if ws.plan_expires_at else None,
        },
    )
    ctx.commit()
    return _serialize_quota(ctx)


def _workspace_owner_info(session: Any, workspace_id: uuid.UUID) -> tuple[str | None, str | None]:
    row = session.execute(
        sa.select(User.id, User.email)
        .join(WorkspaceMember, WorkspaceMember.user_id == User.id)
        .where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.archived_at.is_(None),
            WorkspaceMember.role == WorkspaceRole.OWNER,
        )
        .order_by(WorkspaceMember.created_at.asc())
        .limit(1)
    ).first()
    if row is None:
        return None, None
    return str(row[0]), str(row[1])


@router.get("/admin/overview")
def admin_overview(ctx: Ctx) -> dict[str, Any]:
    _require_platform_admin(ctx)
    settings = get_settings()
    workspaces = (
        ctx.session.execute(
            sa.select(Workspace).where(Workspace.archived_at.is_(None)).order_by(Workspace.created_at.desc())
        )
        .scalars()
        .all()
    )
    codes_count = int(
        ctx.session.execute(sa.select(sa.func.count(CommunityInviteCode.id))).scalar_one() or 0
    )
    ws_rows: list[dict[str, Any]] = []
    for ws in workspaces:
        vias_used, ad_accounts_used, members_used = workspace_resource_usage(ctx.session, ws.id)
        active_desktop = count_active_desktop_sessions(ctx.session, ws.id)
        lic = evaluate_workspace_license(ws, active_desktop_devices=active_desktop)
        owner_uid, owner_email = _workspace_owner_info(ctx.session, ws.id)
        ws_rows.append(
            {
                "id": str(ws.id),
                "name": ws.name,
                "slug": ws.slug,
                "owner_user_id": owner_uid,
                "owner_email": owner_email,
                "plan_tier": getattr(ws, "plan_tier", "agency") or "agency",
                "max_vias": int(getattr(ws, "max_vias", 500) or 500),
                "vias_used": vias_used,
                "max_ad_accounts": int(getattr(ws, "max_ad_accounts", 500) or 500),
                "ad_accounts_used": ad_accounts_used,
                "max_members": int(getattr(ws, "max_members", 25) or 25),
                "members_used": members_used,
                "max_desktop_devices": lic["max_desktop_devices"],
                "active_desktop_devices": active_desktop,
                "plan_expires_at": lic["plan_expires_at"],
                "license": lic,
                "community_status": getattr(ws, "community_status", "active") or "active",
                "invited_by_code": getattr(ws, "invited_by_code", None),
                "created_at": ws.created_at.isoformat() if ws.created_at else None,
            }
        )
    from app.bootstrap import check_db_email_guard_status

    return {
        "require_invite_code": is_require_invite_code_enabled(ctx.session, settings),
        "db_email_guard_status": check_db_email_guard_status(ctx.session),
        "total_workspaces": len(ws_rows),
        "active_workspaces": sum(1 for w in ws_rows if w["community_status"] == "active"),
        "invite_codes_count": codes_count,
        "workspaces": ws_rows,
    }


@router.get("/admin/invite-codes")
def admin_list_invite_codes(ctx: Ctx) -> list[dict[str, Any]]:
    _require_platform_admin(ctx)
    rows = (
        ctx.session.execute(
            sa.select(CommunityInviteCode).order_by(CommunityInviteCode.created_at.desc())
        )
        .scalars()
        .all()
    )
    return [_serialize_invite(r) for r in rows]


@router.post("/admin/invite-codes", status_code=201)
def admin_create_invite_code(ctx: Ctx, payload: InviteCodeCreateRequest) -> dict[str, Any]:
    _require_platform_admin(ctx)
    tier = normalize_plan_tier(payload.plan_tier)
    def_vias, def_ads, def_members = PLAN_QUOTA_DEFAULTS[tier]
    raw_code = (payload.code or "").strip().upper()
    if not raw_code:
        prefix = "FREE" if tier == "community_free" else tier.upper()
        raw_code = f"ADSOPS-{prefix}-{secrets.token_hex(3).upper()}"

    expires_at = (
        datetime.now(UTC) + timedelta(days=int(payload.expires_days))
        if payload.expires_days is not None
        else None
    )
    row = CommunityInviteCode(
        code=raw_code[:64],
        label=payload.label.strip()[:160],
        plan_tier=tier,
        max_vias=int(payload.max_vias or def_vias),
        max_ad_accounts=int(payload.max_ad_accounts or def_ads),
        max_members=int(payload.max_members or def_members),
        max_uses=int(payload.max_uses),
        used_count=0,
        is_active=True,
        expires_at=expires_at,
        duration_days=payload.duration_days,
        created_by_user_id=ctx.user.id,
    )
    ctx.session.add(row)
    ctx.session.flush()
    ctx.audit.record(
        action="community.invite_code_created",
        entity_type="community_invite_code",
        entity_id=row.id,
        metadata={
            "code": row.code,
            "plan_tier": row.plan_tier,
            "max_uses": row.max_uses,
            "duration_days": row.duration_days,
        },
    )
    ctx.commit()
    return _serialize_invite(row)


@router.patch("/admin/invite-codes/{code_id}")
def admin_patch_invite_code(ctx: Ctx, code_id: uuid.UUID, payload: InviteCodePatchRequest) -> dict[str, Any]:
    _require_platform_admin(ctx)
    row = ctx.session.get(CommunityInviteCode, code_id)
    if row is None:
        raise NotFoundError("Invite code not found.")
    if payload.is_active is not None:
        row.is_active = payload.is_active
    if payload.max_uses is not None:
        row.max_uses = payload.max_uses
    ctx.commit()
    return _serialize_invite(row)


@router.patch("/admin/workspaces/{workspace_id}")
def admin_patch_workspace(
    ctx: Ctx, workspace_id: uuid.UUID, payload: WorkspaceGovernancePatchRequest
) -> dict[str, Any]:
    _require_platform_admin(ctx)
    ws = ctx.session.get(Workspace, workspace_id)
    if ws is None or ws.archived_at is not None:
        raise NotFoundError("Workspace not found.")

    if payload.plan_tier is not None:
        tier = normalize_plan_tier(payload.plan_tier)
        ws.plan_tier = tier
        if payload.max_vias is None and payload.max_ad_accounts is None and payload.max_members is None:
            dv, da, dm = PLAN_QUOTA_DEFAULTS[tier]
            ws.max_vias, ws.max_ad_accounts, ws.max_members = dv, da, dm
        if payload.max_desktop_devices is None:
            ws.max_desktop_devices = DEFAULT_MAX_DESKTOP_DEVICES.get(tier, 10)

    if payload.max_vias is not None:
        ws.max_vias = payload.max_vias
    if payload.max_ad_accounts is not None:
        ws.max_ad_accounts = payload.max_ad_accounts
    if payload.max_members is not None:
        ws.max_members = payload.max_members
    if payload.max_desktop_devices is not None:
        ws.max_desktop_devices = payload.max_desktop_devices
    if payload.community_status is not None:
        ws.community_status = payload.community_status

    now_utc = datetime.now(UTC)
    if payload.clear_expiry:
        ws.plan_expires_at = None
    elif payload.plan_expires_at is not None:
        exp_dt = payload.plan_expires_at
        if exp_dt.tzinfo is None:
            exp_dt = exp_dt.replace(tzinfo=UTC)
        ws.plan_expires_at = exp_dt
    elif payload.extend_months is not None:
        cur_exp = getattr(ws, "plan_expires_at", None)
        if cur_exp is not None and cur_exp.tzinfo is None:
            cur_exp = cur_exp.replace(tzinfo=UTC)
        anchor = max(now_utc, cur_exp) if cur_exp else now_utc
        ws.plan_expires_at = _add_months(anchor, int(payload.extend_months))

    active_desktop = count_active_desktop_sessions(ctx.session, ws.id)
    lic = evaluate_workspace_license(ws, active_desktop_devices=active_desktop)
    ctx.audit.record(
        action="community.workspace_updated",
        entity_type="workspace",
        entity_id=ws.id,
        metadata={
            "plan_tier": ws.plan_tier,
            "max_vias": ws.max_vias,
            "max_ad_accounts": ws.max_ad_accounts,
            "max_members": ws.max_members,
            "max_desktop_devices": lic["max_desktop_devices"],
            "plan_expires_at": lic["plan_expires_at"],
            "community_status": ws.community_status,
        },
    )
    ctx.commit()
    vias_used, ad_accounts_used, members_used = workspace_resource_usage(ctx.session, ws.id)
    owner_uid, owner_email = _workspace_owner_info(ctx.session, ws.id)
    return {
        "id": str(ws.id),
        "name": ws.name,
        "slug": ws.slug,
        "owner_user_id": owner_uid,
        "owner_email": owner_email,
        "plan_tier": ws.plan_tier,
        "max_vias": ws.max_vias,
        "vias_used": vias_used,
        "max_ad_accounts": ws.max_ad_accounts,
        "ad_accounts_used": ad_accounts_used,
        "max_members": ws.max_members,
        "members_used": members_used,
        "max_desktop_devices": lic["max_desktop_devices"],
        "active_desktop_devices": active_desktop,
        "plan_expires_at": lic["plan_expires_at"],
        "license": lic,
        "community_status": ws.community_status,
        "invited_by_code": ws.invited_by_code,
    }


@router.post("/admin/users/{user_id}/reset-link")
def admin_create_password_reset_link(ctx: Ctx, user_id: uuid.UUID) -> dict[str, Any]:
    """Super-Admin helper: mint a 30-min single-use password reset URL when SMTP isn't used."""
    _require_platform_admin(ctx)
    target = ctx.session.get(User, user_id)
    if target is None or not target.is_active:
        raise NotFoundError("User not found.")

    settings = get_settings()
    now_utc = datetime.now(UTC)
    raw_secret = secrets.token_urlsafe(32)
    expires_at = now_utc + timedelta(minutes=30)
    row = PasswordResetToken(
        user_id=target.id,
        token_hash=hashlib.sha256(raw_secret.encode("utf-8")).hexdigest(),
        expires_at=expires_at,
        requested_ip_hash=None,
    )
    ctx.session.add(row)
    ctx.audit.record(
        action="community.admin_reset_link_created",
        entity_type="user",
        entity_id=target.id,
        metadata={"target_email": target.email, "expires_at": expires_at.isoformat()},
    )
    ctx.commit()
    return {
        "user_id": str(target.id),
        "email": target.email,
        "reset_url": build_password_reset_url(settings, raw_secret),
        "expires_at": expires_at.isoformat(),
        "smtp_configured": settings.smtp_configured,
    }


@router.put("/admin/policy")
def admin_put_policy(ctx: Ctx, payload: CommunityPolicyPutRequest) -> dict[str, Any]:
    _require_platform_admin(ctx)
    ctx.audit.record(
        action="community_policy.updated",
        entity_type="community_policy",
        entity_id="global",
        metadata={"require_invite_code": bool(payload.require_invite_code)},
    )
    ctx.commit()
    return {"require_invite_code": bool(payload.require_invite_code)}


class AllowlistEmailRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=320)
    note: str = Field(default="", max_length=240)


@router.get("/admin/email-allowlist")
def admin_list_email_allowlist(ctx: Ctx) -> dict[str, Any]:
    _require_platform_admin(ctx)
    from app.bootstrap import check_db_email_guard_status
    from app.models.entities import SignupEmailAllowlist

    rows = (
        ctx.session.execute(sa.select(SignupEmailAllowlist).order_by(SignupEmailAllowlist.created_at.desc()))
        .scalars()
        .all()
    )
    return {
        "db_email_guard_status": check_db_email_guard_status(ctx.session),
        "items": [
            {
                "email": r.email,
                "note": r.note,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


@router.post("/admin/email-allowlist", status_code=201)
def admin_add_email_allowlist(ctx: Ctx, payload: AllowlistEmailRequest) -> dict[str, Any]:
    _require_platform_admin(ctx)
    from app.core.errors import ValidationError
    from app.models.entities import SignupEmailAllowlist

    clean = (payload.email or "").strip().lower()
    if "@" not in clean or "." not in clean.split("@", 1)[1]:
        raise ValidationError("Địa chỉ email ngoại lệ không hợp lệ.", details={"field": "email"})
    row = ctx.session.get(SignupEmailAllowlist, clean)
    if row is None:
        row = SignupEmailAllowlist(
            email=clean,
            note=payload.note.strip()[:240],
            created_by_user_id=ctx.user.id,
        )
        ctx.session.add(row)
    else:
        row.note = payload.note.strip()[:240]
    ctx.audit.record(
        action="community.email_allowlist_added",
        entity_type="signup_email_allowlist",
        entity_id=clean,
        metadata={"note": row.note},
    )
    ctx.commit()
    return {"email": row.email, "note": row.note}


class AllowlistRemoveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=320)


@router.post("/admin/email-allowlist/remove")
def admin_remove_email_allowlist(ctx: Ctx, payload: AllowlistRemoveRequest) -> dict[str, Any]:
    _require_platform_admin(ctx)
    from app.models.entities import SignupEmailAllowlist

    clean = (payload.email or "").strip().lower()
    row = ctx.session.get(SignupEmailAllowlist, clean)
    if row is None:
        raise NotFoundError("Email is not in allowlist.")
    ctx.session.delete(row)
    ctx.audit.record(
        action="community.email_allowlist_removed",
        entity_type="signup_email_allowlist",
        entity_id=clean,
    )
    ctx.commit()
    return {"removed": clean}
