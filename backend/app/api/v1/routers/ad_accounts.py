from __future__ import annotations

import uuid
from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, Query

from app.api.deps import Ctx, WriteCtx
from app.core.config import get_settings
from app.core.enums import AssetType, EvaluationTrigger
from app.models.entities import (
    AccountAssetLink,
    AuditLog,
    BrowserProfileReference,
    Page,
    PaymentProfileReference,
    Pixel,
    ProxyReference,
)
from app.schemas import registry as s
from app.schemas.common import page_response
from app.services import spend_service
from app.services.base import get_or_404
from app.services.facebook_identities import FacebookIdentityService
from app.services.health_triggers import trigger_health
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


def _import_provenance(session, workspace_id, ad_account_id) -> dict[str, Any] | None:
    """How this account came to exist, when it came from a read-only discovery.

    Derived from the audit log rather than stored on the row. `ad_accounts` has no origin column,
    and adding one would duplicate a fact rule 3 already guarantees: the import wrote its audit row
    in the same transaction as the account, and rule 2 means that row is permanent.

    Nothing here is secret — a run id, a Business Manager id that is public in Business Settings,
    and the name of a Graph edge.
    """
    row = session.execute(
        sa.select(AuditLog)
        .where(
            AuditLog.workspace_id == workspace_id,
            AuditLog.entity_type == "ad_account",
            # entity_id is String(64), not a UUID column — comparing a UUID to it makes Postgres
            # refuse the whole query. Every other caller in this codebase writes str(...) here.
            AuditLog.entity_id == str(ad_account_id),
            AuditLog.action.in_(
                ("meta_discovery.ad_account_imported", "meta_discovery.ad_account_auto_imported")
            ),
        )
        .order_by(AuditLog.created_at.desc())
    ).scalars().first()
    if row is None:
        return None
    metadata = row.metadata_json or {}
    automatic = row.action == "meta_discovery.ad_account_auto_imported"
    return {
        "discovery_run_id": metadata.get("discovery_run_id"),
        "business_manager_reference": metadata.get("business_manager_reference"),
        "source_edge": metadata.get("source_edge"),
        "imported_at": row.created_at.isoformat() if row.created_at else None,
        # O3. `scheduled_sweep` when the discovery sweep imported it on its own; `manual` when a
        # person pressed "Add to registry". Rows written before O3 carry no trigger: manual.
        "trigger": "scheduled_sweep" if automatic else (metadata.get("trigger") or "manual"),
        "automatic": automatic,
        # Provenance only, never a registry relationship: the account stays under the Business
        # Manager whose connection can read it (the hub). `None` means Meta did not return an
        # owner for this row — never a guess.
        "owner_business_reference": metadata.get("owner_business_reference"),
        "owner_business_name": metadata.get("owner_business_name"),
    }


def _identity_service(ctx) -> FacebookIdentityService:
    return FacebookIdentityService(ctx.session, ctx.workspace_id, ctx.audit, get_settings())


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
    facebook_identity_id: uuid.UUID | None = None,
    country: str | None = None,
    currency: str | None = None,
    has_browser_reference: bool | None = None,
    has_proxy_reference: bool | None = None,
    unassigned_identity: bool | None = None,
    archived: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    sort: str = "updated_at",
    sort_direction: str = Query("desc", pattern="^(asc|desc)$"),
) -> dict[str, Any]:
    service = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids())
    rows, total = service.list(
        AccountFilters(
            search=search,
            status=status,
            readiness_status=readiness_status,
            account_type=account_type,
            business_manager_id=business_manager_id,
            personal_account_reference_id=personal_account_reference_id,
            facebook_identity_id=facebook_identity_id,
            country=country,
            currency=currency,
            has_browser_reference=has_browser_reference,
            has_proxy_reference=has_proxy_reference,
            unassigned_identity=unassigned_identity,
            archived=archived,
            page=page,
            page_size=page_size,
            sort=sort,
            sort_direction=sort_direction,
            visible_ids=ctx.visible_ad_account_ids(),
        )
    )
    evaluations = service.rollup.evaluate_many(list(rows))
    active_links: dict[uuid.UUID, set] = {}
    payment_labels: dict[uuid.UUID, list[str]] = {}
    if rows:
        for account_id, asset_type, pay_code, pay_label in ctx.session.execute(
            sa.select(
                AccountAssetLink.ad_account_id,
                AccountAssetLink.asset_type,
                PaymentProfileReference.reference_code,
                PaymentProfileReference.label,
            )
            .outerjoin(
                PaymentProfileReference,
                sa.and_(
                    AccountAssetLink.asset_type == AssetType.PAYMENT_PROFILE,
                    PaymentProfileReference.id == AccountAssetLink.asset_id,
                    PaymentProfileReference.archived_at.is_(None),
                ),
            )
            .where(
                AccountAssetLink.ad_account_id.in_([row.id for row in rows]),
                AccountAssetLink.unlinked_at.is_(None),
            )
        ).all():
            active_links.setdefault(account_id, set()).add(asset_type)
            if asset_type == AssetType.PAYMENT_PROFILE and pay_code:
                text = f"{pay_code} ({pay_label})" if pay_label and pay_label != pay_code else pay_code
                if text not in payment_labels.setdefault(account_id, []):
                    payment_labels[account_id].append(text)

    # One bounded pair of queries for the whole page; no Meta call (S1 follow-up). The same pair
    # carries Meta's latest account status (S2) — no extra query per account.
    reads = spend_service.list_compact_reads(ctx.session, ctx.workspace_id, list(rows))
    # F1: bounded too — three queries for the page, whatever its size.
    identities = _identity_service(ctx).identities_for_accounts(rows)

    items: list[dict[str, Any]] = []
    for account in rows:
        data = _serialize_account(account)
        data["spend"] = reads[account.id]["spend"]
        data["spend_periods"] = reads[account.id]["spend_periods"]
        data["platform_status"] = reads[account.id]["platform_status"]
        result = evaluations.get(str(account.id))
        if result is not None:
            data["required_item_count"] = result.required_item_count
            data["completed_item_count"] = result.completed_item_count
        linked = active_links.get(account.id, set())
        data["has_browser_reference"] = AssetType.BROWSER_PROFILE in linked
        data["has_proxy_reference"] = AssetType.PROXY in linked
        data["payment_profile_labels"] = payment_labels.get(account.id, [])
        data["facebook_identities"] = [
            {
                "id": item["id"],
                "label": item["label"],
                "device_label": item.get("device_label", ""),
                "browser_profile_label": item.get("browser_profile_label", ""),
            }
            for item in identities.get(account.id, [])
        ]
        items.append(data)
    return page_response(items, page=page, page_size=page_size, total=total)


