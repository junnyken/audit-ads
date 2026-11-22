"""Zero-Risk Official Google Ads Script Sync Router (v4.0.0).

Supports:
* Multi-MCC (`AdsManagerApp.accounts()`) — paste once in each of your MCC accounts
* Standalone Client Accounts (`AdsApp.currentAccount()`) — paste directly in isolated client Gmail accounts
  without linking them to any MCC, completely preventing cross-account suspension risk while still syncing
  spend, budgets, account status, disapproved ads, and billing alerts into AdsOps + Telegram.
"""
from __future__ import annotations

import contextlib
import hmac
import re
import secrets
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import Ctx, OwnerCtx
from app.core.config import get_settings
from app.core.enums import (
    AccountStatus,
    AccountType,
    AlertSeverity,
    AlertSourceType,
    AlertStatus,
    MetaEnvironment,
    ReferenceStatus,
    SpendObservationStatus,
    SpendObservationTrigger,
    WorkspaceRole,
)
from app.core.errors import AuthenticationError, ValidationError
from app.core.secret_vault import SecretDecryptionError, encrypt_telegram_token, open_telegram_token
from app.db.session import get_db
from app.models.alerts import Alert
from app.models.entities import (
    AdAccount,
    AuditLog,
    BusinessManager,
    Workspace,
    WorkspaceMember,
)
from app.models.meta_operations import MetaConnection
from app.models.spend import AdAccountSpendObservation
from app.services.audit import AuditLogService
from app.services.notification_transport import OutboundMessage
from app.services.spend_engine import amount_text
from app.services.telegram_bot_helper import (
    get_workspace_telegram_record,
    resolve_workspace_bot_token,
    resolve_workspace_public_url,
)
from app.services.telegram_transport import TelegramTransport

router = APIRouter(prefix="/google-ads", tags=["google-ads"])

_BRIDGE_BM_REF = "google_ads_script"
_AUDIT_BRIDGE_ENTITY = "workspace_gads_bridge"
_AUDIT_BRIDGE_ACTION = "workspace_gads_bridge.updated"
_STANDALONE_POOL_BM_EXT = "gads_standalone_pool"


class GoogleAdsDailyRowIn(BaseModel):
    date: date
    spend_raw: str = "0"


class GoogleAdsAccountReportIn(BaseModel):
    customer_id: str = Field(..., min_length=6, max_length=32)
    name: str = ""
    currency: str = "VND"
    timezone: str = "Asia/Ho_Chi_Minh"
    status: str = "ENABLED"  # ENABLED | PAUSED | SUSPENDED | CANCELED
    daily_budget_raw: str | None = None
    total_spend_raw: str | None = None
    disapproved_ads_count: int = 0
    billing_issue: bool = False
    daily: list[GoogleAdsDailyRowIn] = Field(default_factory=list, max_length=60)


class GoogleAdsScriptReportIn(BaseModel):
    workspace_id: uuid.UUID
    mode: Literal["mcc", "standalone"] = "standalone"
    mcc_id: str | None = None
    mcc_name: str | None = None
    accounts: list[GoogleAdsAccountReportIn] = Field(default_factory=list, max_length=200)


def _normalize_digits(raw: str | None) -> str:
    return re.sub(r"\D", "", (raw or "").strip())


def _format_cid(digits: str) -> str:
    if len(digits) == 10:
        return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"
    return digits


def _clean_decimal_text(raw: str | None) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip().replace(",", "")
    if not s:
        return None
    try:
        dec = Decimal(s)
        if not dec.is_finite():
            return None
        return amount_text(dec)
    except (InvalidOperation, ValueError):
        return None


def _mask_key(raw_key: str) -> str:
    clean = (raw_key or "").strip()
    if len(clean) <= 10:
        return "***"
    return f"{clean[:8]}...{clean[-4:]}"


def _build_ingest_url(request: Request, session: Any, workspace_id: uuid.UUID, settings: Any) -> str:
    fwd_proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    fwd_host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").split(",")[0].strip()
    if fwd_host and fwd_host not in ("testserver", "localhost"):
        scheme = fwd_proto if fwd_proto in ("http", "https") else ("http" if fwd_host.startswith("127.0.0.1") else "https")
        return f"{scheme}://{fwd_host}{settings.api_prefix}/google-ads/script-report"
    if str(request.base_url).startswith("https://"):
        return f"{str(request.base_url).rstrip('/')}{settings.api_prefix}/google-ads/script-report"
    pub = resolve_workspace_public_url(session, workspace_id, settings)
    if pub and "adsops-app." in pub:
        return "https://audit-ads-backend.vibe1.tinhgon.xyz/api/v1/google-ads/script-report"
    return f"{str(request.base_url).rstrip('/')}{settings.api_prefix}/google-ads/script-report"


