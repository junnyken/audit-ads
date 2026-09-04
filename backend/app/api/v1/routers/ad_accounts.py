from __future__ import annotations

import uuid
from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, Query

from app.api.deps import Ctx, WriteCtx
from app.core.enums import AssetType
from app.models.entities import (
    AccountAssetLink,
    BrowserProfileReference,
    Page,
    PaymentProfileReference,
    Pixel,
    ProxyReference,
)
from app.schemas import registry as s
from app.schemas.common import page_response
from app.services.base import get_or_404
from app.services.links import AssetLinkService
from app.services.registry import AccountFilters, AdAccountRegistryService

router = APIRouter(prefix="/ad-accounts", tags=["ad-accounts"])

_ASSET_LABEL_FIELDS = {
    AssetType.PAGE: (Page, "name"),
    AssetType.PIXEL: (Pixel, "name"),
    AssetType.PAYMENT_PROFILE: (PaymentProfileReference, "reference_code"),
    AssetType.BROWSER_PROFILE: (BrowserProfileReference, "profile_reference"),
    AssetType.PROXY: (ProxyReference, "proxy_reference"),
}


def _serialize_account(account) -> dict[str, Any]:
    data = s.AdAccountOut.model_validate(account).model_dump()
    data["business_manager_name"] = account.business_manager.name if account.business_manager else None
    data["personal_account_reference_label"] = (
        account.personal_account_reference.label if account.personal_account_reference else None
    )
    return data


@router.get("")
def list_accounts(
    ctx: Ctx,
    search: str | None = None,
    status: str | None = None,
    readiness_status: str | None = None,
    account_type: str | None = None,
    business_manager_id: uuid.UUID | None = None,
    personal_account_reference_id: uuid.UUID | None = None,
    country: str | None = None,
    currency: str | None = None,
    has_browser_reference: bool | None = None,
    has_proxy_reference: bool | None = None,
    archived: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    sort: str = "updated_at",
    sort_direction: str = Query("desc", pattern="^(asc|desc)$"),
) -> dict[str, Any]:
    service = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit)
    rows, total = service.list(
        AccountFilters(
            search=search,
            status=status,
            readiness_status=readiness_status,
            account_type=account_type,
            business_manager_id=business_manager_id,
            personal_account_reference_id=personal_account_reference_id,
            country=country,
            currency=currency,
            has_browser_reference=has_browser_reference,
            has_proxy_reference=has_proxy_reference,
            archived=archived,
            page=page,
            page_size=page_size,
            sort=sort,
            sort_direction=sort_direction,
        )
    )
    evaluations = service.rollup.evaluate_many(list(rows))
    active_links: dict[uuid.UUID, set] = {}
    if rows:
        for account_id, asset_type in ctx.session.execute(
            sa.select(AccountAssetLink.ad_account_id, AccountAssetLink.asset_type).where(
                AccountAssetLink.ad_account_id.in_([row.id for row in rows]),
                AccountAssetLink.unlinked_at.is_(None),
            )
        ).all():
            active_links.setdefault(account_id, set()).add(asset_type)

    items: list[dict[str, Any]] = []
    for account in rows:
        data = _serialize_account(account)
        result = evaluations.get(str(account.id))
        if result is not None:
            data["required_item_count"] = result.required_item_count
            data["completed_item_count"] = result.completed_item_count
        linked = active_links.get(account.id, set())
        data["has_browser_reference"] = AssetType.BROWSER_PROFILE in linked
        data["has_proxy_reference"] = AssetType.PROXY in linked
        items.append(data)
    return page_response(items, page=page, page_size=page_size, total=total)


@router.post("", status_code=201)
def create_account(ctx: WriteCtx, payload: s.AdAccountCreate) -> dict[str, Any]:
    service = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit)
    account = service.create(payload.model_dump())
    ctx.commit()
    return _serialize_account(account)