@router.post("", status_code=201)
def create_account(ctx: WriteCtx, payload: s.AdAccountCreate) -> dict[str, Any]:
    service = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids())
    account = service.create(payload.model_dump())
    trigger_health(ctx, account, EvaluationTrigger.ACCOUNT_MUTATION)
    ctx.commit()
    return _serialize_account(account)


@router.get("/{ad_account_id}")
def get_account(ctx: Ctx, ad_account_id: uuid.UUID) -> dict[str, Any]:
    service = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids())
    account = service.get(ad_account_id)
    data = _serialize_account(account)
    # Detail only. One lookup per row would be N+1 on a page of two hundred accounts, and the list
    # has no use for it.
    data["imported_from_discovery"] = _import_provenance(ctx.session, ctx.workspace_id, account.id)
    # S2: Meta's latest account status, compact, from stored observations. Never calls Meta.
    data["platform_status"] = spend_service.list_compact_reads(ctx.session, ctx.workspace_id, [account])[
        account.id
    ]["platform_status"]
    # F1: "log in to fix this" — every Facebook account that reaches this one, directly or via its BM.
    data["facebook_identities"] = _identity_service(ctx).identities_for_accounts([account])[account.id]
    return data


@router.patch("/{ad_account_id}")
def update_account(ctx: WriteCtx, ad_account_id: uuid.UUID, payload: s.AdAccountUpdate) -> dict[str, Any]:
    service = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids())
    account = service.update(service.get(ad_account_id), payload.model_dump(exclude_unset=True))
    trigger_health(ctx, account, EvaluationTrigger.ACCOUNT_MUTATION)
    ctx.commit()
    return _serialize_account(account)


@router.post("/{ad_account_id}/archive")
def archive_account(ctx: WriteCtx, ad_account_id: uuid.UUID) -> dict[str, Any]:
    service = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids())
    account = service.archive(service.get(ad_account_id))
    trigger_health(ctx, account, EvaluationTrigger.ACCOUNT_MUTATION)
    ctx.commit()
    return _serialize_account(account)


@router.post("/{ad_account_id}/restore")
def restore_account(ctx: WriteCtx, ad_account_id: uuid.UUID) -> dict[str, Any]:
    service = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids())
    account = service.restore(service.get(ad_account_id))
    trigger_health(ctx, account, EvaluationTrigger.ACCOUNT_MUTATION)
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
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids())
    account = registry.get(ad_account_id)
    links = AssetLinkService(ctx.session, ctx.workspace_id, ctx.audit).list_links(
        account.id, include_inactive=include_inactive
    )
    return [_serialize_link(ctx, link) for link in links]


@router.post("/{ad_account_id}/asset-links", status_code=201)
def create_asset_link(ctx: WriteCtx, ad_account_id: uuid.UUID, payload: s.AssetLinkCreate) -> dict[str, Any]:
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids())
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
    trigger_health(ctx, account, EvaluationTrigger.ACCOUNT_MUTATION, reference_id=str(link.id))
    ctx.commit()
    return _serialize_link(ctx, link)


@router.patch("/{ad_account_id}/asset-links/{link_id}")
def update_asset_link(
    ctx: WriteCtx, ad_account_id: uuid.UUID, link_id: uuid.UUID, payload: s.AssetLinkUpdate
) -> dict[str, Any]:
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids())
    registry.get(ad_account_id)
    link = get_or_404(ctx.session, AccountAssetLink, link_id, ctx.workspace_id, label="Asset link")
    updated = AssetLinkService(ctx.session, ctx.workspace_id, ctx.audit).update_note(link, payload.note)
    ctx.commit()
    return _serialize_link(ctx, updated)


@router.post("/{ad_account_id}/asset-links/{link_id}/unlink")
def unlink_asset(ctx: WriteCtx, ad_account_id: uuid.UUID, link_id: uuid.UUID) -> dict[str, Any]:
    registry = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids())
    account = registry.get(ad_account_id)
    link = get_or_404(ctx.session, AccountAssetLink, link_id, ctx.workspace_id, label="Asset link")
    updated = AssetLinkService(ctx.session, ctx.workspace_id, ctx.audit).unlink(link, actor_id=ctx.actor_id)
    registry.rollup.evaluate(account)
    trigger_health(ctx, account, EvaluationTrigger.ACCOUNT_MUTATION, reference_id=str(updated.id))
    ctx.commit()
    return _serialize_link(ctx, updated)
