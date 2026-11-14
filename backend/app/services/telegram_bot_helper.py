"""Workspace-scoped Telegram Bot verification, chat discovery, encrypted storage, and instant alerts.

Structural security boundary:
* Imports zero cryptographic libraries (`encrypt_telegram_token` / `open_telegram_token` stay in `core/secret_vault.py`).
* Never logs, raises, or returns a bot token or bot request URL.
* AuditLog metadata keys omit sensitive fragments (`token`, `secret`, `ciphertext`, `credential`) so redaction
  preserves the encrypted Fernet envelope (`telegram_bot_envelope`) and masked preview (`telegram_bot_mask`).
"""
from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.request
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import ACTIVE_ALERT_STATUSES, AccountStatus, AlertSeverity, ReferenceStatus
from app.core.secret_vault import (
    SecretDecryptionError,
    encrypt_telegram_token,
    open_telegram_token,
)
from app.models.alerts import Alert, AlertPolicy
from app.models.entities import AdAccount, AuditLog, Page
from app.services import quiet_hours
from app.services.audit import AuditLogService
from app.services.notification_transport import OutboundMessage
from app.services.telegram_transport import TelegramTransport

logger = logging.getLogger(__name__)

_BOT_TOKEN_RE = re.compile(r"^\d{6,16}:[A-Za-z0-9_-]{20,100}$")


def validate_bot_token_format(bot_token: str) -> bool:
    return bool(_BOT_TOKEN_RE.match((bot_token or "").strip()))


def mask_bot_token(bot_token: str) -> str:
    clean = (bot_token or "").strip()
    if not clean or ":" not in clean:
        return "***"
    bot_id, _, secret_part = clean.partition(":")
    tail = secret_part[-4:] if len(secret_part) >= 4 else "***"
    return f"{bot_id}:...{tail}"


def mask_chat_id(chat_id: str | None) -> str | None:
    clean = (chat_id or "").strip()
    if not clean:
        return None
    if clean.startswith("@"):
        return f"@...{clean[-4:]}" if len(clean) > 5 else "@..."
    return f"...{clean[-4:]}" if len(clean) > 4 else clean


def _safe_domain_url(raw: str | None) -> str:
    val = (raw or "").strip().rstrip("/")
    if not val:
        return ""
    if val.startswith("https://") and "@" not in val and " " not in val:
        return val
    return ""


def resolve_workspace_public_url(session: Session, workspace_id: uuid.UUID, settings) -> str:
    row = (
        session.execute(
            sa.select(AuditLog)
            .where(
                AuditLog.workspace_id == workspace_id,
                AuditLog.entity_type == "workspace_domain_seo",
                AuditLog.action == "workspace_domain_seo.updated",
            )
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        )
        .scalars()
        .first()
    )
    if row and isinstance(row.metadata_json, dict):
        custom = _safe_domain_url(str(row.metadata_json.get("custom_domain") or ""))
        if custom:
            return custom
    env_url = _safe_domain_url(getattr(settings, "public_app_url", "") or "")
    return env_url or "https://adsops-app.vibe.tinhgon.xyz"


def get_workspace_telegram_record(session: Session, workspace_id: uuid.UUID) -> dict[str, Any]:
    row = (
        session.execute(
            sa.select(AuditLog)
            .where(
                AuditLog.workspace_id == workspace_id,
                AuditLog.entity_type == "workspace_telegram_config",
                AuditLog.action == "workspace_telegram_config.updated",
            )
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        )
        .scalars()
        .first()
    )
    meta = dict(row.metadata_json or {}) if row and isinstance(row.metadata_json, dict) else {}
    policy = session.execute(
        sa.select(AlertPolicy).where(AlertPolicy.workspace_id == workspace_id)
    ).scalar_one_or_none()
    chat_id = str(meta.get("chat_id") or (policy.telegram_chat_id if policy else "") or "").strip()
    return {
        "enabled": bool(meta.get("enabled", True if not policy else policy.enabled)),
        "chat_id": chat_id,
        "telegram_bot_envelope": str(meta.get("telegram_bot_envelope") or "").strip(),
        "telegram_bot_mask": str(meta.get("telegram_bot_mask") or "").strip(),
        "bot_username": str(meta.get("bot_username") or "").strip(),
        "bot_name": str(meta.get("bot_name") or "").strip(),
        "notify_ad_account_disabled": bool(meta.get("notify_ad_account_disabled", True)),
        "notify_billing_failed": bool(meta.get("notify_billing_failed", True)),
        "notify_page_restricted": bool(meta.get("notify_page_restricted", True)),
        "notify_retainer_overspend": bool(meta.get("notify_retainer_overspend", True)),
        "quiet_hours_respect": bool(meta.get("quiet_hours_respect", True)),
        "quiet_hours_start": (policy.quiet_hours_start.strftime("%H:%M") if policy and policy.quiet_hours_start else "23:00"),
        "quiet_hours_end": (policy.quiet_hours_end.strftime("%H:%M") if policy and policy.quiet_hours_end else "07:00"),
        "quiet_hours_enabled": bool(policy.quiet_hours_enabled) if policy else True,
        "updated_at": row.created_at.isoformat() if row and row.created_at else None,
    }


