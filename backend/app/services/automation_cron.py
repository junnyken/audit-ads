"""Bounded official Graph GET sync and local registry/audit persistence only."""
from __future__ import annotations

import logging
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, ValidationError
from app.db.session import SessionLocal
from app.models.entities import AdAccount, AuditLog, Page, Workspace, WorkspaceMember
from app.services.audit import AuditLogService

logger = logging.getLogger(__name__)
CRON_ADVISORY_LOCK_KEY = 88442211
READ_LIMIT = 100
MAX_TRANSPORTS = 3
SUMMARY_KEYS = {
    "sync_executed", "sync_status", "parts", "trigger", "executed_at",
    "auto_warmed_count", "telegram_ops_sent", "outbox_sent", "overdue_keepalive_vias",
}


def _rows(session, workspace_id, entity_type, action):
    return session.execute(sa.select(AuditLog).where(
        AuditLog.workspace_id == workspace_id, AuditLog.entity_type == entity_type,
        AuditLog.action == action,
    ).order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(100)).scalars().all()


def get_workspace_cron_config(session: Session, workspace_id: uuid.UUID) -> dict[str, Any]:
    rows = _rows(session, workspace_id, "workspace_automation_cron", "workspace_automation_cron.updated")
    row = rows[0] if rows else None
    meta = row.metadata_json if row and isinstance(row.metadata_json, dict) else {}
    interval = meta.get("sync_interval_minutes", 60)
    if type(interval) is not int or not 15 <= interval <= 720:
        interval = 60
    return {
        "auto_meta_sync_enabled": meta.get("auto_meta_sync_enabled") is True,
        "sync_interval_minutes": interval,
        "auto_page_warmup_enabled": False,
        "warmup_supported": False,
        "warmup_min_gap_hours": 8,
        "updated_at": row.created_at.isoformat() if row and row.created_at else None,
    }


def save_workspace_cron_config(
    session: Session, workspace_id: uuid.UUID, audit: AuditLogService, *,
    auto_meta_sync_enabled: bool | None = None,
    sync_interval_minutes: int | None = None,
    auto_page_warmup_enabled: bool | None = None,
    warmup_min_gap_hours: int | None = None,
) -> dict[str, Any]:
    if auto_page_warmup_enabled is not None and auto_page_warmup_enabled is not False:
        raise ValidationError("Page warmup is unsupported in read sync.")
    if auto_meta_sync_enabled is not None and type(auto_meta_sync_enabled) is not bool:
        raise ValidationError("Sync must be a boolean.")
    if sync_interval_minutes is not None and (
        type(sync_interval_minutes) is not int or not 15 <= sync_interval_minutes <= 720
    ):
        raise ValidationError("Sync interval must be an integer from 15 to 720.")
    if warmup_min_gap_hours is not None and (
        type(warmup_min_gap_hours) is not int or not 4 <= warmup_min_gap_hours <= 24
    ):
        raise ValidationError("Invalid legacy warmup interval.")
    cfg = get_workspace_cron_config(session, workspace_id)
    if auto_meta_sync_enabled is not None:
        cfg["auto_meta_sync_enabled"] = auto_meta_sync_enabled
    if sync_interval_minutes is not None:
        cfg["sync_interval_minutes"] = sync_interval_minutes
    cfg.pop("updated_at")
    audit.record(action="workspace_automation_cron.updated", entity_type="workspace_automation_cron",
                 entity_id=str(workspace_id), metadata=cfg)
    session.flush()
    return get_workspace_cron_status(session, workspace_id)


def _safe_summary(raw):
    if not isinstance(raw, dict):
        return None
    out = {k: raw[k] for k in SUMMARY_KEYS - {"parts"} if k in raw and
           (type(raw[k]) in (bool, int) or k == "executed_at" and _timestamp(raw[k]) is not None)}
    out["sync_status"] = raw.get("sync_status") if isinstance(raw.get("sync_status"), str) and raw.get("sync_status") in {
        "succeeded", "partial", "error", "skipped_no_token", "not_due", "license_read_only"
    } else "unknown"
    out["trigger"] = "manual" if raw.get("trigger") == "manual" else "scheduled"
    parts = raw.get("parts")
    out["parts"] = {name: {k: value for k, value in item.items() if
        (k == "status" and value in ("succeeded", "partial", "error")) or
        (k in ("read", "updated") and type(value) is int and 0 <= value <= READ_LIMIT * MAX_TRANSPORTS)}
        for name, item in parts.items() if name in ("pages", "accounts") and isinstance(item, dict)
    } if isinstance(parts, dict) else {}
    return out


