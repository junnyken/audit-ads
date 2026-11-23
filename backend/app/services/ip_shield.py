"""v5.3 Core IP Protection, Server-Side Extension Packager, Canary Watermarking & Anti-Harvesting."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import pathlib
import re
import secrets
import threading
import time
import uuid
import zlib
from collections import deque
from datetime import UTC, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import AuthenticationError, TooManyRequestsError
from app.models.entities import AuditLog, User, Workspace
from app.services.audit import AuditLogService
from app.services.community_quota import is_user_platform_admin

_PRIVATE_RELEASES_DIR = pathlib.Path(__file__).resolve().parents[2] / "private_releases"
_TEMPLATE_BIN_PATH = _PRIVATE_RELEASES_DIR / "extension_template.bin"
_DESKTOP_RELEASE_ZIP_PATH = _PRIVATE_RELEASES_DIR / "AdsOps-Desktop-Pro-latest.zip"
_DESKTOP_MANIFEST_PATH = _PRIVATE_RELEASES_DIR / "AdsOps-Desktop-Pro-latest.json"

_CANARY_RE = re.compile(r"CNRY-([0-9a-f]{4,16})-([0-9a-f]{16})", re.IGNORECASE)
_TEMPLATE_LOCK = threading.Lock()
_CACHED_TEMPLATE: dict[str, Any] | None = None

_VELOCITY_LOCK = threading.Lock()
_VELOCITY_BUCKETS: dict[str, deque[float]] = {}
_MAX_VELOCITY_KEYS = 10_000

_TICKET_LOCK = threading.Lock()
_CONSUMED_TICKETS: dict[str, float] = {}
_MAX_CONSUMED_TICKETS = 5_000


def get_desktop_release_zip_path() -> pathlib.Path:
    return _DESKTOP_RELEASE_ZIP_PATH


def get_desktop_release_manifest() -> dict[str, Any]:
    if not _DESKTOP_MANIFEST_PATH.is_file():
        return {"version": "5.1.0", "ext_version": "2.11.0"}
    try:
        return json.loads(_DESKTOP_MANIFEST_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"version": "5.1.0", "ext_version": "2.11.0"}


def _load_extension_template() -> dict[str, Any]:
    global _CACHED_TEMPLATE
    with _TEMPLATE_LOCK:
        if _CACHED_TEMPLATE is not None:
            return _CACHED_TEMPLATE
        if not _TEMPLATE_BIN_PATH.is_file():
            raise FileNotFoundError(f"Missing private extension template at {_TEMPLATE_BIN_PATH}")
        raw = zlib.decompress(_TEMPLATE_BIN_PATH.read_bytes())
        _CACHED_TEMPLATE = json.loads(raw.decode("utf-8"))
        return _CACHED_TEMPLATE


def check_anti_harvesting_velocity(
    session: Session,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    bucket_name: str,
    settings: Settings,
) -> None:
    """Block high-frequency AI fuzzing/harvesting bursts with 429 and record an audit alert."""
    now = time.monotonic()
    window = max(5, int(settings.anti_harvest_burst_window_seconds or 30))
    limit = max(3, int(settings.anti_harvest_burst_limit or 12))
    key = f"{bucket_name}:{workspace_id}:{user_id}"

    with _VELOCITY_LOCK:
        if len(_VELOCITY_BUCKETS) >= _MAX_VELOCITY_KEYS and key not in _VELOCITY_BUCKETS:
            oldest_key = next(iter(_VELOCITY_BUCKETS))
            _VELOCITY_BUCKETS.pop(oldest_key, None)
        dq = _VELOCITY_BUCKETS.setdefault(key, deque())
        cutoff = now - float(window)
        while dq and dq[0] < cutoff:
            dq.popleft()
        dq.append(now)
        hit_count = len(dq)

    if hit_count > limit:
        AuditLogService(session, workspace_id, user_id).record(
            action="security.ai_harvesting_suspected",
            entity_type="user",
            entity_id=user_id,
            metadata={"bucket": bucket_name, "hits_in_window": hit_count, "window_seconds": window},
        )
        session.commit()
        raise TooManyRequestsError(
            "Phát hiện tần suất truy vấn tự động quá nhanh. Vui lòng tạm nghỉ vài chục giây trước khi tiếp tục.",
            details={"reason": "ai_harvesting_rate_limited", "retry_after_seconds": window},
        )


def enforce_daily_ip_quota(
    session: Session,
    *,
    workspace: Workspace,
    user: User,
    action_key: str,
    settings: Settings,
    record_scan: bool = False,
) -> None:
    """Enforce daily tier limits for policy checks, extension packaging, and desktop downloads."""
    plan_tier = (getattr(workspace, "plan_tier", "community_free") or "community_free").strip().lower()
    is_admin = is_user_platform_admin(user, settings)

    limits_by_key: dict[str, tuple[str, int, int, int]] = {
        "policy_scan": (
            "security.policy_scan_executed",
            max(5, int(settings.free_daily_policy_scans or 30)),
            1500,
            5000,
        ),
        "extension_bundle": (
            "security.extension_bundle_issued",
            max(1, int(settings.free_daily_extension_bundles or 3)),
            200,
            500,
        ),
        "desktop_ticket": (
            "security.desktop_download_ticket_issued",
            max(1, int(settings.free_daily_desktop_downloads or 3)),
            50,
            100,
        ),
    }
    action_name, free_lim, pro_lim, agency_lim = limits_by_key[action_key]
    limit = agency_lim if plan_tier == "agency" else (pro_lim if plan_tier == "pro" else free_lim)

    if not is_admin:
        since = datetime.now(UTC) - timedelta(hours=24)
        used = int(
            session.execute(
                sa.select(sa.func.count(AuditLog.id)).where(
                    AuditLog.workspace_id == workspace.id,
                    AuditLog.action == action_name,
                    AuditLog.created_at >= since,
                )
            ).scalar_one()
            or 0
        )
        if used >= limit:
            raise TooManyRequestsError(
                f"Workspace gói {plan_tier.upper()} đã dùng hết hạn mức {limit} lượt/24h cho tính năng này.",
                details={
                    "reason": "daily_ip_quota_exceeded",
                    "action_key": action_key,
                    "limit": limit,
                    "retry_after_seconds": 3600,
                },
            )

    if record_scan:
        AuditLogService(session, workspace.id, user.id).record(
            action=action_name,
            entity_type="workspace",
            entity_id=workspace.id,
            metadata={"plan_tier": plan_tier},
        )


def mint_canary_id(
    settings: Settings,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID | None,
    *,
    issued_ts: int | None = None,
) -> tuple[str, int]:
    """Produce an HMAC-authenticated Canary ID tied cleanly to Workspace + User + Timestamp."""
    ts = int(issued_ts if issued_ts is not None else time.time())
    uid_str = str(user_id) if user_id is not None else "system"
    msg = f"adsops-canary:{workspace_id}:{uid_str}:{ts}".encode()
    mac = hmac.new(settings.jwt_secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()[:16]
    return f"CNRY-{ts:x}-{mac}", ts


def verify_and_lookup_canary(session: Session, settings: Settings, raw_text: str) -> dict[str, Any]:
    """Extract CNRY-<ts>-<mac> from pasted manifest/script text and trace its issuer cleanly."""
    match = _CANARY_RE.search(raw_text or "")
    if not match:
        return {
            "found": False,
            "canary_id": None,
            "hmac_verified": False,
            "message": "Không tìm thấy mã định danh Canary (định dạng CNRY-...) trong nội dung đã dán.",
        }

    ts_hex = match.group(1).lower()
    mac_hex = match.group(2).lower()
    canary_id = f"CNRY-{ts_hex}-{mac_hex}"

    row = (
        session.execute(
            sa.select(AuditLog)
            .where(
                AuditLog.entity_type == "extension_canary",
                AuditLog.entity_id == canary_id,
            )
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        )
        .scalars()
        .first()
    )
    if row is None:
        return {
            "found": False,
            "canary_id": canary_id,
            "hmac_verified": False,
            "message": "Mã Canary không có trong nhật ký cấp phát hệ thống hoặc đã bị làm giả.",
        }

    meta = row.metadata_json if isinstance(row.metadata_json, dict) else {}
    issued_ts = int(meta.get("issued_ts") or int(ts_hex, 16))
    expected_cid, _ = mint_canary_id(settings, row.workspace_id, row.actor_id, issued_ts=issued_ts)
    hmac_ok = hmac.compare_digest(canary_id, expected_cid)

    ws = session.get(Workspace, row.workspace_id)
    usr = session.get(User, row.actor_id) if row.actor_id else None
    return {
        "found": True,
        "canary_id": canary_id,
        "hmac_verified": hmac_ok,
        "workspace_id": str(row.workspace_id),
        "workspace_name": ws.name if ws else "",
        "user_id": str(row.actor_id) if row.actor_id else None,
        "user_email": usr.email if usr else "",
        "action": row.action,
        "plan_tier": str(meta.get("plan_tier") or (ws.plan_tier if ws else "")),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "message": (
            "Xác thực chữ ký Canary hợp lệ — đã định danh nguồn cấp phát."
            if hmac_ok
            else "Tìm thấy bản ghi Canary nhưng chữ ký HMAC không khớp."
        ),
    }


def render_watermarked_extension_bundle(
    session: Session,
    *,
    workspace: Workspace,
    user: User,
    audit: AuditLogService,
    settings: Settings,
    folder_root: str = "AdsOps-Chrome-Extension",
    via_name: str = "Via Facebook",
    profile_dir: str = "Default",
    via_tier: str = "camp",
    via_id: str = "",
    bundled_accounts: list[dict[str, Any]] | None = None,
    stewardship_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Assemble Extension files server-side with Canary Watermark and local secret placeholders."""
    tpl = _load_extension_template()
    clean_folder = re.sub(r"[^a-zA-Z0-9._-]+", "-", (folder_root or "").strip()).strip("-")[:64] or "AdsOps-Chrome-Extension"
    clean_via = (via_name or "Via Facebook").strip()[:120]
    clean_prof = (profile_dir or "Default").strip()[:80]
    clean_tier = via_tier if via_tier in ("vault", "camp", "standby") else "camp"
    clean_via_id = (via_id or "").strip()[:80]
    meta = stewardship_meta or {}

    canary_id, issued_ts = mint_canary_id(settings, workspace.id, user.id)
    watermark_banner = f"/* AdsOps Integrity {canary_id} */\n"

    manifest_obj = dict(tpl["manifest_base"])
    manifest_obj["name"] = "__ADSOPS_MANIFEST_NAME__"
    manifest_obj["version_name"] = f"{tpl['version']} ({canary_id})"
    action_obj = dict(manifest_obj.get("action") or {})
    action_obj["default_title"] = f"AdsOps Companion Pro ({clean_via})"
    manifest_obj["action"] = action_obj

    default_warmup = meta.get("default_warmup_mode") or ("soak_72h" if meta.get("warmup_phase") == "72h_lock" else "human_organic")
    default_state = {
        "viaId": clean_via_id,
        "viaName": clean_via,
        "profileCode": clean_prof,
        "viaTier": clean_tier,
        "twoFaSecret": "__ADSOPS_TOTP_SECRET_JSON__",
        "webrtcShield": True,
        "blockPasskey": True,
        "passkeyStatus": "clean",
        "proxyRaw": "__ADSOPS_PROXY_RAW_JSON__",
        "proxyEnabled": "__ADSOPS_PROXY_ENABLED_BOOL__",
        "accounts": bundled_accounts or [],
        "clientGroup": str(meta.get("client_group") or "").strip()[:120],
        "warmupPhase": str(meta.get("warmup_phase") or "trusted")[:40],
        "warmupStartIso": str(meta.get("warmup_start_iso") or "")[:64],
        "soakHoursRemaining": float(meta.get("soak_hours_remaining") or 0),
        "defaultWarmupMode": str(default_warmup)[:40],
        "soakQuarantineEnabled": bool(meta.get("soak_quarantine_enabled", True)),
        "ipKillSwitch": bool(meta.get("ip_kill_switch", True)),
        "autoVaultCookieRefresh": bool(meta.get("auto_vault_cookie_refresh", True)),
        "cooldownUntilMs": int(meta.get("cooldown_until_ms") or 0),
        "cooldownReason": str(meta.get("cooldown_reason") or "").strip()[:240],
        "trustScore": float(meta.get("trust_score") if meta.get("trust_score") is not None else 50),
        "bridgeToken": "__ADSOPS_BRIDGE_TOKEN_JSON__",
        "canaryId": canary_id,
    }
    default_via_meta = {
        "viaId": clean_via_id,
        "viaName": clean_via,
        "profileCode": clean_prof,
        "viaTier": clean_tier,
        "twoFaSecret": "__ADSOPS_TOTP_SECRET_JSON__",
        "clientGroup": default_state["clientGroup"],
        "warmupPhase": default_state["warmupPhase"],
        "warmupStartIso": default_state["warmupStartIso"],
        "soakHoursRemaining": default_state["soakHoursRemaining"],
        "defaultWarmupMode": default_state["defaultWarmupMode"],
        "soakQuarantineEnabled": default_state["soakQuarantineEnabled"],
        "ipKillSwitch": default_state["ipKillSwitch"],
        "autoVaultCookieRefresh": default_state["autoVaultCookieRefresh"],
        "cooldownUntilMs": default_state["cooldownUntilMs"],
        "cooldownReason": default_state["cooldownReason"],
        "trustScore": default_state["trustScore"],
        "bridgeToken": "__ADSOPS_BRIDGE_TOKEN_JSON__",
        "canaryId": canary_id,
    }

    background_js = f"{watermark_banner}const DEFAULT_STATE = {json.dumps(default_state, ensure_ascii=False)};\n{tpl['background_body_js']}"
    popup_js = (
        f"{watermark_banner}"
        f"const DEFAULT_ACCOUNTS = {json.dumps(bundled_accounts or [], ensure_ascii=False)};\n"
        f"const DEFAULT_VIA_META = {json.dumps(default_via_meta, ensure_ascii=False)};\n"
        f"{tpl['popup_body_js']}"
    )
    content_js = f"{watermark_banner}{tpl['content_js']}"

    files = [
        {"name": f"{clean_folder}/manifest.json", "content": json.dumps(manifest_obj, indent=2, ensure_ascii=False)},
        {"name": f"{clean_folder}/passkey_shield.js", "content": tpl["passkey_shield_js"]},
        {"name": f"{clean_folder}/background.js", "content": background_js},
        {"name": f"{clean_folder}/content.js", "content": content_js},
        {"name": f"{clean_folder}/popup.html", "content": tpl["popup_html"]},
        {"name": f"{clean_folder}/popup.js", "content": popup_js},
        {"name": f"{clean_folder}/HUONG-DAN-CAI-DAT.txt", "content": tpl["readme_txt"]},
        {
            "name": f"{clean_folder}/_release_integrity.json",
            "content": json.dumps(
                {"canary_id": canary_id, "version": tpl["version"], "workspace_id": str(workspace.id)},
                indent=2,
            ),
        },
    ]

    audit.record(
        action="security.extension_bundle_issued",
        entity_type="extension_canary",
        entity_id=canary_id,
        metadata={
            "issued_ts": issued_ts,
            "plan_tier": workspace.plan_tier,
            "via_tier": clean_tier,
            "via_id": clean_via_id,
        },
    )
    return {"canary_id": canary_id, "version": tpl["version"], "files": files}


