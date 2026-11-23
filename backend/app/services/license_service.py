"""Commercial workspace license & desktop device limit policy helpers."""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.errors import AuthorizationError

DEFAULT_MAX_DESKTOP_DEVICES: dict[str, int] = {
    "community_free": 1,
    "pro": 2,
    "agency": 10,
}

GRACE_PERIOD_DAYS = 3
EXPIRING_WARNING_DAYS = 7


def _ensure_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


def effective_max_desktop_devices(workspace: Any) -> int:
    custom = getattr(workspace, "max_desktop_devices", None)
    if custom is not None and int(custom) >= 1:
        return int(custom)
    tier = (getattr(workspace, "plan_tier", "agency") or "agency").strip().lower()
    return DEFAULT_MAX_DESKTOP_DEVICES.get(tier, 10)


def count_active_desktop_sessions(session: Session, workspace_id: uuid.UUID, now: datetime | None = None) -> int:
    from app.models.team import DeviceSession

    ref = now or datetime.now(UTC)
    return int(
        session.execute(
            sa.select(sa.func.count(DeviceSession.id)).where(
                DeviceSession.workspace_id == workspace_id,
                DeviceSession.client_channel == "desktop",
                DeviceSession.revoked_at.is_(None),
                DeviceSession.expires_at > ref,
            )
        ).scalar_one()
        or 0
    )


def evaluate_workspace_license(
    workspace: Any,
    now: datetime | None = None,
    *,
    active_desktop_devices: int | None = None,
) -> dict[str, Any]:
    ref = _ensure_utc(now) or datetime.now(UTC)
    tier = (getattr(workspace, "plan_tier", "agency") or "agency").strip().lower()
    max_devices = effective_max_desktop_devices(workspace)
    exp = _ensure_utc(getattr(workspace, "plan_expires_at", None))

    if exp is None:
        return {
            "status": "unlimited",
            "is_read_only": False,
            "plan_tier": tier,
            "plan_expires_at": None,
            "grace_ends_at": None,
            "days_remaining": None,
            "max_desktop_devices": max_devices,
            "active_desktop_devices": active_desktop_devices,
        }

    grace_ends = exp + timedelta(days=GRACE_PERIOD_DAYS)
    delta_secs = (exp - ref).total_seconds()
    days_remaining = int(delta_secs // 86400) if delta_secs >= 0 else -int((-delta_secs + 86399) // 86400)

    if ref > grace_ends:
        status = "read_only"
        is_read_only = True
    elif ref > exp:
        status = "grace"
        is_read_only = False
    elif days_remaining <= EXPIRING_WARNING_DAYS:
        status = "expiring"
        is_read_only = False
    else:
        status = "active"
        is_read_only = False

    return {
        "status": status,
        "is_read_only": is_read_only,
        "plan_tier": tier,
        "plan_expires_at": exp.isoformat(),
        "grace_ends_at": grace_ends.isoformat(),
        "days_remaining": days_remaining,
        "max_desktop_devices": max_devices,
        "active_desktop_devices": active_desktop_devices,
    }


def require_workspace_writable(workspace: Any, now: datetime | None = None) -> None:
    info = evaluate_workspace_license(workspace, now)
    if info["is_read_only"]:
        raise AuthorizationError(
            "Gói thuê bao của Workspace đã quá hạn ân hạn 3 ngày và đang ở chế độ Chỉ-đọc. "
            "Vui lòng nhập Mã kích hoạt tại Cài đặt hoặc liên hệ Quản trị viên để gia hạn.",
            details={"reason": "license_read_only", "license": info},
        )
