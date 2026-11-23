"""Operational Automation APIs:
1. Instant Telegram Bot configuration, chat auto-discovery, and controlled test message
2. Background Auto-Cron (Meta sync + Telegram instant alert dispatch + 48h spaced Page warmup)
3. SSRF-safe Live Proxy Health Checker (single & batch)
4. Custom Domain & SEO Readiness configuration (with dynamic CORS unlock)
"""
from __future__ import annotations

import concurrent.futures
import contextlib
import re
import uuid
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

import sqlalchemy as sa
from fastapi import APIRouter

from app.api.deps import Ctx, OwnerCtx, WriteCtx
from app.core.config import get_settings
from app.core.errors import ValidationError
from app.core.secret_vault import SecretDecryptionError, open_ai_provider_key
from app.models.entities import AdAccount, AuditLog, Page, PersonalAccountReference, ProxyReference
from app.services.ai_policy_studio import (
    generate_studio_content,
    get_workspace_ai_record,
    issue_owner_guardrail_override,
    save_workspace_ai_config,
    scan_ad_policy_compliance,
    serialize_workspace_ai_config,
)
from app.services.ai_provider_transport import call_ai_provider_chat, normalize_model, normalize_provider
from app.services.automation_cron import (
    get_workspace_cron_status,
    run_workspace_automation_cycle,
    save_workspace_cron_config,
)
from app.services.early_risk_detector import build_workspace_operational_telemetry
from app.services.notification_transport import OutboundMessage
from app.services.proxy_health_transport import (
    check_proxy_live,
    evaluate_proxy_timezone_match,
    parse_proxy_spec,
)
from app.services.telegram_bot_helper import (
    detect_recent_telegram_chats,
    resolve_workspace_bot_token,
    resolve_workspace_public_url,
    save_workspace_telegram_config,
    serialize_workspace_telegram_config,
    validate_bot_token_format,
    verify_telegram_bot,
)
from app.services.telegram_transport import TelegramTransport

router = APIRouter(tags=["automation-ops"])

_DOMAIN_HOST_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$")


# ---- 1. Telegram Bot Instant Alerting ---------------------------------------------------


@router.get("/telegram-bot/config")
def get_telegram_bot_config(ctx: Ctx) -> dict[str, Any]:
    settings = get_settings()
    return serialize_workspace_telegram_config(ctx.session, ctx.workspace_id, settings)


