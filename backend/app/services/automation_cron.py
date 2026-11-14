"""Scheduled background automation for Meta sync, instant Telegram alerts, and spaced 48h Page warmup.

Runs under PostgreSQL transaction-safe advisory lock (`pg_try_advisory_lock(88442211)`) so multiple
workers never duplicate a sync or feed post, and skips cleanly if no Meta credentials exist yet.
"""
from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.entities import AuditLog, Page, Workspace, WorkspaceMember
from app.services.audit import AuditLogService
from app.services.notification_service import NotificationDispatcherService
from app.services.telegram_bot_helper import dispatch_operational_telegram_alerts

logger = logging.getLogger(__name__)

CRON_ADVISORY_LOCK_KEY = 88442211


def get_workspace_cron_config(session: Session, workspace_id: uuid.UUID) -> dict[str, Any]:
    row = (
        session.execute(
            sa.select(AuditLog)
            .where(
                AuditLog.workspace_id == workspace_id,
                AuditLog.entity_type == "workspace_automation_cron",
                AuditLog.action == "workspace_automation_cron.updated",
            )
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        )
        .scalars()
        .first()
    )
    meta = dict(row.metadata_json or {}) if row and isinstance(row.metadata_json, dict) else {}
    try:
        sync_min = int(meta.get("sync_interval_minutes") or 60)
    except Exception:
        sync_min = 60
    try:
        gap_hrs = int(meta.get("warmup_min_gap_hours") or 8)
    except Exception:
        gap_hrs = 8
    return {
        "auto_meta_sync_enabled": bool(meta.get("auto_meta_sync_enabled", True)),
        "sync_interval_minutes": max(15, min(720, sync_min)),
        "auto_page_warmup_enabled": bool(meta.get("auto_page_warmup_enabled", True)),
        "warmup_min_gap_hours": max(4, min(24, gap_hrs)),
        "updated_at": row.created_at.isoformat() if row and row.created_at else None,
    }


def save_workspace_cron_config(
    session: Session,
    workspace_id: uuid.UUID,
    audit: AuditLogService,
    *,
    auto_meta_sync_enabled: bool | None = None,
    sync_interval_minutes: int | None = None,
    auto_page_warmup_enabled: bool | None = None,
    warmup_min_gap_hours: int | None = None,
) -> dict[str, Any]:
    cur = get_workspace_cron_config(session, workspace_id)
    next_cfg = {
        "auto_meta_sync_enabled": (
            cur["auto_meta_sync_enabled"]
            if auto_meta_sync_enabled is None
            else bool(auto_meta_sync_enabled)
        ),
        "sync_interval_minutes": (
            cur["sync_interval_minutes"]
            if sync_interval_minutes is None
            else max(15, min(720, int(sync_interval_minutes)))
        ),
        "auto_page_warmup_enabled": (
            cur["auto_page_warmup_enabled"]
            if auto_page_warmup_enabled is None
            else bool(auto_page_warmup_enabled)
        ),
        "warmup_min_gap_hours": (
            cur["warmup_min_gap_hours"]
            if warmup_min_gap_hours is None
            else max(4, min(24, int(warmup_min_gap_hours)))
        ),
    }
    audit.record(
        action="workspace_automation_cron.updated",
        entity_type="workspace_automation_cron",
        entity_id=str(workspace_id),
        metadata=next_cfg,
    )
    session.flush()
    return get_workspace_cron_status(session, workspace_id)


def _latest_cron_run_row(session: Session, workspace_id: uuid.UUID) -> AuditLog | None:
    return (
        session.execute(
            sa.select(AuditLog)
            .where(
                AuditLog.workspace_id == workspace_id,
                AuditLog.entity_type == "workspace_automation_run",
                AuditLog.action == "workspace_automation_cron.executed",
            )
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        )
        .scalars()
        .first()
    )


def _last_sync_timestamp(session: Session, workspace_id: uuid.UUID) -> datetime | None:
    row = (
        session.execute(
            sa.select(AuditLog)
            .where(
                AuditLog.workspace_id == workspace_id,
                AuditLog.entity_type == "workspace_automation_run",
                AuditLog.action == "workspace_automation_cron.executed",
            )
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
            .limit(10)
        )
        .scalars()
        .all()
    )
    for r in row:
        m = r.metadata_json if isinstance(r.metadata_json, dict) else {}
        if m.get("sync_executed"):
            ts = r.created_at
            return ts.replace(tzinfo=UTC) if ts and ts.tzinfo is None else ts
    return None