def _timestamp(value):
    try:
        result = datetime.fromisoformat(value)
        return result.replace(tzinfo=UTC) if result.tzinfo is None else result
    except (TypeError, ValueError):
        return None


def _run_times(rows):
    attempt = success = None
    for row in rows:
        summary = _safe_summary(row.metadata_json) or {}
        if summary.get("sync_executed") is not True:
            continue
        ts = row.created_at
        ts = ts.replace(tzinfo=UTC) if ts and ts.tzinfo is None else ts
        attempt = attempt or ts
        parts = summary.get("parts", {})
        if summary.get("sync_status") == "succeeded" and set(parts) == {"pages", "accounts"} and all(
            p.get("status") == "succeeded" for p in parts.values()
        ):
            success = success or ts
    return attempt, success


def get_workspace_cron_status(session: Session, workspace_id: uuid.UUID) -> dict[str, Any]:
    cfg = get_workspace_cron_config(session, workspace_id)
    rows = _rows(session, workspace_id, "workspace_automation_run", "workspace_automation_cron.executed")
    attempt, success = _run_times(rows)
    return {**cfg,
        "read_scope": "existing_registry_names",
        "read_limits": {"max_transports": MAX_TRANSPORTS, "items_per_part_per_transport": READ_LIMIT,
                        "audit_history_rows": 100, "follow_pagination": False},
        "last_run_at": rows[0].created_at.isoformat() if rows and rows[0].created_at else None,
        "last_attempt_at": attempt.isoformat() if attempt else None,
        "last_success_at": success.isoformat() if success else None,
        "last_sync_at": success.isoformat() if success else None,
        "next_sync_at": ((attempt + timedelta(minutes=cfg["sync_interval_minutes"])).isoformat()
                         if attempt else None) if cfg["auto_meta_sync_enabled"] else None,
        "last_run_summary": _safe_summary(rows[0].metadata_json) if rows else None,
    }


@contextmanager
def _cron_lock(session):
    # Dedicated connection pins the session lock across caller commits/pool releases.
    with session.get_bind().connect() as connection:
        locked = bool(connection.execute(sa.text("SELECT pg_try_advisory_lock(:k)"),
                                         {"k": CRON_ADVISORY_LOCK_KEY}).scalar())
        try:
            yield locked
        finally:
            if locked:
                try:
                    connection.execute(sa.text("SELECT pg_advisory_unlock(:k)"),
                                       {"k": CRON_ADVISORY_LOCK_KEY})
                    connection.commit()
                except Exception:
                    # Never return a possibly locked backend connection to the pool.
                    connection.invalidate()
                    raise


def _read_registry_part(session, workspace_id, transports, part):
    """Use actual workspace official transports; no discovery/copywriting side effects.

    One GET per transport/part, no pagination URLs followed. A next cursor is partial.
    Refresh existing registry names only; no inferred ownership/status/creation.
    """
    model, external, label, edge, fields = (
        (Page, "external_page_id", "name", "me/accounts", "id,name") if part == "pages" else
        (AdAccount, "external_account_id", "display_name", "me/adaccounts", "id,account_id,name")
    )
    read = updated = 0
    partial = len(transports) > MAX_TRANSPORTS
    for transport in transports[:MAX_TRANSPORTS]:
        response = transport.get(edge, {"fields": fields, "limit": str(READ_LIMIT)})
        if not response.ok or not isinstance(response.payload, dict):
            raise ValidationError("Official read failed.")
        data = response.payload.get("data")
        if not isinstance(data, list):
            raise ValidationError("Invalid official read response.")
        paging = response.payload.get("paging")
        partial |= bool(isinstance(paging, dict) and paging.get("next")) or len(data) > READ_LIMIT
        normalized = []
        for item in data[:READ_LIMIT]:
            if not isinstance(item, dict) or not isinstance(item.get("name"), str):
                raise ValidationError("Invalid official read item.")
            value = item.get("account_id") or item.get("id")
            if not isinstance(value, str) or not value:
                raise ValidationError("Invalid official read identity.")
            identity = value.removeprefix("act_") if part == "accounts" else value
            if not identity:
                raise ValidationError("Invalid official read identity.")
            normalized.append((identity, item["name"]))
        identities = {identity for identity, _ in normalized}
        candidates = identities | {"act_" + identity for identity in identities} if part == "accounts" else identities
        local = {}
        for row in session.execute(sa.select(model).where(
            model.workspace_id == workspace_id, model.archived_at.is_(None),
            getattr(model, external).in_(candidates),
        )).scalars().all():
            stored = str(getattr(row, external))
            identity = stored.removeprefix("act_") if part == "accounts" else stored
            if identity in local:
                raise ValidationError("Ambiguous registry identity.")
            local[identity] = row
        seen = {}
        for identity, name in normalized:
            if identity in seen:
                if seen[identity] != name:
                    raise ValidationError("Conflicting official read identity.")
                continue
            seen[identity] = name
            read += 1
            row = local.get(identity)
            if row is not None:
                setattr(row, label, name[:200])
                updated += 1
    session.flush()
    return {"status": "partial" if partial else "succeeded", "read": read, "updated": updated}