@router.get("/{ad_account_id}")
def get_account(ctx: Ctx, ad_account_id: uuid.UUID) -> dict[str, Any]:
    service = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit)
    return _serialize_account(service.get(ad_account_id))


@router.patch("/{ad_account_id}")
def update_account(ctx: WriteCtx, ad_account_id: uuid.UUID, payload: s.AdAccountUpdate) -> dict[str, Any]:
    service = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit)
    account = service.update(service.get(ad_account_id), payload.model_dump(exclude_unset=True))
    ctx.commit()
    return _serialize_account(account)


@router.post("/{ad_account_id}/archive")
def archive_account(ctx: WriteCtx, ad_account_id: uuid.UUID) -> dict[str, Any]:
    service = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit)
    account = service.archive(service.get(ad_account_id))
    ctx.commit()
    return _serialize_account(account)


@router.post("/{ad_account_id}/restore")
def restore_account(ctx: WriteCtx, ad_account_id: uuid.UUID) -> dict[str, Any]:
    service = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit)
    account = service.restore(service.get(ad_account_id))
    ctx.commit()
    return _serialize_account(account)


# ------------------------------------------------------------------------- asset links
def _asset_label(ctx, link: AccountAssetLink) -> str | None:
    model, field = _ASSET_LABEL_FIELDS[link.asset_type]
    asset = ctx.session.get(model, link.asset_id)
    return getattr(asset, field, None) if asset else None


def _serialize_link(ctx, link: AccountAssetLink) -> dict[str, Any]:
    data = s.AssetLinkOut.model_validate(link).model_dump()
    data["asset_label"] = _asset_label(ctx, link)
    return data


@router.get("/{ad_account_id}/asset-links")
def list_asset_links(ctx: Ctx, ad_account_id: uuid.UUID, include_inactive: bool = True) -> list[dict[str, Any]]:
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit)
    account = registry.get(ad_account_id)
    links = AssetLinkService(ctx.session, ctx.workspace_id, ctx.audit).list_links(
        account.id, include_inactive=include_inactive
    )
    return [_serialize_link(ctx, link) for link in links]


@router.post("/{ad_account_id}/asset-links", status_code=201)
def create_asset_link(ctx: WriteCtx, ad_account_id: uuid.UUID, payload: s.AssetLinkCreate) -> dict[str, Any]:
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit)
    account = registry.get(ad_account_id)
    links = AssetLinkService(ctx.session, ctx.workspace_id, ctx.audit)
    link = links.link(
        account,
        asset_type=payload.asset_type,
        asset_id=payload.asset_id,
        actor_id=ctx.actor_id,
        note=payload.note,
    )
    registry.rollup.evaluate(account)
    ctx.commit()
    return _serialize_link(ctx, link)


@router.patch("/{ad_account_id}/asset-links/{link_id}")
def update_asset_link(
    ctx: WriteCtx, ad_account_id: uuid.UUID, link_id: uuid.UUID, payload: s.AssetLinkUpdate
) -> dict[str, Any]:
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit)
    registry.get(ad_account_id)
    link = get_or_404(ctx.session, AccountAssetLink, link_id, ctx.workspace_id, label="Asset link")
    updated = AssetLinkService(ctx.session, ctx.workspace_id, ctx.audit).update_note(link, payload.note)
    ctx.commit()
    return _serialize_link(ctx, updated)


@router.post("/{ad_account_id}/asset-links/{link_id}/unlink")
def unlink_asset(ctx: WriteCtx, ad_account_id: uuid.UUID, link_id: uuid.UUID) -> dict[str, Any]:
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit)
    account = registry.get(ad_account_id)
    link = get_or_404(ctx.session, AccountAssetLink, link_id, ctx.workspace_id, label="Asset link")
    updated = AssetLinkService(ctx.session, ctx.workspace_id, ctx.audit).unlink(link, actor_id=ctx.actor_id)
    registry.rollup.evaluate(account)
    ctx.commit()
    return _serialize_link(ctx, updated)