def get_workspace_cron_status(session: Session, workspace_id: uuid.UUID) -> dict[str, Any]:
    cfg = get_workspace_cron_config(session, workspace_id)
    last_row = _latest_cron_run_row(session, workspace_id)
    last_sync_dt = _last_sync_timestamp(session, workspace_id)
    next_sync_at: str | None = None
    if cfg["auto_meta_sync_enabled"]:
        if last_sync_dt:
            next_sync_at = (last_sync_dt + timedelta(minutes=cfg["sync_interval_minutes"])).isoformat()
        else:
            next_sync_at = (datetime.now(UTC) + timedelta(minutes=3)).isoformat()
    last_summary = dict(last_row.metadata_json or {}) if last_row and isinstance(last_row.metadata_json, dict) else {}
    return {
        **cfg,
        "last_run_at": last_row.created_at.isoformat() if last_row and last_row.created_at else None,
        "last_sync_at": last_sync_dt.isoformat() if last_sync_dt else None,
        "next_sync_at": next_sync_at,
        "last_run_summary": last_summary or None,
    }


def run_workspace_automation_cycle(
    session: Session,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID | None,
    *,
    force_sync: bool = False,
    force_warmup: bool = False,
) -> dict[str, Any]:
    from app.api.v1.routers.meta_operations import (
        _build_pages_summary,
        _collect_workspace_meta_transports,
        _infer_niche_key_from_category,
        _resolve_page_access_token_via_transports,
        _spin_via_page_copy,
        _sync_workspace_pages_from_meta,
        run_workspace_quick_sync,
    )
    from app.services.meta_graph_transport import publish_page_feed_post

    settings = get_settings()
    audit = AuditLogService(session, workspace_id, actor_id)
    cfg = get_workspace_cron_config(session, workspace_id)
    now = datetime.now(UTC)

    outbox_res = NotificationDispatcherService(session, workspace_id, audit).dispatch_due()

    sync_executed = False
    sync_status = "not_due"
    last_sync_dt = _last_sync_timestamp(session, workspace_id)
    sync_due = force_sync or (
        cfg["auto_meta_sync_enabled"]
        and (
            last_sync_dt is None
            or (now - last_sync_dt) >= timedelta(minutes=cfg["sync_interval_minutes"])
        )
    )

    transports = _collect_workspace_meta_transports(session, workspace_id)
    if sync_due:
        sync_executed = True
        if not transports:
            sync_status = "skipped_no_token"
        else:
            synced_parts: list[str] = []
            try:
                _sync_workspace_pages_from_meta(session, workspace_id, audit, actor_id=actor_id)
                synced_parts.append("pages")
            except Exception as exc:
                logger.warning("auto_cron_pages_sync_error", extra={"err": type(exc).__name__})
            try:
                if actor_id is not None:
                    run_workspace_quick_sync(session, workspace_id, actor_id)
                    synced_parts.append("accounts")
            except Exception as exc:
                logger.warning("auto_cron_accounts_sync_error", extra={"err": type(exc).__name__})
            sync_status = "ok:" + "+".join(synced_parts) if synced_parts else "error"

    tg_alert_res = dispatch_operational_telegram_alerts(session, workspace_id, audit, settings)

    auto_warmed_count = 0
    if (force_warmup or cfg["auto_page_warmup_enabled"]) and transports:
        pages_summary = _build_pages_summary(session, workspace_id, include_archived=False)
        gap_delta = timedelta(hours=cfg["warmup_min_gap_hours"])
        for idx, item in enumerate(pages_summary.get("items", [])):
            if auto_warmed_count >= 10:
                break
            if item.get("health_status") != "LIVE":
                continue
            ext_pid = str(item.get("external_page_id") or "").strip()
            if not ext_pid:
                continue
            posts_cnt = int(item.get("warmup_posts_count") or 0)
            if posts_cnt >= 3:
                continue

            if posts_cnt >= 1 and not force_warmup:
                last_w_raw = item.get("last_warmup_at")
                if last_w_raw:
                    try:
                        last_w_dt = datetime.fromisoformat(str(last_w_raw).replace("Z", "+00:00"))
                        if last_w_dt.tzinfo is None:
                            last_w_dt = last_w_dt.replace(tzinfo=UTC)
                        if (now - last_w_dt) < gap_delta:
                            continue
                    except Exception:
                        pass

            pat = _resolve_page_access_token_via_transports(transports, ext_pid)
            if not pat:
                continue

            niche_k = _infer_niche_key_from_category(str(item.get("category") or ""))
            _, _, _, post_msg = _spin_via_page_copy(niche_k, idx + posts_cnt)
            external_post_id = publish_page_feed_post(
                ext_pid,
                pat,
                post_msg,
                api_base_url=settings.meta_graph_api_base_url,
                api_version=settings.meta_graph_api_version,
            )
            if external_post_id:
                pg_obj = session.get(Page, uuid.UUID(item["id"]))
                if pg_obj and pg_obj.workspace_id == workspace_id:
                    pg_obj.updated_at = now
                audit.record(
                    action="page.warmup_posted",
                    entity_type="page",
                    entity_id=item["id"],
                    metadata={
                        "page_name": item.get("name") or "",
                        "category": item.get("category") or "Trang Thương hiệu",
                        "via_id": item.get("holder_identity_id") or "",
                        "via_label": item.get("holder_label") or "Via Giữ Page",
                        "browser_profile": item.get("holder_browser_profile") or "Chrome Profile",
                        "message": post_msg,
                        "delivery_mode": "AUTO_CRON_GRAPH_PUBLISHED",
                        "external_post_id": external_post_id,
                        "last_warmup_at": now.isoformat(),
                    },
                )
                auto_warmed_count += 1

    did_real_work = bool(
        force_sync
        or force_warmup
        or sync_executed
        or auto_warmed_count > 0
        or int(tg_alert_res.get("sent") or 0) > 0
        or outbox_res.sent > 0
    )
    run_summary = {
        "sync_executed": sync_executed,
        "sync_status": sync_status,
        "auto_warmed_count": auto_warmed_count,
        "telegram_ops_sent": int(tg_alert_res.get("sent") or 0),
        "outbox_sent": int(outbox_res.sent),
        "trigger": "manual" if (force_sync or force_warmup) else "scheduled",
        "executed_at": now.isoformat(),
    }
    if did_real_work:
        audit.record(
            action="workspace_automation_cron.executed",
            entity_type="workspace_automation_run",
            entity_id=str(workspace_id),
            metadata=run_summary,
        )
    session.flush()
    return run_summary