def serialize_workspace_telegram_config(
    session: Session, workspace_id: uuid.UUID, settings
) -> dict[str, Any]:
    rec = get_workspace_telegram_record(session, workspace_id)
    has_env_bot = bool(getattr(settings, "telegram_transport_configured", False))
    has_ws_bot = bool(rec["telegram_bot_envelope"])
    return {
        "enabled": rec["enabled"],
        "bot_configured": has_ws_bot or has_env_bot,
        "bot_source": "workspace" if has_ws_bot else ("server_env" if has_env_bot else "none"),
        "bot_mask": rec["telegram_bot_mask"] or ("server-configured" if has_env_bot else ""),
        "bot_username": rec["bot_username"] or None,
        "bot_name": rec["bot_name"] or None,
        "chat_configured": bool(rec["chat_id"]),
        "chat_id_masked": mask_chat_id(rec["chat_id"]),
        "notify_ad_account_disabled": rec["notify_ad_account_disabled"],
        "notify_billing_failed": rec["notify_billing_failed"],
        "notify_page_restricted": rec["notify_page_restricted"],
        "notify_retainer_overspend": rec["notify_retainer_overspend"],
        "quiet_hours_respect": rec["quiet_hours_respect"],
        "quiet_hours_enabled": rec["quiet_hours_enabled"],
        "quiet_hours_start": rec["quiet_hours_start"],
        "quiet_hours_end": rec["quiet_hours_end"],
        "updated_at": rec["updated_at"],
    }


def resolve_workspace_bot_token(session: Session, workspace_id: uuid.UUID, settings) -> str | None:
    rec = get_workspace_telegram_record(session, workspace_id)
    env_blob = rec.get("telegram_bot_envelope") or ""
    if env_blob:
        try:
            return open_telegram_token(settings, env_blob)
        except SecretDecryptionError:
            logger.warning("workspace_telegram_envelope_unreadable", extra={"workspace_id": str(workspace_id)})
    if getattr(settings, "telegram_transport_configured", False):
        tok = (getattr(settings, "telegram_bot_token", "") or "").strip()
        return tok or None
    return None


def resolve_workspace_telegram_transport(
    session: Session, workspace_id: uuid.UUID, settings
) -> TelegramTransport | None:
    if (getattr(settings, "notification_transport", "") or "").strip().lower() == "fake":
        return None
    rec = get_workspace_telegram_record(session, workspace_id)
    if not rec.get("enabled", True):
        return None
    env_blob = rec.get("telegram_bot_envelope") or ""
    if not env_blob:
        return None
    try:
        bot_token = open_telegram_token(settings, env_blob)
    except SecretDecryptionError:
        return None
    if not bot_token:
        return None
    return TelegramTransport(
        bot_token=bot_token,
        api_base_url=getattr(settings, "telegram_api_base_url", "https://api.telegram.org"),
        timeout_seconds=int(getattr(settings, "telegram_timeout_seconds", 10)),
    )