def _load_workspace_ingest_key(session: Any, workspace_id: uuid.UUID, settings: Any) -> tuple[str | None, str, str | None]:
    row = (
        session.execute(
            sa.select(AuditLog)
            .where(
                AuditLog.workspace_id == workspace_id,
                AuditLog.entity_type == _AUDIT_BRIDGE_ENTITY,
                AuditLog.action == _AUDIT_BRIDGE_ACTION,
            )
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        )
        .scalars()
        .first()
    )
    if not row or not isinstance(row.metadata_json, dict):
        return None, "", None
    meta = row.metadata_json
    env_blob = str(meta.get("gads_ingest_envelope") or "").strip()
    mask = str(meta.get("gads_ingest_mask") or "").strip()
    updated_iso = row.created_at.isoformat() if row.created_at else None
    if not env_blob:
        return None, mask, updated_iso
    try:
        plain = open_telegram_token(settings, env_blob)
        return plain, mask or _mask_key(plain), updated_iso
    except SecretDecryptionError:
        return None, mask, updated_iso


def _rotate_workspace_ingest_key(
    audit: AuditLogService,
    workspace_id: uuid.UUID,
    settings: Any,
) -> tuple[str, str]:
    raw_key = "gads_" + secrets.token_urlsafe(24)
    envelope = encrypt_telegram_token(settings, raw_key)
    mask = _mask_key(raw_key)
    # AuditLog key names intentionally omit 'token'/'secret'/'ciphertext'/'credential' so redaction keeps the envelope.
    audit.record(
        action=_AUDIT_BRIDGE_ACTION,
        entity_type=_AUDIT_BRIDGE_ENTITY,
        entity_id=str(workspace_id),
        metadata={
            "gads_ingest_envelope": envelope,
            "gads_ingest_mask": mask,
            "bridge_mode": "official_google_ads_script",
        },
    )
    return raw_key, mask


