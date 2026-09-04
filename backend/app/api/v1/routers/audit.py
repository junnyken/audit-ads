from __future__ import annotations

import uuid
from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, Query

from app.api.deps import AuditCtx
from app.models.entities import (
    AccountAssetLink,
    AccountEvent,
    AuditLog,
    ReadinessEvidence,
    User,
)
from app.schemas.audit import AuditLogOut
from app.schemas.common import page_response
from app.services.registry import AdAccountRegistryService

router = APIRouter(tags=["audit"])


def _query(ctx, *, entity_type: str | None, entity_id: str | None, action: str | None, actor_id: uuid.UUID | None):
    stmt = (
        sa.select(AuditLog, User.email)
        .outerjoin(User, User.id == AuditLog.actor_id)
        .where(AuditLog.workspace_id == ctx.workspace_id)
    )
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    if action:
        stmt = stmt.where(AuditLog.action.ilike(f"%{action}%"))
    if actor_id:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
    return stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())


def _serialize(rows) -> list[dict[str, Any]]:
    payload = []
    for entry, actor_email in rows:
        data = AuditLogOut.model_validate(entry).model_dump()
        data["actor_email"] = actor_email
        payload.append(data)
    return payload


@router.get("/audit-logs")
def list_audit_logs(
    ctx: AuditCtx,
    entity_type: str | None = None,
    entity_id: str | None = None,
    action: str | None = None,
    actor_id: uuid.UUID | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    stmt = _query(ctx, entity_type=entity_type, entity_id=entity_id, action=action, actor_id=actor_id)
    total = ctx.session.execute(
        sa.select(sa.func.count()).select_from(stmt.order_by(None).subquery())
    ).scalar_one()
    rows = ctx.session.execute(stmt.limit(page_size).offset((page - 1) * page_size)).all()
    return page_response(_serialize(rows), page=page, page_size=page_size, total=int(total))


@router.get("/ad-accounts/{ad_account_id}/audit-logs")
def list_account_audit_logs(
    ctx: AuditCtx,
    ad_account_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    """Everything that happened to this account, including its checklist items, evidence,
    events and asset links — an audit trail that stopped at the account row would hide most
    of the operational history."""
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit)
    account = registry.get(ad_account_id)

    checklist_items = registry.checklists.list_items(account.id)
    item_ids = [item.id for item in checklist_items]
    related_ids: set[str] = {str(account.id)} | {str(item_id) for item_id in item_ids}

    for model, predicate in (
        (AccountEvent, AccountEvent.ad_account_id == account.id),
        (AccountAssetLink, AccountAssetLink.ad_account_id == account.id),
    ):
        for row_id in ctx.session.execute(sa.select(model.id).where(predicate)).scalars().all():
            related_ids.add(str(row_id))

    if item_ids:
        evidence_ids = ctx.session.execute(
            sa.select(ReadinessEvidence.id).where(ReadinessEvidence.checklist_item_id.in_(item_ids))
        ).scalars().all()
        related_ids.update(str(row_id) for row_id in evidence_ids)

    stmt = (
        sa.select(AuditLog, User.email)
        .outerjoin(User, User.id == AuditLog.actor_id)
        .where(AuditLog.workspace_id == ctx.workspace_id, AuditLog.entity_id.in_(related_ids))
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
    )
    total = ctx.session.execute(
        sa.select(sa.func.count()).select_from(stmt.order_by(None).subquery())
    ).scalar_one()
    rows = ctx.session.execute(stmt.limit(page_size).offset((page - 1) * page_size)).all()
    return page_response(_serialize(rows), page=page, page_size=page_size, total=int(total))