@router.post("/telegram-bot/config")
def save_telegram_bot_settings(ctx: OwnerCtx, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    settings = get_settings()
    body = payload or {}
    raw_bot_token = str(body.get("bot_token") or "").strip()
    clear_bot_token = bool(body.get("clear_bot_token"))

    bot_username: str | None = None
    bot_name: str | None = None
    if raw_bot_token:
        ver = verify_telegram_bot(
            raw_bot_token,
            api_base_url=settings.telegram_api_base_url,
            timeout=settings.telegram_timeout_seconds,
        )
        if not ver.get("ok"):
            raise ValidationError(
                str(ver.get("error_summary") or "Bot Token Telegram không hợp lệ."),
                details={"field": "bot_token"},
            )
        bot_username = str(ver.get("bot_username") or "")
        bot_name = str(ver.get("bot_name") or "")

    raw_chat_id = body.get("chat_id")
    chat_id: str | None = None if raw_chat_id is None else str(raw_chat_id).strip()[:64]

    res = save_workspace_telegram_config(
        ctx.session,
        ctx.workspace_id,
        ctx.audit,
        settings,
        bot_token=raw_bot_token or None,
        clear_bot_token=clear_bot_token,
        chat_id=chat_id,
        enabled=body.get("enabled"),
        notify_ad_account_disabled=body.get("notify_ad_account_disabled"),
        notify_billing_failed=body.get("notify_billing_failed"),
        notify_page_restricted=body.get("notify_page_restricted"),
        notify_retainer_overspend=body.get("notify_retainer_overspend"),
        notify_threshold_80=body.get("notify_threshold_80"),
        notify_spend_spike=body.get("notify_spend_spike"),
        quiet_hours_respect=body.get("quiet_hours_respect"),
        bot_username=bot_username,
        bot_name=bot_name,
    )
    ctx.commit()
    return res


@router.post("/telegram-bot/detect-chat")
def detect_telegram_chats(ctx: OwnerCtx, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    settings = get_settings()
    body = payload or {}
    supplied = str(body.get("bot_token") or "").strip()
    if supplied and not validate_bot_token_format(supplied):
        raise ValidationError(
            "Bot Token không đúng định dạng (VD: 123456789:ABCdef...).",
            details={"field": "bot_token"},
        )
    tok = supplied or resolve_workspace_bot_token(ctx.session, ctx.workspace_id, settings)
    if not tok:
        raise ValidationError(
            "Vui lòng dán Bot Token vào ô bên trên rồi bấm Tự lấy ID nhóm Telegram.",
            details={"field": "bot_token"},
        )
    res = detect_recent_telegram_chats(
        tok,
        api_base_url=settings.telegram_api_base_url,
        timeout=settings.telegram_timeout_seconds,
    )
    if not res.get("ok"):
        raise ValidationError(str(res.get("error_summary") or "Không thể đọc tin nhắn từ Telegram Bot."))
    return {
        "chats": res.get("chats", []),
        "hint": (
            "Nếu danh sách trống, hãy mở nhóm Telegram chứa Bot, gõ lệnh /start hoặc 1 tin nhắn bất kỳ rồi bấm nút lấy lại."
            if not res.get("chats")
            else f"Tìm thấy {len(res['chats'])} cuộc trò chuyện gần đây."
        ),
    }


@router.post("/telegram-bot/test-send")
def send_telegram_test_message(ctx: OwnerCtx, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    settings = get_settings()
    body = payload or {}
    tok = str(body.get("bot_token") or "").strip() or resolve_workspace_bot_token(
        ctx.session, ctx.workspace_id, settings
    )
    if not tok:
        raise ValidationError("Chưa cấu hình Telegram Bot Token.")
    cfg = serialize_workspace_telegram_config(ctx.session, ctx.workspace_id, settings)
    from app.services.telegram_bot_helper import get_workspace_telegram_record

    rec = get_workspace_telegram_record(ctx.session, ctx.workspace_id)
    chat_id = str(body.get("chat_id") or "").strip() or rec.get("chat_id") or ""
    if not chat_id:
        raise ValidationError("Vui lòng nhập hoặc chọn Telegram Chat ID trước khi gửi thử.")

    acc_cnt = int(
        ctx.session.execute(
            sa.select(sa.func.count())
            .select_from(AdAccount)
            .where(AdAccount.workspace_id == ctx.workspace_id, AdAccount.archived_at.is_(None))
        ).scalar_one()
    )
    via_cnt = int(
        ctx.session.execute(
            sa.select(sa.func.count())
            .select_from(PersonalAccountReference)
            .where(
                PersonalAccountReference.workspace_id == ctx.workspace_id,
                PersonalAccountReference.archived_at.is_(None),
            )
        ).scalar_one()
    )
    page_cnt = int(
        ctx.session.execute(
            sa.select(sa.func.count())
            .select_from(Page)
            .where(Page.workspace_id == ctx.workspace_id, Page.archived_at.is_(None))
        ).scalar_one()
    )
    public_url = resolve_workspace_public_url(ctx.session, ctx.workspace_id, settings)
    text = "\n".join(
        [
            "✅ ADSOPS CONTROL CENTER — KẾT NỐI TELEGRAM THÀNH CÔNG",
            f"Workspace: {ctx.workspace.name}",
            f"Quy mô hiện tại: {acc_cnt} TKQC · {via_cnt} Via · {page_cnt} Fanpage",
            f"Trạng thái cảnh báo: {'Đang bật' if cfg.get('enabled') else 'Đang tạm tắt'}",
            f"Truy cập hệ thống: {public_url}/alerts",
        ]
    )
    transport = TelegramTransport(
        bot_token=tok,
        api_base_url=settings.telegram_api_base_url,
        timeout_seconds=settings.telegram_timeout_seconds,
    )
    res = transport.send(OutboundMessage(chat_id=chat_id, text=text))
    if not res.ok:
        raise ValidationError(res.failure_summary or "Không gửi được tin nhắn tới Telegram.")
    ctx.audit.record(
        action="workspace_telegram_config.test_sent",
        entity_type="workspace_telegram_config",
        entity_id=str(ctx.workspace_id),
        metadata={"ok": True, "provider_message_id": res.provider_message_id},
    )
    ctx.commit()
    return {"ok": True, "message": "Đã gửi tin nhắn kiểm tra tới Telegram thành công!"}


# ---- 2. Auto-Cron Sync & Spaced 48h Page Warmup ----------------------------------------


@router.get("/automation-cron/status")
def get_automation_cron_status(ctx: Ctx) -> dict[str, Any]:
    return get_workspace_cron_status(ctx.session, ctx.workspace_id)


@router.post("/automation-cron/config")
def save_automation_cron_settings(ctx: OwnerCtx, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = payload or {}
    out = save_workspace_cron_config(
        ctx.session,
        ctx.workspace_id,
        ctx.audit,
        auto_meta_sync_enabled=body.get("auto_meta_sync_enabled"),
        sync_interval_minutes=body.get("sync_interval_minutes"),
        auto_page_warmup_enabled=body.get("auto_page_warmup_enabled"),
        warmup_min_gap_hours=body.get("warmup_min_gap_hours"),
    )
    ctx.commit()
    return out


@router.post("/automation-cron/run-now")
def trigger_automation_cron_now(ctx: WriteCtx, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = payload or {}
    summary = run_workspace_automation_cycle(
        ctx.session,
        ctx.workspace_id,
        ctx.user.id,
        force_sync=bool(body.get("sync", True)),
        force_warmup=bool(body.get("warmup", True)),
    )
    ctx.commit()
    return {"run_summary": summary, "status": get_workspace_cron_status(ctx.session, ctx.workspace_id)}


# ---- 3. Live Proxy Health Checker -------------------------------------------------------


def _build_proxy_health_map(session, workspace_id: uuid.UUID) -> dict[str, dict[str, Any]]:
    rows = (
        session.execute(
            sa.select(AuditLog)
            .where(
                AuditLog.workspace_id == workspace_id,
                AuditLog.entity_type == "proxy_health_check",
                AuditLog.action == "proxy.health_checked",
            )
            .order_by(AuditLog.created_at.asc(), AuditLog.id.asc())
        )
        .scalars()
        .all()
    )
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        meta = dict(r.metadata_json or {}) if isinstance(r.metadata_json, dict) else {}
        key = str(meta.get("normalized_key") or r.entity_id or "").strip()
        if key:
            out[key] = meta
    return out


@router.get("/proxies/health-map")
def get_proxy_health_map(ctx: Ctx) -> dict[str, Any]:
    return {"health_map": _build_proxy_health_map(ctx.session, ctx.workspace_id)}


@router.post("/proxies/check-live")
def check_single_proxy_live(ctx: WriteCtx, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = payload or {}
    proxy_str = str(body.get("proxy_string") or "").strip()
    if not proxy_str:
        raise ValidationError("Vui lòng nhập chuỗi Proxy trước khi kiểm tra.")
    try:
        timeout_sec = max(2.0, min(8.0, float(body.get("timeout_seconds") or 4.5)))
    except Exception:
        timeout_sec = 4.5
    via_label = str(body.get("via_label") or "").strip()[:120]
    expected_tz = str(body.get("expected_timezone") or "").strip()[:64] or None
    notify_on_dead = bool(body.get("notify_on_dead"))

    res = check_proxy_live(proxy_str, timeout_seconds=timeout_sec)
    if not expected_tz and res.get("normalized_key"):
        norm_key = str(res["normalized_key"])
        vias = list(
            ctx.session.execute(
                sa.select(PersonalAccountReference).where(
                    PersonalAccountReference.workspace_id == ctx.workspace_id,
                    PersonalAccountReference.archived_at.is_(None),
                )
            ).scalars().all()
        )
        for v in vias:
            vspec = parse_proxy_spec(v.network_label)
            if vspec and vspec["normalized_key"] == norm_key and v.timezone:
                expected_tz = v.timezone.strip()
                break
    tz_match, tz_warn = evaluate_proxy_timezone_match(
        res.get("timezone"), res.get("country_code"), expected_tz
    )
    res["expected_timezone"] = expected_tz
    res["timezone_match"] = tz_match
    res["timezone_warning"] = tz_warn
    if res.get("normalized_key") and not res.get("ssrf_blocked") and res.get("status") in ("LIVE", "DEAD"):
        ctx.audit.record(
            action="proxy.health_checked",
            entity_type="proxy_health_check",
            entity_id=str(res["normalized_key"]),
            metadata=res,
        )
        ctx.commit()

    if notify_on_dead and res.get("status") != "LIVE":
        res["telegram_notified"] = False
        with contextlib.suppress(Exception):
            settings = get_settings()
            from app.services.telegram_bot_helper import get_workspace_telegram_record

            rec = get_workspace_telegram_record(ctx.session, ctx.workspace_id)
            tok = resolve_workspace_bot_token(ctx.session, ctx.workspace_id, settings)
            chat_id = str(rec.get("chat_id") or "").strip()
            if rec.get("enabled") and tok and chat_id:
                alert_text = "\n".join(
                    [
                        "⚠️ CẢNH BÁO PROXY VIA CHẾT TRƯỚC KHI MỞ CHROME",
                        f"Via: {via_label or 'Chưa rõ'}",
                        f"Proxy: {res.get('normalized_key') or proxy_str}",
                        f"Trạng thái: {res.get('status') or 'DEAD'}",
                        f"Chi tiết: {res.get('message') or 'Proxy không phản hồi'}",
                        "👉 Auto-Runner đã tự động bỏ qua Via này để bảo vệ IP.",
                    ]
                )
                tr_tg = TelegramTransport(
                    bot_token=tok,
                    api_base_url=settings.telegram_api_base_url,
                    timeout_seconds=min(4, int(settings.telegram_timeout_seconds or 4)),
                )
                tg_res = tr_tg.send(OutboundMessage(chat_id=chat_id, text=alert_text))
                res["telegram_notified"] = bool(tg_res.ok)
    return res


@router.post("/proxies/check-batch")
def check_all_workspace_proxies_live(ctx: WriteCtx) -> dict[str, Any]:
    vias = list(
        ctx.session.execute(
            sa.select(PersonalAccountReference).where(
                PersonalAccountReference.workspace_id == ctx.workspace_id,
                PersonalAccountReference.archived_at.is_(None),
            )
        ).scalars().all()
    )
    refs = list(
        ctx.session.execute(
            sa.select(ProxyReference).where(
                ProxyReference.workspace_id == ctx.workspace_id,
                ProxyReference.archived_at.is_(None),
            )
        ).scalars().all()
    )

    by_norm: dict[str, str] = {}
    tz_by_norm: dict[str, str] = {}
    for v in vias:
        spec = parse_proxy_spec(v.network_label)
        if spec:
            nk = spec["normalized_key"]
            if nk not in by_norm:
                by_norm[nk] = v.network_label.strip()
            if nk not in tz_by_norm and v.timezone:
                tz_by_norm[nk] = v.timezone.strip()
    for p in refs:
        cand = str(p.host_label or p.reference_code or "").strip()
        spec = parse_proxy_spec(cand)
        if spec and spec["normalized_key"] not in by_norm:
            by_norm[spec["normalized_key"]] = cand

    targets = list(by_norm.values())[:20]
    if not targets:
        return {
            "checked_count": 0,
            "live_count": 0,
            "dead_count": 0,
            "results": [],
            "health_map": _build_proxy_health_map(ctx.session, ctx.workspace_id),
        }

    results: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(5, len(targets))) as pool:
        futures = [pool.submit(check_proxy_live, raw, 6.0) for raw in targets]
        for fut in concurrent.futures.as_completed(futures):
            with __import__("contextlib").suppress(Exception):
                results.append(fut.result())

    live_count = 0
    dead_count = 0
    for res in results:
        nk = str(res.get("normalized_key") or "")
        expected_tz = tz_by_norm.get(nk) if nk else None
        tz_match, tz_warn = evaluate_proxy_timezone_match(
            res.get("timezone"), res.get("country_code"), expected_tz
        )
        res["expected_timezone"] = expected_tz
        res["timezone_match"] = tz_match
        res["timezone_warning"] = tz_warn
        if res.get("status") == "LIVE":
            live_count += 1
        elif res.get("status") == "DEAD":
            dead_count += 1
        if nk and not res.get("ssrf_blocked") and res.get("status") in ("LIVE", "DEAD"):
            ctx.audit.record(
                action="proxy.health_checked",
                entity_type="proxy_health_check",
                entity_id=nk,
                metadata=res,
            )
    ctx.commit()
    return {
        "checked_count": len(results),
        "live_count": live_count,
        "dead_count": dead_count,
        "results": results,
        "health_map": _build_proxy_health_map(ctx.session, ctx.workspace_id),
    }


# ---- 4. Custom Domain & SEO Readiness ---------------------------------------------------


def _get_saved_custom_domain(session, workspace_id: uuid.UUID) -> tuple[str, str | None, bool]:
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
        return (
            str(row.metadata_json.get("custom_domain") or "").strip(),
            row.created_at.isoformat() if row.created_at else None,
            bool(row.metadata_json.get("cors_trusted") is True),
        )
    return "", None, False


def _is_valid_public_custom_domain_host(host: str, public_app_url: str) -> bool:
    import ipaddress

    if not host or host in ("localhost", "127.0.0.1") or not _DOMAIN_HOST_RE.match(host):
        return False
    try:
        ipaddress.ip_address(host.strip("[]"))
        return False
    except ValueError:
        pass
    if "." not in host or host.endswith((".local", ".internal", ".localhost")):
        return False
    api_host = (urlparse(public_app_url or "").hostname or "").lower()
    if api_host and host == api_host:
        return True
    return True


@router.get("/domain-seo/config")
def get_domain_seo_config(ctx: Ctx) -> dict[str, Any]:
    settings = get_settings()
    custom_domain, updated_at, cors_trusted = _get_saved_custom_domain(ctx.session, ctx.workspace_id)
    effective_url = custom_domain or (settings.public_app_url or "https://adsops-app.vibe.tinhgon.xyz").rstrip("/")
    return {
        "custom_domain": custom_domain,
        "cors_trusted": cors_trusted,
        "effective_public_url": effective_url,
        "default_env_cors_count": len(settings.cors_origins),
        "updated_at": updated_at,
        "seo_checklist": [
            {"key": "og_banner", "label": "Ảnh chia sẻ Zalo / Facebook 1200x630 (/og-banner.png)", "ready": True},
            {"key": "sitemap_robots", "label": "Sitemap.xml & Robots.txt tự nhận diện tên miền mới", "ready": True},
            {
                "key": "dynamic_cors",
                "label": "Mở khóa CORS an toàn cho tên miền đã xác thực",
                "ready": bool(cors_trusted or not custom_domain),
            },
            {"key": "gzip_cache", "label": "Nén Gzip + Cache tài sản tĩnh 1 năm + Code Splitting", "ready": True},
        ],
    }


@router.post("/domain-seo/config")
def save_domain_seo_config(ctx: OwnerCtx, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    from app.core.email_and_bot_guard import is_bootstrap_owner_workspace
    from app.services.community_quota import is_user_platform_admin

    settings = get_settings()
    body = payload or {}
    raw = str(body.get("custom_domain") or "").strip().rstrip("/")
    normalized = ""
    if raw:
        cand = raw if "://" in raw else f"https://{raw}"
        parsed = urlparse(cand)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or not _is_valid_public_custom_domain_host(host, settings.public_app_url):
            raise ValidationError(
                "Tên miền phải là địa chỉ HTTPS hợp lệ (VD: https://app.thuonghieu.vn).",
                details={"field": "custom_domain"},
            )
        port_part = f":{parsed.port}" if parsed.port and parsed.port != 443 else ""
        normalized = f"https://{host}{port_part}"

    cors_trusted = bool(
        normalized
        and (
            is_user_platform_admin(ctx.user, settings)
            or is_bootstrap_owner_workspace(ctx.session, ctx.workspace_id)
        )
    )

    ctx.audit.record(
        action="workspace_domain_seo.updated",
        entity_type="workspace_domain_seo",
        entity_id=str(ctx.workspace_id),
        metadata={
            "custom_domain": normalized,
            "cors_trusted": cors_trusted,
            "updated_at": datetime.now(UTC).isoformat(),
        },
    )
    ctx.commit()

    from app.main import invalidate_custom_domain_cache

    invalidate_custom_domain_cache()
    return get_domain_seo_config(ctx)


@router.get("/automation/operational-telemetry")
def get_operational_telemetry(ctx: Ctx) -> dict[str, Any]:
    return build_workspace_operational_telemetry(ctx.session, ctx.workspace_id)


# ---- 5. Hybrid AI Policy & Content Studio + Audited Via Role Guardrail ------------------


@router.get("/ai-studio/config")
def get_ai_studio_config(ctx: Ctx) -> dict[str, Any]:
    return serialize_workspace_ai_config(ctx.session, ctx.workspace_id)


@router.post("/ai-studio/config")
def save_ai_studio_config_route(ctx: OwnerCtx, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = payload or {}
    settings = get_settings()
    raw_provider = body.get("provider")
    raw_model = body.get("model")
    raw_enabled = body.get("enabled")
    raw_key = body.get("provider_key")
    clear_key = bool(body.get("clear_key"))

    try:
        res = save_workspace_ai_config(
            ctx.session,
            ctx.workspace_id,
            ctx.audit,
            settings,
            provider=None if raw_provider is None else str(raw_provider),
            model=None if raw_model is None else str(raw_model),
            enabled=None if raw_enabled is None else bool(raw_enabled),
            provider_key=None if raw_key is None else str(raw_key),
            clear_key=clear_key,
        )
    except ValueError as exc:
        raise ValidationError(str(exc), details={"field": "provider_key"}) from exc

    ctx.commit()
    return res


@router.post("/ai-studio/test")
def test_ai_studio_connection(ctx: OwnerCtx, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = payload or {}
    settings = get_settings()
    rec = get_workspace_ai_record(ctx.session, ctx.workspace_id)
    provider = normalize_provider(str(body.get("provider") or rec["provider"]))
    model = normalize_model(provider, str(body.get("model") or rec["model"]))

    plain_key = str(body.get("provider_key") or "").strip()
    if not plain_key and rec["ai_envelope"]:
        try:
            plain_key = open_ai_provider_key(settings, rec["ai_envelope"])
        except SecretDecryptionError:
            plain_key = ""

    if not plain_key:
        raise ValidationError(
            "Chưa có API Key để kiểm tra kết nối AI Studio.",
            details={"field": "provider_key"},
        )

    probe = call_ai_provider_chat(
        provider=provider,
        model=model,
        provider_key=plain_key,
        system_prompt="Trả lời đúng 1 câu ngắn gọn bằng tiếng Việt.",
        user_prompt="Xác nhận kết nối AdsOps AI Studio hoạt động bình thường.",
        max_output_tokens=80,
        timeout=15.0,
    )
    if not probe.get("ok"):
        raise ValidationError(
            str(probe.get("error_summary") or "Không thể kết nối tới nhà cung cấp AI."),
            details={"provider": provider, "model": model},
        )
    return {
        "ok": True,
        "provider": provider,
        "model": model,
        "reply_preview": str(probe.get("text") or "")[:180],
    }


@router.post("/ai-studio/policy-check")
def check_ad_policy_compliance_route(ctx: Ctx, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    from app.services.ip_shield import check_anti_harvesting_velocity, enforce_daily_ip_quota

    settings = get_settings()
    check_anti_harvesting_velocity(
        ctx.session,
        workspace_id=ctx.workspace_id,
        user_id=ctx.actor_id,
        bucket_name="policy_check",
        settings=settings,
    )
    enforce_daily_ip_quota(
        ctx.session,
        workspace=ctx.workspace,
        user=ctx.user,
        action_key="policy_scan",
        settings=settings,
        record_scan=True,
    )
    ctx.commit()
    body = payload or {}
    text = str(body.get("text") or "")
    headline = str(body.get("headline") or "")
    mode = str(body.get("mode") or "ad_copy").strip().lower()
    if mode not in ("ad_copy", "page_warmup"):
        mode = "ad_copy"
    is_new_page = bool(body.get("is_new_page", False))
    return scan_ad_policy_compliance(
        text,
        headline=headline,
        mode=mode,
        is_new_page=is_new_page,
    )


@router.post("/ai-studio/generate")
def generate_ai_studio_content_route(ctx: WriteCtx, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = payload or {}
    settings = get_settings()
    task = str(body.get("task") or "rewrite_safe")
    text = str(body.get("text") or "")
    headline = str(body.get("headline") or "")
    page_name = str(body.get("page_name") or "")
    category = str(body.get("category") or "")
    mode = str(body.get("mode") or ("page_warmup" if task == "page_warmup" else "ad_copy")).strip().lower()
    if mode not in ("ad_copy", "page_warmup"):
        mode = "ad_copy"
    tone = str(body.get("tone") or "professional_natural").strip()[:64]

    if task == "rewrite_safe" and not text.strip():
        raise ValidationError("Vui lòng nhập nội dung bài viết cần kiểm duyệt & sửa.", details={"field": "text"})

    return generate_studio_content(
        ctx.session,
        ctx.workspace_id,
        settings,
        task=task,
        text=text,
        headline=headline,
        page_name=page_name,
        category=category,
        mode=mode,
        tone=tone,
    )


@router.post("/via-guardrail/override")
def issue_via_guardrail_override_route(ctx: OwnerCtx, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = payload or {}
    settings = get_settings()
    via_id = str(body.get("via_id") or "").strip()[:80]
    via_label = str(body.get("via_label") or "").strip()[:120]
    via_tier = str(body.get("via_tier") or "vault").strip().lower()
    target_scope = str(body.get("target_scope") or "ads_manager_campaign").strip()[:64]
    reason = str(body.get("reason") or "").strip()

    if via_tier not in ("vault", "72h_lock"):
        raise ValidationError("Loại bảo vệ Via không hợp lệ.", details={"field": "via_tier"})
    if len(reason) < 4:
        raise ValidationError(
            "Owner bắt buộc nhập lý do mở khóa ngoại lệ (tối thiểu 4 ký tự).",
            details={"field": "reason"},
        )

    res = issue_owner_guardrail_override(
        ctx.session,
        ctx.workspace_id,
        ctx.actor_id,
        ctx.audit,
        settings,
        via_id=via_id,
        via_label=via_label,
        via_tier=via_tier,
        target_scope=target_scope,
        reason=reason,
    )
    ctx.commit()
    return res