def run_all_workspaces_cron_tick() -> dict[str, Any]:
    """Executed periodically from FastAPI lifespan under a DB advisory lock."""
    totals = {"locked": False, "workspaces": 0, "synced": 0, "warmed": 0, "tg_sent": 0}
    with SessionLocal() as session:
        locked = bool(
            session.execute(
                sa.text("SELECT pg_try_advisory_lock(:k)"),
                {"k": CRON_ADVISORY_LOCK_KEY},
            ).scalar()
        )
        if not locked:
            return totals
        totals["locked"] = True
        try:
            ws_rows = list(
                session.execute(sa.select(Workspace).where(Workspace.archived_at.is_(None))).scalars().all()
            )
            for ws in ws_rows:
                totals["workspaces"] += 1
                try:
                    member = session.execute(
                        sa.select(WorkspaceMember)
                        .where(WorkspaceMember.workspace_id == ws.id, WorkspaceMember.archived_at.is_(None))
                        .order_by(WorkspaceMember.created_at.asc())
                    ).scalars().first()
                    actor_id = member.user_id if member else None
                    res = run_workspace_automation_cycle(session, ws.id, actor_id)
                    session.commit()
                    if res.get("sync_executed"):
                        totals["synced"] += 1
                    totals["warmed"] += int(res.get("auto_warmed_count") or 0)
                    totals["tg_sent"] += int(res.get("telegram_ops_sent") or 0)
                except Exception as exc:
                    session.rollback()
                    logger.warning("cron_workspace_failed", extra={"err": type(exc).__name__})
        finally:
            try:
                session.execute(
                    sa.text("SELECT pg_advisory_unlock(:k)"),
                    {"k": CRON_ADVISORY_LOCK_KEY},
                )
                session.commit()
            except Exception:
                session.rollback()
    return totals