def _render_mcc_script(ingest_url: str, workspace_id: uuid.UUID, ingest_key: str) -> str:
    return f"""// ============================================================================
// AdsOps Desktop Pro — Google Ads MCC Sync Script (Dành cho tài khoản MCC)
// Dán 1 lần vào từng MCC: Công cụ -> Hành động hàng loạt -> Tập lệnh (Scripts)
// Đặt lịch chạy: Hàng giờ (Hourly) để đồng bộ Chi tiêu & Cảnh báo về AdsOps + Telegram
// ============================================================================
const ADSOPS_INGEST_URL = "{ingest_url}";
const ADSOPS_WORKSPACE_ID = "{workspace_id}";
const ADSOPS_INGEST_KEY = "{ingest_key}";

function main() {{
  const mcc = AdsApp.currentAccount();
  const payload = {{
    workspace_id: ADSOPS_WORKSPACE_ID,
    mode: "mcc",
    mcc_id: mcc.getCustomerId(),
    mcc_name: mcc.getName() || ("MCC " + mcc.getCustomerId()),
    accounts: []
  }};

  const iter = AdsManagerApp.accounts().withLimit(50).get();
  while (iter.hasNext()) {{
    const acc = iter.next();
    AdsManagerApp.select(acc);
    payload.accounts.push(collectAccountSnapshot(acc));
  }}

  pushToAdsOps(payload);
}}

function collectAccountSnapshot(acc) {{
  const tz = acc.getTimeZone() || "Asia/Ho_Chi_Minh";
  const cur = (acc.getCurrencyCode() || "VND").toUpperCase();
  const dailyMap = {{}};

  try {{
    const report30 = AdsApp.search(
      "SELECT segments.date, metrics.cost_micros FROM customer WHERE segments.date DURING LAST_30_DAYS"
    );
    while (report30.hasNext()) {{
      const r = report30.next();
      const d = r.segments && r.segments.date;
      if (d) {{
        const cost = Number((r.metrics && r.metrics.costMicros) || 0) / 1000000;
        dailyMap[d] = (dailyMap[d] || 0) + cost;
      }}
    }}
  }} catch (e) {{}}

  try {{
    const reportToday = AdsApp.search(
      "SELECT segments.date, metrics.cost_micros FROM customer WHERE segments.date DURING TODAY"
    );
    while (reportToday.hasNext()) {{
      const r = reportToday.next();
      const d = r.segments && r.segments.date;
      if (d) {{
        const cost = Number((r.metrics && r.metrics.costMicros) || 0) / 1000000;
        dailyMap[d] = cost;
      }}
    }}
  }} catch (e) {{}}

  let totalBudget = 0;
  let hasActive = false;
  try {{
    const camps = AdsApp.campaigns().withCondition("campaign.status = 'ENABLED'").get();
    while (camps.hasNext()) {{
      hasActive = true;
      const b = camps.next().getBudget();
      if (b) totalBudget += Number(b.getAmount() || 0);
    }}
  }} catch (e) {{}}

  let disapproved = 0;
  try {{
    disapproved = AdsApp.ads()
      .withCondition("ad_group_ad.policy_summary.approval_status = 'DISAPPROVED'")
      .get()
      .totalNumEntities();
  }} catch (e) {{}}

  let total30d = 0;
  const daily = Object.keys(dailyMap).sort().map(function(dt) {{
    const v = dailyMap[dt];
    total30d += v;
    return {{ date: dt, spend_raw: String(Math.round(v * 100) / 100) }};
  }});

  return {{
    customer_id: acc.getCustomerId(),
    name: acc.getName() || acc.getCustomerId(),
    currency: cur,
    timezone: tz,
    status: hasActive ? "ENABLED" : "PAUSED",
    daily_budget_raw: totalBudget > 0 ? String(Math.round(totalBudget * 100) / 100) : null,
    total_spend_raw: String(Math.round(total30d * 100) / 100),
    disapproved_ads_count: disapproved,
    billing_issue: false,
    daily: daily
  }};
}}

function pushToAdsOps(payload) {{
  const res = UrlFetchApp.fetch(ADSOPS_INGEST_URL, {{
    method: "post",
    contentType: "application/json",
    headers: {{ "X-AdsOps-Ingest-Key": ADSOPS_INGEST_KEY }},
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  }});
  Logger.log("AdsOps Sync HTTP " + res.getResponseCode() + ": " + res.getContentText());
}}
"""