def save_workspace_telegram_config(
    session: Session,
    workspace_id: uuid.UUID,
    audit: AuditLogService,
    settings,
    *,
    bot_token: str | None = None,
    clear_bot_token: bool = False,
    chat_id: str | None = None,
    enabled: bool | None = None,
    notify_ad_account_disabled: bool | None = None,
    notify_billing_failed: bool | None = None,
    notify_page_restricted: bool | None = None,
    notify_retainer_overspend: bool | None = None,
    quiet_hours_respect: bool | None = None,
    bot_username: str | None = None,
    bot_name: str | None = None,
) -> dict[str, Any]:
    cur = get_workspace_telegram_record(session, workspace_id)
    next_envelope = "" if clear_bot_token else cur["telegram_bot_envelope"]
    next_mask = "" if clear_bot_token else cur["telegram_bot_mask"]
    next_username = "" if clear_bot_token else (bot_username if bot_username is not None else cur["bot_username"])
    next_bot_name = "" if clear_bot_token else (bot_name if bot_name is not None else cur["bot_name"])

    clean_new_bot = (bot_token or "").strip()
    if clean_new_bot:
        next_envelope = encrypt_telegram_token(settings, clean_new_bot)
        next_mask = mask_bot_token(clean_new_bot)

    next_chat = cur["chat_id"] if chat_id is None else str(chat_id).strip()[:64]
    next_enabled = cur["enabled"] if enabled is None else bool(enabled)

    from app.services.alert_service import AlertPolicyService

    policy_svc = AlertPolicyService(session, workspace_id, audit)
    policy = policy_svc.get_or_create()
    if chat_id is not None:
        policy.telegram_chat_id = next_chat or None
    policy.enabled = next_enabled
    session.flush()

    meta_payload = {
        "enabled": next_enabled,
        "chat_id": next_chat,
        "telegram_bot_envelope": next_envelope,
        "telegram_bot_mask": next_mask,
        "bot_username": next_username[:80],
        "bot_name": next_bot_name[:120],
        "notify_ad_account_disabled": (
            cur["notify_ad_account_disabled"]
            if notify_ad_account_disabled is None
            else bool(notify_ad_account_disabled)
        ),
        "notify_billing_failed": (
            cur["notify_billing_failed"]
            if notify_billing_failed is None
            else bool(notify_billing_failed)
        ),
        "notify_page_restricted": (
            cur["notify_page_restricted"]
            if notify_page_restricted is None
            else bool(notify_page_restricted)
        ),
        "notify_retainer_overspend": (
            cur["notify_retainer_overspend"]
            if notify_retainer_overspend is None
            else bool(notify_retainer_overspend)
        ),
        "quiet_hours_respect": (
            cur["quiet_hours_respect"]
            if quiet_hours_respect is None
            else bool(quiet_hours_respect)
        ),
    }
    audit.record(
        action="workspace_telegram_config.updated",
        entity_type="workspace_telegram_config",
        entity_id=str(workspace_id),
        metadata=meta_payload,
    )
    session.flush()
    return serialize_workspace_telegram_config(session, workspace_id, settings)


def _tg_api_get(bot_token: str, method: str, api_base_url: str, timeout: int = 8) -> dict[str, Any]:
    url = f"{api_base_url.rstrip('/')}/bot{bot_token.strip()}/{method.lstrip('/')}"
    req = urllib.request.Request(url, method="GET")  # noqa: S310
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads((resp.read() or b"{}").decode("utf-8"))
            if isinstance(data, dict):
                return data
            return {"ok": False, "description": "Unexpected response format"}
    except urllib.error.HTTPError as exc:
        desc = f"HTTP {exc.code}"
        try:
            body = json.loads((exc.read() or b"{}").decode("utf-8"))
            if isinstance(body, dict) and body.get("description"):
                desc = str(body["description"])[:180]
        except Exception:
            pass
        return {"ok": False, "description": desc}
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return {"ok": False, "description": f"Network error ({type(exc).__name__})"}
    except Exception:
        return {"ok": False, "description": "Telegram API request failed"}


def verify_telegram_bot(
    bot_token: str,
    *,
    api_base_url: str = "https://api.telegram.org",
    timeout: int = 8,
) -> dict[str, Any]:
    clean = (bot_token or "").strip()
    if not validate_bot_token_format(clean):
        return {
            "ok": False,
            "error_summary": "Bot Token không đúng định dạng Telegram (VD: 123456789:ABCdef...).",
        }
    data = _tg_api_get(clean, "getMe", api_base_url, timeout=timeout)
    if data.get("ok") and isinstance(data.get("result"), dict):
        res = data["result"]
        return {
            "ok": True,
            "bot_username": str(res.get("username") or "").strip(),
            "bot_name": str(res.get("first_name") or "").strip(),
        }
    return {
        "ok": False,
        "error_summary": str(data.get("description") or "Bot Token không hợp lệ hoặc bị thu hồi."),
    }


