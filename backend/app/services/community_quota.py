"""Community SaaS quotas, invite-code validation & Super-Admin policy helpers."""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.enums import InvitationStatus
from app.core.errors import ConflictError
from app.models.entities import (
    AdAccount,
    AuditLog,
    CommunityInviteCode,
    PersonalAccountReference,
    User,
    Workspace,
    WorkspaceMember,
)
from app.models.team import WorkspaceInvitation

PLAN_QUOTA_DEFAULTS: dict[str, tuple[int, int, int]] = {
    "community_free": (10, 5, 2),
    "pro": (50, 30, 5),
    "agency": (500, 500, 25),
}


def normalize_plan_tier(raw: str | None) -> str:
    clean = (raw or "").strip().lower()
    if clean in PLAN_QUOTA_DEFAULTS:
        return clean
    return "community_free"


def normalize_invite_code(raw: str | None) -> str:
    return (raw or "").strip().upper()


def is_user_platform_admin(user: User, settings: Settings) -> bool:
    if bool(getattr(user, "is_platform_admin", False)):
        return True
    boot = (settings.bootstrap_owner_email or "").strip().lower()
    return bool(boot) and user.email.strip().lower() == boot


def is_require_invite_code_enabled(session: Session, settings: Settings) -> bool:
    latest = (
        session.execute(
            sa.select(AuditLog)
            .where(
                AuditLog.entity_type == "community_policy",
                AuditLog.action == "community_policy.updated",
            )
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        )
        .scalars()
        .first()
    )
    if latest is not None and isinstance(latest.metadata_json, dict) and "require_invite_code" in latest.metadata_json:
        return bool(latest.metadata_json["require_invite_code"])
    return bool(getattr(settings, "community_require_invite_code", False))


def _ensure_utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


def validate_and_consume_invite_code(session: Session, raw_code: str) -> CommunityInviteCode:
    norm = normalize_invite_code(raw_code)
    if not norm:
        raise ConflictError("Vui lòng nhập Mã mời (Invite Code) hợp lệ.")
    invite = session.execute(
        sa.select(CommunityInviteCode).where(sa.func.upper(CommunityInviteCode.code) == norm)
    ).scalar_one_or_none()
    if invite is None or not invite.is_active:
        raise ConflictError(
            f"Mã mời '{norm}' không tồn tại hoặc đã bị khóa.",
            details={"field": "invite_code", "reason": "invalid_invite_code"},
        )
    if invite.expires_at is not None and _ensure_utc(invite.expires_at) <= datetime.now(UTC):
        raise ConflictError(
            f"Mã mời '{norm}' đã hết hạn sử dụng.",
            details={"field": "invite_code", "reason": "expired_invite_code"},
        )
    if invite.used_count >= invite.max_uses:
        raise ConflictError(
            f"Mã mời '{norm}' đã đạt tối đa số lượt kích hoạt ({invite.max_uses}).",
            details={"field": "invite_code", "reason": "exhausted_invite_code"},
        )
    invite.used_count += 1
    return invite


def workspace_resource_usage(session: Session, workspace_id: uuid.UUID) -> tuple[int, int, int]:
    vias_used = int(
        session.execute(
            sa.select(sa.func.count(PersonalAccountReference.id)).where(
                PersonalAccountReference.workspace_id == workspace_id,
                PersonalAccountReference.archived_at.is_(None),
            )
        ).scalar_one()
        or 0
    )
    ad_accounts_used = int(
        session.execute(
            sa.select(sa.func.count(AdAccount.id)).where(
                AdAccount.workspace_id == workspace_id,
                AdAccount.archived_at.is_(None),
            )
        ).scalar_one()
        or 0
    )
    active_members = int(
        session.execute(
            sa.select(sa.func.count(WorkspaceMember.id)).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.archived_at.is_(None),
            )
        ).scalar_one()
        or 0
    )
    pending_invites = int(
        session.execute(
            sa.select(sa.func.count(WorkspaceInvitation.id)).where(
                WorkspaceInvitation.workspace_id == workspace_id,
                WorkspaceInvitation.status == InvitationStatus.PENDING,
            )
        ).scalar_one()
        or 0
    )
    return vias_used, ad_accounts_used, active_members + pending_invites


def enforce_workspace_quota(session: Session, workspace: Workspace, resource_kind: str) -> None:
    vias_used, ad_accounts_used, members_used = workspace_resource_usage(session, workspace.id)
    tier = getattr(workspace, "plan_tier", "agency") or "agency"
    max_vias = int(getattr(workspace, "max_vias", 500) or 500)
    max_ads = int(getattr(workspace, "max_ad_accounts", 500) or 500)
    max_members = int(getattr(workspace, "max_members", 25) or 25)

    if resource_kind == "via" and vias_used >= max_vias:
        raise ConflictError(
            f"Gói {tier.upper()} đang giới hạn tối đa {max_vias} tài khoản Via ({vias_used}/{max_vias}). "
            "Hãy vào Cài đặt -> Nạp Mã Nâng cấp Pro/Agency hoặc liên hệ Quản trị viên Cộng đồng.",
            details={"reason": "quota_exceeded", "resource": "via", "limit": max_vias, "used": vias_used},
        )
    if resource_kind == "ad_account" and ad_accounts_used >= max_ads:
        raise ConflictError(
            f"Gói {tier.upper()} đang giới hạn tối đa {max_ads} TKQC ({ad_accounts_used}/{max_ads}). "
            "Hãy vào Cài đặt -> Nạp Mã Nâng cấp Pro/Agency để mở rộng hạn mức.",
            details={"reason": "quota_exceeded", "resource": "ad_account", "limit": max_ads, "used": ad_accounts_used},
        )
    if resource_kind == "member" and members_used >= max_members:
        raise ConflictError(
            f"Gói {tier.upper()} đang giới hạn tối đa {max_members} thành viên Team ({members_used}/{max_members}). "
            "Hãy nâng cấp gói Pro/Agency để mời thêm nhân sự.",
            details={"reason": "quota_exceeded", "resource": "member", "limit": max_members, "used": members_used},
        )