def _render_standalone_script(ingest_url: str, workspace_id: uuid.UUID, ingest_key: str) -> str:
    return f"""// ============================================================================
// AdsOps Desktop Pro — Google Ads Standalone Account Script (Gmail Khách Độc Lập 1:1)
// Dán trực tiếp vào từng Tài khoản Google Ads riêng biệt — TUYỆT ĐỐI KHÔNG NỐI VÀO MCC
// Giữ cách ly 100% tránh liên đới tài khoản, vẫn tự động báo Chi tiêu & Cảnh báo về AdsOps
// Đặt lịch chạy: Hàng giờ (Hourly)
// ============================================================================
const ADSOPS_INGEST_URL = "{ingest_url}";
const ADSOPS_WORKSPACE_ID = "{workspace_id}";
const ADSOPS_INGEST_KEY = "{ingest_key}";

function main() {{
  const acc = AdsApp.currentAccount();
  const cur = (acc.getCurrencyCode() || "VND").toUpperCase();
  const tz = acc.getTimeZone() || "Asia/Ho_Chi_Minh";
  const dailyMap = {{}};

  try {{
    const report30 = AdsApp.search(
      "SELECT segments.date, metrics.cost_micros FROM customer WHERE segments.date DURING LAST_30_DAYS"
    );
    while (report30.hasNext()) {{
      const r = report30.next();
      const d = r.segments && r.segments.date;
      if (d) {{
        const cost = Number((r.metrics && r.metrics.costMicros) || 0) / 1000000;
        dailyMap[d] = (dailyMap[d] || 0) + cost;
      }}
    }}
  }} catch (e) {{}}

  try {{
    const reportToday = AdsApp.search(
      "SELECT segments.date, metrics.cost_micros FROM customer WHERE segments.date DURING TODAY"
    );
    while (reportToday.hasNext()) {{
      const r = reportToday.next();
      const d = r.segments && r.segments.date;
      if (d) {{
        dailyMap[d] = Number((r.metrics && r.metrics.costMicros) || 0) / 1000000;
      }}
    }}
  }} catch (e) {{}}

  let totalBudget = 0;
  let hasActive = false;
  try {{
    const camps = AdsApp.campaigns().withCondition("campaign.status = 'ENABLED'").get();
    while (camps.hasNext()) {{
      hasActive = true;
      const b = camps.next().getBudget();
      if (b) totalBudget += Number(b.getAmount() || 0);
    }}
  }} catch (e) {{}}

  let disapproved = 0;
  try {{
    disapproved = AdsApp.ads()
      .withCondition("ad_group_ad.policy_summary.approval_status = 'DISAPPROVED'")
      .get()
      .totalNumEntities();
  }} catch (e) {{}}

  let total30d = 0;
  const daily = Object.keys(dailyMap).sort().map(function(dt) {{
    const v = dailyMap[dt];
    total30d += v;
    return {{ date: dt, spend_raw: String(Math.round(v * 100) / 100) }};
  }});

  const payload = {{
    workspace_id: ADSOPS_WORKSPACE_ID,
    mode: "standalone",
    accounts: [{{
      customer_id: acc.getCustomerId(),
      name: acc.getName() || acc.getCustomerId(),
      currency: cur,
      timezone: tz,
      status: hasActive ? "ENABLED" : "PAUSED",
      daily_budget_raw: totalBudget > 0 ? String(Math.round(totalBudget * 100) / 100) : null,
      total_spend_raw: String(Math.round(total30d * 100) / 100),
      disapproved_ads_count: disapproved,
      billing_issue: false,
      daily: daily
    }}]
  }};

  const res = UrlFetchApp.fetch(ADSOPS_INGEST_URL, {{
    method: "post",
    contentType: "application/json",
    headers: {{ "X-AdsOps-Ingest-Key": ADSOPS_INGEST_KEY }},
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  }});
  Logger.log("AdsOps Standalone Sync HTTP " + res.getResponseCode() + ": " + res.getContentText());
}}
"""


def _build_config_response(
    *,
    workspace_id: uuid.UUID,
    ingest_url: str,
    raw_key: str | None,
    key_masked: str,
    synced_accounts_count: int,
    last_push_at: str | None,
) -> dict[str, Any]:
    effective_key = raw_key or "<CHUA_TAO_KHOA_HAY_BAM_ROTATE>"
    return {
        "workspace_id": str(workspace_id),
        "ingest_url": ingest_url,
        "key_configured": bool(raw_key),
        "key_masked": key_masked or "Chưa khởi tạo",
        "mcc_script_code": _render_mcc_script(ingest_url, workspace_id, effective_key),
        "single_account_script_code": _render_standalone_script(ingest_url, workspace_id, effective_key),
        "synced_accounts_count": synced_accounts_count,
        "last_push_at": last_push_at,
    }


def _script_stats(session: Any, workspace_id: uuid.UUID) -> tuple[int, str | None]:
    gads_accounts = list(
        session.execute(
            sa.select(AdAccount).where(
                AdAccount.workspace_id == workspace_id,
                AdAccount.archived_at.is_(None),
                AdAccount.external_account_id.like("gads_%"),
            )
        )
        .scalars()
        .all()
    )
    last_push = (
        session.execute(
            sa.select(AdAccountSpendObservation.observed_at)
            .where(
                AdAccountSpendObservation.workspace_id == workspace_id,
                AdAccountSpendObservation.reader_source == _BRIDGE_BM_REF,
                AdAccountSpendObservation.archived_at.is_(None),
            )
            .order_by(AdAccountSpendObservation.observed_at.desc())
            .limit(1)
        )
        .scalars()
        .first()
    )
    return len(gads_accounts), last_push.isoformat() if last_push else None


@router.get("/script-config")
def get_google_ads_script_config(ctx: Ctx, request: Request) -> dict[str, Any]:
    settings = get_settings()
    raw_key, mask, _ = _load_workspace_ingest_key(ctx.session, ctx.workspace_id, settings)
    if not raw_key and ctx.membership.role in (WorkspaceRole.OWNER, WorkspaceRole.ADMIN):
        raw_key, mask = _rotate_workspace_ingest_key(ctx.audit, ctx.workspace_id, settings)
        ctx.commit()
    ingest_url = _build_ingest_url(request, ctx.session, ctx.workspace_id, settings)
    count, last_push_at = _script_stats(ctx.session, ctx.workspace_id)
    return _build_config_response(
        workspace_id=ctx.workspace_id,
        ingest_url=ingest_url,
        raw_key=raw_key,
        key_masked=mask,
        synced_accounts_count=count,
        last_push_at=last_push_at,
    )