def detect_recent_telegram_chats(
    bot_token: str,
    *,
    api_base_url: str = "https://api.telegram.org",
    timeout: int = 8,
) -> dict[str, Any]:
    clean = (bot_token or "").strip()
    if not validate_bot_token_format(clean):
        return {"ok": False, "chats": [], "error_summary": "Bot Token không hợp lệ."}
    data = _tg_api_get(clean, "getUpdates?limit=30", api_base_url, timeout=timeout)
    if not data.get("ok"):
        return {
            "ok": False,
            "chats": [],
            "error_summary": str(data.get("description") or "Không đọc được danh sách chat gần đây từ Telegram."),
        }
    seen: dict[str, dict[str, str]] = {}
    for upd in data.get("result") or []:
        if not isinstance(upd, dict):
            continue
        for key in ("message", "edited_message", "channel_post", "my_chat_member", "chat_member"):
            node = upd.get(key)
            if not isinstance(node, dict):
                continue
            chat = node.get("chat")
            if not isinstance(chat, dict) or chat.get("id") is None:
                continue
            cid = str(chat["id"])
            title = (
                str(chat.get("title") or "").strip()
                or f"{chat.get('first_name') or ''} {chat.get('last_name') or ''}".strip()
                or (f"@{chat.get('username')}" if chat.get("username") else cid)
            )
            seen[cid] = {
                "chat_id": cid,
                "title": title[:120],
                "type": str(chat.get("type") or "group"),
            }
    return {"ok": True, "chats": list(seen.values()), "error_summary": None}


def _recently_notified_keys(session: Session, workspace_id: uuid.UUID, since_dt: datetime) -> set[str]:
    rows = session.execute(
        sa.select(AuditLog.entity_id).where(
            AuditLog.workspace_id == workspace_id,
            AuditLog.entity_type == "telegram_ops_alert",
            AuditLog.action == "telegram_ops_alert.sent",
            AuditLog.created_at >= since_dt,
        )
    ).scalars().all()
    return {str(r) for r in rows}


