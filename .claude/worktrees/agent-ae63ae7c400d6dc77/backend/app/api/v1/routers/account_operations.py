"""A7 — Account Operations Intelligence. Every route here is a read: no endpoint in this
module writes anything, matching the mini-spec's read-only boundary."""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Query

from app.api.deps import Ctx
from app.schemas import account_operations as s
from app.schemas.common import page_response
from app.services.account_operations import AccountOperationsRow, AccountOperationsService
from app.services.registry import AccountFilters, AdAccountRegistryService

router = APIRouter(prefix="/account-operations", tags=["account-operations"])


def _serialize_row(row: AccountOperationsRow) -> dict[str, Any]:
    return {
        "id": row.account.id,
        "display_name": row.account.display_name,
        "business_manager_name": row.business_manager_name,
        "status": row.account.status.value,
        "readiness_status": row.readiness_status,
        "health_status": row.health_status,
        "activity_status": row.activity_status.value,
        "data_freshness": row.data_freshness,
        "open_alert_count": row.open_alert_count,
        "open_critical_alert_count": row.open_critical_alert_count,
        "currency": row.account.currency,
        "last_activity_at": row.account.last_activity_at,
        "updated_at": row.account.updated_at,
        "spend_today": None,
        "spend_last_7_days": None,
        "spend_current_month": None,
    }


@router.get("/overview")
def operations_overview(ctx: Ctx) -> s.OperationsOverviewOut:
    service = AccountOperationsService(ctx.session, ctx.workspace_id, ctx.audit)
    return s.OperationsOverviewOut.model_validate(service.workspace_overview())


@router.get("/business-managers")
def business_manager_operations(ctx: Ctx) -> list[s.BusinessManagerOperationsOut]:
    service = AccountOperationsService(ctx.session, ctx.workspace_id, ctx.audit)
    return [s.BusinessManagerOperationsOut.model_validate(row) for row in service.business_manager_operations()]


@router.get("/accounts")
def account_operations_table(
    ctx: Ctx,
    search: str | None = None,
    status: str | None = None,
    business_manager_id: uuid.UUID | None = None,
    archived: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    sort: str = "updated_at",
    sort_direction: str = Query("desc", pattern="^(asc|desc)$"),
) -> dict[str, Any]:
    service = AccountOperationsService(ctx.session, ctx.workspace_id, ctx.audit)
    rows, total = service.account_table(
        AccountFilters(
            search=search,
            status=status,
            business_manager_id=business_manager_id,
            archived=archived,
            page=page,
            page_size=page_size,
            sort=sort,
            sort_direction=sort_direction,
        )
    )
    return page_response([_serialize_row(row) for row in rows], page=page, page_size=page_size, total=total)


@router.get("/accounts/{ad_account_id}")
def account_operations_detail(ctx: Ctx, ad_account_id: uuid.UUID) -> dict[str, Any]:
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids())
    account = registry.get(ad_account_id)
    service = AccountOperationsService(ctx.session, ctx.workspace_id, ctx.audit)
    return _serialize_row(service.account_detail(account))