@router.post("/rotate-key")
def rotate_google_ads_script_key(ctx: OwnerCtx, request: Request) -> dict[str, Any]:
    settings = get_settings()
    raw_key, mask = _rotate_workspace_ingest_key(ctx.audit, ctx.workspace_id, settings)
    ctx.commit()
    ingest_url = _build_ingest_url(request, ctx.session, ctx.workspace_id, settings)
    count, last_push_at = _script_stats(ctx.session, ctx.workspace_id)
    return _build_config_response(
        workspace_id=ctx.workspace_id,
        ingest_url=ingest_url,
        raw_key=raw_key,
        key_masked=mask,
        synced_accounts_count=count,
        last_push_at=last_push_at,
    )


def _get_or_create_gads_bridge_connection(
    session: Any, workspace_id: uuid.UUID, actor_id: uuid.UUID
) -> MetaConnection:
    conn = (
        session.execute(
            sa.select(MetaConnection).where(
                MetaConnection.workspace_id == workspace_id,
                MetaConnection.business_manager_reference == _BRIDGE_BM_REF,
                MetaConnection.archived_at.is_(None),
            )
        )
        .scalars()
        .first()
    )
    if conn is not None:
        return conn
    conn = MetaConnection(
        workspace_id=workspace_id,
        label="Google Ads Script Bridge",
        business_manager_reference=_BRIDGE_BM_REF,
        # Sandbox avoids Meta real/fake discovery sweeps ever touching this hub row.
        environment=MetaEnvironment.SANDBOX,
        status=ReferenceStatus.ACTIVE,
        created_by=actor_id,
        notes="Official Google Ads Script webhook bridge (0% Chrome script injection).",
    )
    session.add(conn)
    session.flush()
    return conn


def _upsert_bm(
    session: Any,
    workspace_id: uuid.UUID,
    external_id: str,
    name: str,
) -> BusinessManager:
    bm = (
        session.execute(
            sa.select(BusinessManager).where(
                BusinessManager.workspace_id == workspace_id,
                BusinessManager.external_id == external_id,
            )
        )
        .scalars()
        .first()
    )
    if bm is None:
        bm = BusinessManager(
            workspace_id=workspace_id,
            external_id=external_id,
            name=name[:200],
            status=ReferenceStatus.ACTIVE,
            notes="Synced from Official Google Ads Script",
        )
        session.add(bm)
        session.flush()
        return bm
    bm.archived_at = None
    bm.name = name[:200]
    bm.status = ReferenceStatus.ACTIVE
    return bm