def dispatch_operational_telegram_alerts(
    session: Session,
    workspace_id: uuid.UUID,
    audit: AuditLogService,
    settings,
) -> dict[str, Any]:
    """Scans workspace ad accounts, billing, pages, and retainer overspend; sends deduped Vietnamese Telegram alerts."""
    cfg = get_workspace_telegram_record(session, workspace_id)
    if not cfg.get("enabled", True):
        return {"sent": 0, "skipped_reason": "disabled"}

    chat_id = cfg.get("chat_id") or ""
    if not chat_id:
        return {"sent": 0, "skipped_reason": "no_chat_id"}

    transport = resolve_workspace_telegram_transport(session, workspace_id, settings)
    if transport is None:
        env_tok = (getattr(settings, "telegram_bot_token", "") or "").strip()
        if getattr(settings, "telegram_transport_configured", False) and env_tok:
            transport = TelegramTransport(
                bot_token=env_tok,
                api_base_url=getattr(settings, "telegram_api_base_url", "https://api.telegram.org"),
                timeout_seconds=int(getattr(settings, "telegram_timeout_seconds", 10)),
            )
    if transport is None:
        return {"sent": 0, "skipped_reason": "no_bot_token"}

    now = datetime.now(UTC)
    policy = session.execute(
        sa.select(AlertPolicy).where(AlertPolicy.workspace_id == workspace_id)
    ).scalar_one_or_none()
    in_quiet = False
    if cfg.get("quiet_hours_respect", True) and policy and policy.quiet_hours_enabled:
        in_quiet = quiet_hours.is_in_quiet_hours(policy, now)

    dedupe_since = now - timedelta(hours=24)
    already_sent = _recently_notified_keys(session, workspace_id, dedupe_since)

    findings: list[tuple[str, bool, str]] = []

    accounts = list(
        session.execute(
            sa.select(AdAccount).where(
                AdAccount.workspace_id == workspace_id,
                AdAccount.archived_at.is_(None),
            )
        ).scalars().all()
    )
    acc_by_id = {a.id: a for a in accounts}

    if cfg.get("notify_ad_account_disabled", True):
        for acc in accounts:
            if acc.status in (AccountStatus.DISABLED, AccountStatus.RESTRICTED):
                dk = f"acc:{acc.id}:{acc.status.value}"
                if dk not in already_sent:
                    st_vi = "Bị vô hiệu hóa (DIE)" if acc.status == AccountStatus.DISABLED else "Bị hạn chế (Restricted)"
                    ext_txt = f" ({acc.external_account_id})" if acc.external_account_id else ""
                    findings.append((dk, True, f"• TKQC {acc.display_name}{ext_txt}: {st_vi}"))

    if cfg.get("notify_billing_failed", True):
        bill_alerts = list(
            session.execute(
                sa.select(Alert).where(
                    Alert.workspace_id == workspace_id,
                    Alert.archived_at.is_(None),
                    Alert.status.in_(ACTIVE_ALERT_STATUSES),
                    Alert.severity == AlertSeverity.CRITICAL,
                )
            ).scalars().all()
        )
        for al in bill_alerts:
            txt_low = f"{al.title or ''} {al.summary or ''}".lower()
            if any(k in txt_low for k in ("unsettled", "billing", "payment", "hold", "dư nợ", "thẻ")):
                dk = f"billing:{al.id}"
                if dk not in already_sent:
                    acc_obj = acc_by_id.get(al.ad_account_id) if al.ad_account_id else None
                    prefix = f"TKQC {acc_obj.display_name}" if acc_obj else "Thanh toán"
                    findings.append((dk, True, f"• Lỗi thẻ/Dư nợ ({prefix}): {al.title[:90]}"))

    if cfg.get("notify_page_restricted", True):
        pages = list(
            session.execute(
                sa.select(Page).where(
                    Page.workspace_id == workspace_id,
                    Page.archived_at.is_(None),
                    Page.status == ReferenceStatus.RESTRICTED,
                )
            ).scalars().all()
        )
        for pg in pages:
            dk = f"page:{pg.id}:restricted"
            if dk not in already_sent:
                findings.append((dk, True, f"• Fanpage {pg.name}: Bị hạn chế quảng cáo"))

    if cfg.get("notify_retainer_overspend", True):
        try:
            from app.api.v1.routers.meta_operations import _build_retainers_overview

            ret_overview = _build_retainers_overview(session, workspace_id, audit)
            for item in ret_overview.get("items", []):
                committed = int(item.get("committed_budget_vnd") or 0)
                pct = float(item.get("pacing_percent") or 0.0)
                if committed > 0 and pct >= 90.0:
                    tier = "100" if pct >= 100.0 else "90"
                    dk = f"retainer:{item.get('id')}:{tier}:{item.get('billing_cycle') or ''}"
                    if dk not in already_sent:
                        findings.append(
                            (
                                dk,
                                pct >= 100.0,
                                f"• Hợp đồng {item.get('client_name')}: Chi tiêu đạt {pct:.1f}% ngân sách cam kết",
                            )
                        )
        except Exception:
            logger.exception("telegram_retainer_scan_failed")

    if not findings:
        return {"sent": 0, "skipped_reason": "no_new_incidents"}

    if in_quiet and not any(crit for _, crit, _ in findings):
        return {"sent": 0, "skipped_reason": "quiet_hours"}

    if in_quiet:
        findings = [f for f in findings if f[1]]

    public_url = resolve_workspace_public_url(session, workspace_id, settings)
    lines = [f"🚨 ADSOPS CẢNH BÁO VẬN HÀNH ({len(findings)} sự cố mới)", ""]
    for _, _, bullet in findings[:12]:
        lines.append(bullet)
    if len(findings) > 12:
        lines.append(f"... và {len(findings) - 12} cảnh báo khác.")
    lines.append("")
    lines.append(f"🔎 Kiểm tra ngay: {public_url}/alerts")
    msg_text = "\n".join(lines)

    res = transport.send(OutboundMessage(chat_id=chat_id, text=msg_text))
    if res.ok:
        for dk, crit, _ in findings:
            audit.record(
                action="telegram_ops_alert.sent",
                entity_type="telegram_ops_alert",
                entity_id=dk,
                metadata={"critical": crit},
            )
        session.flush()
        return {"sent": len(findings), "skipped_reason": None}
    return {"sent": 0, "skipped_reason": res.failure_summary or "send_failed"}