def issue_desktop_download_ticket(
    session: Session,
    *,
    workspace: Workspace,
    user: User,
    audit: AuditLogService,
    settings: Settings,
) -> dict[str, Any]:
    """Mint a 120s HMAC-signed single-use ticket for downloading the private Desktop Pro archive."""
    canary_id, issued_ts = mint_canary_id(settings, workspace.id, user.id)
    nonce = secrets.token_hex(10)
    payload_obj = {
        "ws": str(workspace.id),
        "uid": str(user.id),
        "cid": canary_id,
        "iat": issued_ts,
        "exp": issued_ts + 120,
        "n": nonce,
    }
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload_obj, separators=(",", ":")).encode("utf-8")).decode("ascii").rstrip("=")
    sig = hmac.new(settings.jwt_secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
    ticket = f"{payload_b64}.{sig}"

    audit.record(
        action="security.desktop_download_ticket_issued",
        entity_type="extension_canary",
        entity_id=canary_id,
        metadata={"issued_ts": issued_ts, "plan_tier": workspace.plan_tier},
    )
    manifest = get_desktop_release_manifest()
    return {
        "download_path": f"{settings.api_prefix}/extension/desktop-release?ticket={ticket}",
        "expires_in_seconds": 120,
        "canary_id": canary_id,
        "version": str(manifest.get("version") or "5.1.0"),
        "filename": "AdsOps-Desktop-Pro-latest.zip",
    }


def consume_desktop_download_ticket(ticket: str, settings: Settings) -> dict[str, Any]:
    """Verify HMAC signature, expiry (120s), and single-use nonce for private Desktop download."""
    raw = (ticket or "").strip()
    if "." not in raw:
        raise AuthenticationError("Vé tải phần mềm không hợp lệ hoặc bị thiếu.")
    payload_b64, sig = raw.rsplit(".", 1)
    expected_sig = hmac.new(
        settings.jwt_secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        raise AuthenticationError("Chữ ký vé tải phần mềm không hợp lệ.")

    try:
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        obj = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
        nonce = str(obj["n"])
        exp = float(obj["exp"])
    except Exception as exc:
        raise AuthenticationError("Dữ liệu vé tải phần mềm bị lỗi.") from exc

    now = time.time()
    if now > exp:
        raise AuthenticationError("Vé tải phần mềm đã hết hạn (120 giây). Vui lòng bấm tải lại.")

    with _TICKET_LOCK:
        stale = [k for k, t_exp in _CONSUMED_TICKETS.items() if t_exp <= now]
        for k in stale:
            _CONSUMED_TICKETS.pop(k, None)
        if nonce in _CONSUMED_TICKETS:
            raise AuthenticationError("Vé tải phần mềm chỉ dùng được 1 lần. Vui lòng bấm tải lại.")
        if len(_CONSUMED_TICKETS) >= _MAX_CONSUMED_TICKETS:
            oldest = next(iter(_CONSUMED_TICKETS))
            _CONSUMED_TICKETS.pop(oldest, None)
        _CONSUMED_TICKETS[nonce] = exp + 60.0

    return obj