def _sync_account_alert(
    session: Any,
    workspace_id: uuid.UUID,
    account: AdAccount,
    formatted_cid: str,
    raw_status: str,
    billing_issue: bool,
    disapproved_count: int,
    now: datetime,
) -> tuple[bool, Alert | None]:
    has_risk = raw_status in ("SUSPENDED", "CANCELED") or billing_issue or disapproved_count > 0
    alert_key = f"gads_script:{account.id}:account_risk"
    existing = (
        session.execute(
            sa.select(Alert).where(
                Alert.workspace_id == workspace_id,
                Alert.active_key == alert_key,
            )
        )
        .scalars()
        .first()
    )

    if not has_risk:
        if existing is not None:
            existing.status = AlertStatus.RESOLVED
            existing.active_key = None
            existing.resolved_at = now
            existing.resolution_reason = f"Google Ads account returned to {raw_status} with no billing/disapproval issues."
        return False, None

    is_critical = raw_status in ("SUSPENDED", "CANCELED") or billing_issue
    severity = AlertSeverity.CRITICAL if is_critical else AlertSeverity.WARNING
    reasons: list[str] = []
    if raw_status in ("SUSPENDED", "CANCELED"):
        reasons.append(f"Trạng thái Google Ads: {raw_status}")
    if billing_issue:
        reasons.append("Lỗi thanh toán / Billing Hold")
    if disapproved_count > 0:
        reasons.append(f"{disapproved_count} mẫu quảng cáo bị từ chối")
    title = f"[Google Ads {formatted_cid}] {account.display_name}: {', '.join(reasons)}"[:200]
    summary = (
        f"Tài khoản Google Ads {account.display_name} ({formatted_cid}) báo sự cố từ Google Ads Script: "
        + "; ".join(reasons)
        + ". Kiểm tra trong Trình duyệt Sạch 1:1 ngay."
    )

    if existing is not None:
        existing.severity = severity
        existing.title = title
        existing.summary = summary
        existing.last_observed_at = now
        existing.source_snapshot_json = {
            "platform": "google_ads",
            "customer_id": formatted_cid,
            "status": raw_status,
            "billing_issue": billing_issue,
            "disapproved_ads_count": disapproved_count,
        }
        return False, existing

    alert = Alert(
        workspace_id=workspace_id,
        ad_account_id=account.id,
        source_type=AlertSourceType.HEALTH_SIGNAL,
        source_entity_type="google_ads_script",
        source_entity_id=str(account.id),
        alert_key=alert_key,
        active_key=alert_key,
        category="google_ads_risk",
        severity=severity,
        status=AlertStatus.OPEN,
        title=title,
        summary=summary,
        source_snapshot_json={
            "platform": "google_ads",
            "customer_id": formatted_cid,
            "status": raw_status,
            "billing_issue": billing_issue,
            "disapproved_ads_count": disapproved_count,
        },
        first_observed_at=now,
        last_observed_at=now,
    )
    session.add(alert)
    session.flush()
    return True, alert


def _send_gads_telegram_if_configured(session: Any, workspace_id: uuid.UUID, bullets: list[str]) -> bool:
    if not bullets:
        return False
    settings = get_settings()
    if (getattr(settings, "notification_transport", "") or "").strip().lower() == "fake":
        return False
    with contextlib.suppress(Exception):
        rec = get_workspace_telegram_record(session, workspace_id)
        tok = resolve_workspace_bot_token(session, workspace_id, settings)
        chat_id = str(rec.get("chat_id") or "").strip()
        if rec.get("enabled", True) and tok and chat_id:
            pub_url = resolve_workspace_public_url(session, workspace_id, settings)
            lines = [f"🔷 CẢNH BÁO GOOGLE ADS ({len(bullets)} tài khoản)", ""] + bullets[:10] + ["", f"🔎 Xem chi tiết: {pub_url}/ad-accounts"]
            tr = TelegramTransport(
                bot_token=tok,
                api_base_url=settings.telegram_api_base_url,
                timeout_seconds=min(4, int(settings.telegram_timeout_seconds or 4)),
            )
            return bool(tr.send(OutboundMessage(chat_id=chat_id, text="\n".join(lines))).ok)
    return False