def run_workspace_automation_cycle(
    session: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID | None, *,
    force_sync: bool = False, force_warmup: bool = False, commit: bool = False,
) -> dict[str, Any]:
    if force_warmup is not False:
        raise ValidationError("Page warmup is unsupported in read sync.")
    if type(force_sync) is not bool:
        raise ValidationError("Sync must be a boolean.")
    with _cron_lock(session) as locked:
        if not locked:
            raise ConflictError("Read sync is already running.")
        summary = _run_read_cycle(session, workspace_id, actor_id, force_sync=force_sync)
        if commit:
            # Manual route commits before releasing the same scheduler lock.
            session.commit()
        return summary


def _run_read_cycle(session, workspace_id, actor_id, *, force_sync=False):
    from app.api.v1.routers.meta_operations import _collect_workspace_meta_transports
    from app.services.license_service import evaluate_workspace_license

    cfg = get_workspace_cron_config(session, workspace_id)
    now = datetime.now(UTC)
    workspace = session.get(Workspace, workspace_id)
    read_only = workspace is not None and evaluate_workspace_license(workspace, now).get("is_read_only")
    attempt, _ = _run_times(_rows(session, workspace_id, "workspace_automation_run",
                                "workspace_automation_cron.executed"))
    due = not read_only and (force_sync or cfg["auto_meta_sync_enabled"] and (
        attempt is None or now - attempt >= timedelta(minutes=cfg["sync_interval_minutes"])))
    summary = {"sync_executed": bool(due), "sync_status": "license_read_only" if read_only else "not_due",
               "parts": {}, "auto_warmed_count": 0, "telegram_ops_sent": 0, "outbox_sent": 0,
               "overdue_keepalive_vias": 0, "trigger": "manual" if force_sync else "scheduled",
               "executed_at": now.isoformat()}
    if due:
        try:
            transports = _collect_workspace_meta_transports(session, workspace_id)
            if not transports:
                summary["sync_status"] = "skipped_no_token"
            else:
                for part in ("pages", "accounts"):
                    try:
                        with session.begin_nested():
                            result = _read_registry_part(session, workspace_id, transports, part)
                        summary["parts"][part] = result
                    except Exception:
                        summary["parts"][part] = {"status": "error", "read": 0, "updated": 0}
                statuses = [p["status"] for p in summary["parts"].values()]
                summary["sync_status"] = ("succeeded" if all(s == "succeeded" for s in statuses) else
                                          "error" if all(s == "error" for s in statuses) else "partial")
        except Exception:
            summary["sync_status"] = "error"
        AuditLogService(session, workspace_id, actor_id).record(
            action="workspace_automation_cron.executed", entity_type="workspace_automation_run",
            entity_id=str(workspace_id), metadata=summary)
    session.flush()
    return summary


def run_all_workspaces_cron_tick() -> dict[str, Any]:
    """Existing scheduler, same nonblocking global lock as manual runs."""
    totals = {"locked": False, "workspaces": 0, "synced": 0, "warmed": 0, "tg_sent": 0}
    with SessionLocal() as session, _cron_lock(session) as locked:
        if not locked:
            return totals
        totals["locked"] = True
        workspaces = session.execute(sa.select(Workspace).where(Workspace.archived_at.is_(None))).scalars().all()
        for workspace in workspaces:
            totals["workspaces"] += 1
            try:
                member = session.execute(sa.select(WorkspaceMember).where(
                    WorkspaceMember.workspace_id == workspace.id,
                    WorkspaceMember.archived_at.is_(None),
                ).order_by(WorkspaceMember.created_at.asc())).scalars().first()
                result = _run_read_cycle(session, workspace.id, member.user_id if member else None)
                session.commit()
                totals["synced"] += result["sync_status"] == "succeeded"
            except Exception:
                session.rollback()
                logger.warning("cron_workspace_failed")
    return totals