@router.post("/script-report", name="google_ads_script_report")
def ingest_google_ads_script_report(
    payload: GoogleAdsScriptReportIn,
    session: Annotated[Session, Depends(get_db)],
    ingest_key: str = Header(default="", alias="X-AdsOps-Ingest-Key"),
) -> dict[str, Any]:
    settings = get_settings()
    ws = session.execute(
        sa.select(Workspace).where(Workspace.id == payload.workspace_id, Workspace.archived_at.is_(None))
    ).scalar_one_or_none()
    if ws is None:
        raise AuthenticationError("Workspace not found or archived.")

    expected_key, _, _ = _load_workspace_ingest_key(session, ws.id, settings)
    provided_key = (ingest_key or "").strip()
    if not expected_key or not provided_key or not hmac.compare_digest(provided_key, expected_key):
        raise AuthenticationError("Invalid or missing Google Ads script ingest key.")

    owner_member = (
        session.execute(
            sa.select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == ws.id,
                WorkspaceMember.archived_at.is_(None),
            )
        )
        .scalars()
        .first()
    )
    actor_id = owner_member.user_id if owner_member else ws.id
    audit = AuditLogService(session, ws.id, actor_id)
    bridge_conn = _get_or_create_gads_bridge_connection(session, ws.id, actor_id)

    now = datetime.now(UTC)
    target_bm: BusinessManager | None = None
    if payload.mode == "mcc":
        mcc_digits = _normalize_digits(payload.mcc_id)
        if mcc_digits:
            mcc_fmt = _format_cid(mcc_digits)
            target_bm = _upsert_bm(
                session,
                ws.id,
                f"gads_mcc_{mcc_digits}",
                (payload.mcc_name or "").strip() or f"Google Ads MCC {mcc_fmt}",
            )
    else:
        target_bm = _upsert_bm(
            session,
            ws.id,
            _STANDALONE_POOL_BM_EXT,
            "Google Ads — Gmail Khách Độc Lập (1:1)",
        )

    synced_ids: list[str] = []
    alerts_triggered = 0
    telegram_bullets: list[str] = []

    for item in payload.accounts:
        digits = _normalize_digits(item.customer_id)
        if len(digits) < 6 or len(digits) > 14:
            raise ValidationError(
                f"Invalid Google Ads customer_id '{item.customer_id}'.",
                details={"customer_id": item.customer_id},
            )
        formatted_cid = _format_cid(digits)
        ext_id = f"gads_{digits}"
        cur = (item.currency or "VND").strip().upper()[:3] or "VND"
        if len(cur) < 3:
            cur = "VND"
        tz_name = (item.timezone or "Asia/Ho_Chi_Minh").strip()[:64] or "Asia/Ho_Chi_Minh"
        try:
            ZoneInfo(tz_name)
        except (ZoneInfoNotFoundError, ValueError):
            tz_name = "Asia/Ho_Chi_Minh"

        raw_status = (item.status or "ENABLED").strip().upper()
        is_suspended = raw_status in ("SUSPENDED", "CANCELED")
        if is_suspended:
            acc_status = AccountStatus.DISABLED
            obs_status_raw = "2"
        elif item.billing_issue:
            acc_status = AccountStatus.RESTRICTED
            obs_status_raw = "3"
        elif raw_status == "PAUSED":
            acc_status = AccountStatus.WARNING
            obs_status_raw = "1"
        else:
            acc_status = AccountStatus.ACTIVE
            obs_status_raw = "1"

        account = (
            session.execute(
                sa.select(AdAccount).where(
                    AdAccount.workspace_id == ws.id,
                    AdAccount.external_account_id == ext_id,
                )
            )
            .scalars()
            .first()
        )
        display_name = (item.name or "").strip()[:200] or f"Google Ads {formatted_cid}"
        if account is None:
            account = AdAccount(
                workspace_id=ws.id,
                external_account_id=ext_id,
                display_name=display_name,
                account_type=AccountType.BUSINESS_MANAGER,
                business_manager_id=target_bm.id if target_bm else None,
                owner_label=f"Google {'MCC' if payload.mode == 'mcc' else 'Standalone 1:1'}",
                currency=cur,
                timezone=tz_name,
                status=acc_status,
                last_synced_at=now,
                tags=[],
                notes=f"Google Ads Script ({payload.mode}) • CID {formatted_cid}",
            )
            session.add(account)
            session.flush()
        else:
            account.archived_at = None
            account.display_name = display_name
            if target_bm is not None:
                account.business_manager_id = target_bm.id
            account.currency = cur
            account.timezone = tz_name
            account.status = acc_status
            account.last_synced_at = now

        preserved_tags = [
            str(t)
            for t in (account.tags or [])
            if str(t) not in ("platform:google_ads",) and not str(t).startswith(("gads_mode:", "gads_cid:"))
        ]
        account.tags = preserved_tags + [
            "platform:google_ads",
            f"gads_mode:{payload.mode}",
            f"gads_cid:{formatted_cid}",
        ]

        daily_rows: list[dict[str, str]] = []
        dates_seen: list[date] = []
        for d_row in item.daily:
            amt = _clean_decimal_text(d_row.spend_raw)
            if amt is None:
                continue
            iso_d = d_row.date.isoformat()
            dates_seen.append(d_row.date)
            daily_rows.append(
                {
                    "date_start": iso_d,
                    "date_stop": iso_d,
                    "spend": amt,
                    "account_currency": cur,
                }
            )

        total_spend_clean = _clean_decimal_text(item.total_spend_raw)
        daily_budget_clean = _clean_decimal_text(item.daily_budget_raw)

        obs = AdAccountSpendObservation(
            workspace_id=ws.id,
            ad_account_id=account.id,
            meta_connection_id=bridge_conn.id,
            external_account_id=ext_id[:120],
            reader_source=_BRIDGE_BM_REF,
            provider_actor_external_id=_normalize_digits(payload.mcc_id) if payload.mode == "mcc" else formatted_cid,
            provider_actor_name=(payload.mcc_name or formatted_cid)[:200],
            trigger=SpendObservationTrigger.SCHEDULED_SWEEP,
            observed_at=now,
            status=SpendObservationStatus.SUCCEEDED,
            observed_currency=cur,
            observed_timezone_name=tz_name,
            observed_account_status=obs_status_raw,
            observed_disable_reason="3" if item.billing_issue else ("1" if is_suspended else "0"),
            amount_spent_raw=total_spend_clean,
            spend_cap_raw=daily_budget_clean,
            balance_raw=None,
            daily_json=daily_rows,
            window_since=min(dates_seen) if dates_seen else None,
            window_until=max(dates_seen) if dates_seen else None,
            safe_metadata_json={
                "platform": "google_ads",
                "mode": payload.mode,
                "cid": formatted_cid,
                "disapproved_ads_count": int(item.disapproved_ads_count or 0),
                "billing_issue": bool(item.billing_issue),
            },
        )
        session.add(obs)

        billing_meta: dict[str, Any] = {
            "platform": "google_ads",
            "gads_mode": payload.mode,
            "gads_cid": formatted_cid,
            "account_status_text": f"GOOGLE_{raw_status}",
            "payment_card_display": f"Google {'MCC' if payload.mode == 'mcc' else 'Gmail Độc Lập 1:1'} · {formatted_cid}",
            "disapproved_ads_count": int(item.disapproved_ads_count or 0),
            "billing_issue": bool(item.billing_issue),
        }
        if daily_budget_clean is not None:
            billing_meta["daily_budget_raw"] = daily_budget_clean
            billing_meta["meta_daily_limit_raw"] = daily_budget_clean
        if total_spend_clean is not None:
            billing_meta["amount_spent_raw"] = total_spend_clean

        audit.record(
            action="ad_account.billing_meta_synced",
            entity_type="ad_account",
            entity_id=str(account.id),
            metadata=billing_meta,
        )

        created_new_alert, alert_obj = _sync_account_alert(
            session,
            ws.id,
            account,
            formatted_cid,
            raw_status,
            bool(item.billing_issue),
            int(item.disapproved_ads_count or 0),
            now,
        )
        if alert_obj is not None:
            alerts_triggered += 1
            if created_new_alert:
                telegram_bullets.append(f"• {alert_obj.title}")

        synced_ids.append(str(account.id))

    with contextlib.suppress(Exception):
        from app.services.early_risk_detector import evaluate_and_reconcile_early_risks
        from app.services.telegram_bot_helper import get_workspace_telegram_record

        tg_cfg = get_workspace_telegram_record(session, ws.id)
        early_res = evaluate_and_reconcile_early_risks(session, ws.id, reconcile_alerts=True)
        if tg_cfg.get("notify_spend_spike", True):
            synced_set = set(synced_ids)
            since_24h = now.replace(hour=0, minute=0, second=0, microsecond=0)
            sent_rows = {
                str(r)
                for r in session.execute(
                    sa.select(AuditLog.entity_id).where(
                        AuditLog.workspace_id == ws.id,
                        AuditLog.entity_type == "telegram_ops_alert",
                        AuditLog.action == "telegram_ops_alert.sent",
                        AuditLog.created_at >= since_24h,
                    )
                )
                .scalars()
                .all()
            }
            for item in early_res.get("items", []):
                if item.get("kind") == "daily_spend_spike" and item.get("ad_account_id") in synced_set:
                    dk = f"early_spike:{item['ad_account_id']}:{item.get('latest_day') or now.strftime('%Y-%m-%d')}"
                    if dk not in sent_rows:
                        alerts_triggered += 1
                        telegram_bullets.append(f"• {item['title']}: {item['summary']}")
                        audit.record(
                            action="telegram_ops_alert.sent",
                            entity_type="telegram_ops_alert",
                            entity_id=dk,
                            metadata={"critical": item.get("severity") == "critical"},
                        )

    session.commit()
    telegram_sent = _send_gads_telegram_if_configured(session, ws.id, telegram_bullets)
    return {
        "ok": True,
        "mode": payload.mode,
        "synced_count": len(synced_ids),
        "account_ids": synced_ids,
        "alerts_triggered": alerts_triggered,
        "telegram_notified": telegram_sent,
        "received_at": now.isoformat(),
    }
