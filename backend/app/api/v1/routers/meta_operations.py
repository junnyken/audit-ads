"""A7 — BM + ad account creation & sharing via the official Meta API. Every mutation goes
through `WriteCtx`; every route is workspace-scoped through `Ctx.workspace_id`, never a payload.

No route here calls a real Meta API — no real provider is wired anywhere yet
(`get_fake_provider()` is the only provider this module can reach). Wiring a real one is a
separate, later change that itself needs the user's explicit approval, per CLAUDE.md rule 22.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter

from app.api.deps import OwnerCtx
from app.core.config import get_settings
from app.core.enums import DataFreshness, DiscoveryRunStatus, MetaEnvironment
from app.models.meta_discovery import BusinessManagerDiscoveryRun
from app.models.meta_operations import (
    AccessShareBatch,
    AccountCreationBatch,
    MetaConnection,
    PixelShareBatch,
)
from app.schemas import meta_operations as s
from app.services.base import get_or_404, snapshot
from app.services.meta_access_share import AccessShareBatchService, DraftShareItem
from app.services.meta_account_creation import AccountCreationBatchService, DraftAccountItem
from app.services.meta_discovery import MetaDiscoveryService, ReconciliationRow
from app.services.meta_pixel_share import DraftPixelShareItem, PixelShareBatchService
from app.services.meta_provider import DiscoveredAsset, get_fake_provider
from app.services.meta_real_provider import build_real_provider

#: A9 permission matrix (§6): "Manage Meta connections/capabilities" and "Queue A7/A8 external
#: operation" are owner-only by default — Admin only "if role capability exists", and A9
#: deliberately does not introduce one. Reads are owner-only too rather than half-scoped: a
#: batch item records a BM/account *external id* (a string that may not correspond to any local
#: record yet — creating one is the whole point), so membership scope cannot be proven for it,
#: and the spec's own rule for that case is to deny the non-owner rather than guess.

router = APIRouter(tags=["meta-operations"])


def _provider_for(connection: MetaConnection):
    """Fake by default; a real, **read-only** provider only when a connection is explicitly
    marked `production` *and* a token is configured on the server (A10).

    Both conditions are required, and both are deliberate acts by different people: marking a
    connection `production` is an operator decision recorded in the database, configuring
    `META_ACCESS_TOKEN` is a deployment decision. Neither alone reaches the network. Anything
    else — `fake`, `sandbox`, or `production` with no token — stays on the fake provider, so a
    misconfigured environment degrades to "no real call", never to a surprise one.

    The real provider cannot write: its create/share methods raise, and the transport beneath it
    is GET-only. See `meta_real_provider.py`.
    """
    settings = get_settings()
    if connection.environment == MetaEnvironment.PRODUCTION and settings.meta_access_token:
        return build_real_provider(settings)
    return _seeded_fake_provider(settings.meta_business_id)


def _serialize_connection(connection: MetaConnection) -> dict[str, Any]:
    settings = get_settings()
    token_configured = True if connection.environment.value == "fake" else bool(settings.meta_access_token)
    return {
        **{k: v for k, v in snapshot(connection).items() if k not in ("capabilities_json", "business_managers_json")},
        "capabilities": connection.capabilities_json,
        "business_managers": connection.business_managers_json,
        "token_configured": token_configured,
    }


#: A10.1. How long a discovery observation is treated as current. Reuses A1's freshness
#: vocabulary rather than inventing a second one — the UI must never present a stale reading as
#: though it were taken now.
DISCOVERY_STALE_AFTER = timedelta(hours=24)


def _freshness(completed_at: datetime | None) -> str:
    if completed_at is None:
        return DataFreshness.UNKNOWN.value
    age = datetime.now(UTC) - completed_at
    return (DataFreshness.CURRENT if age <= DISCOVERY_STALE_AFTER else DataFreshness.STALE).value


def _serialize_reconciliation(rows: list[ReconciliationRow]) -> list[dict[str, Any]]:
    return [
        {
            "external_id": row.external_id,
            "internal_entity_id": str(row.internal_entity_id) if row.internal_entity_id else None,
            "display_name": row.display_name,
            "status": row.status.value,
            "detail": row.detail,
        }
        for row in rows
    ]


def _serialize_discovery_run(
    run: BusinessManagerDiscoveryRun,
    *,
    ad_accounts: list[ReconciliationRow],
    pixels: list[ReconciliationRow],
) -> dict[str, Any]:
    """Coverage travels with every result. A count on its own cannot be judged: four accounts
    from a complete scan and four from a scan that never read the client edge look identical."""
    return {
        "id": str(run.id),
        "status": run.status.value,
        "trigger": run.trigger.value,
        "environment": run.provider_environment.value,
        "business_manager": {
            "reference": run.configured_business_manager_reference or None,
            "name": run.configured_business_manager_name,
        },
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "freshness": _freshness(run.completed_at),
        "failure_code": run.failure_code,
        "failure_summary": run.failure_summary,
        "ad_accounts": {
            "coverage_status": run.ad_account_coverage_status.value,
            "complete": run.ad_accounts_complete,
            "required_edges": run.ad_account_required_edges_json or [],
            "coverage": run.ad_account_coverage_json or {},
            "reconciliation": _serialize_reconciliation(ad_accounts),
        },
        "pixels": {
            "coverage_status": run.pixel_coverage_status.value,
            "complete": run.pixels_complete,
            "required_edges": run.pixel_required_edges_json or [],
            "coverage": run.pixel_coverage_json or {},
            "reconciliation": _serialize_reconciliation(pixels),
            # Stated in the payload, not left for the UI to remember: a registry Pixel has no
            # Business Manager mapping to prove, so absence from this BM says nothing about it.
            "registry_absence_evaluable": False,
        },
    }


def _seeded_fake_provider(business_id: str):
    """The fake environment exists so the flow can be exercised without touching Meta. An
    unseeded fake cannot satisfy a configured `META_BUSINESS_ID`, so discovery always refused
    with `not_configured` — which left a live Business Manager as the only way to try the
    feature, the exact opposite of what a fake provider is for.

    Everything it returns is named as fake. The Business Manager *id* deliberately matches the
    configured one, because validation is right to refuse a different one; nothing else here
    imitates real data, and the connection carries a `Fake (local testing)` badge throughout.
    """
    provider = get_fake_provider()
    if not business_id:
        return provider
    if not provider.business_managers:
        provider.business_managers.append(
            {"external_id": business_id, "name": "Fake Business Manager (local testing)"}
        )
    if not provider.discovered_ad_accounts:
        provider.discovered_ad_accounts.extend(
            [
                DiscoveredAsset("fake000000000001", "Fake ad account — owned", "owned_ad_accounts"),
                DiscoveredAsset("fake000000000002", "Fake ad account — client", "client_ad_accounts"),
            ]
        )
    if not provider.discovered_pixels:
        provider.discovered_pixels.append(
            DiscoveredAsset("fake000000000003", "Fake Pixel (local testing)", "adspixels")
        )
    return provider


def _discovery_service(ctx: OwnerCtx, connection: MetaConnection) -> MetaDiscoveryService:
    return MetaDiscoveryService(
        ctx.session,
        ctx.workspace_id,
        ctx.audit,
        provider=_provider_for(connection),
        business_id=get_settings().meta_business_id,
    )


# ------------------------------------------------------------------------- Meta connections

connections_router = APIRouter(prefix="/meta-connections", tags=["meta-operations"])


@connections_router.get("")
def list_connections(ctx: OwnerCtx) -> list[dict[str, Any]]:
    rows = (
        ctx.session.execute(
            sa.select(MetaConnection)
            .where(MetaConnection.workspace_id == ctx.workspace_id, MetaConnection.archived_at.is_(None))
            .order_by(MetaConnection.created_at.desc())
        )
        .scalars()
        .all()
    )
    return [_serialize_connection(row) for row in rows]


@connections_router.post("", status_code=201)
def create_connection(ctx: OwnerCtx, payload: s.MetaConnectionCreate) -> dict[str, Any]:
    connection = MetaConnection(
        workspace_id=ctx.workspace_id,
        label=payload.label,
        environment=payload.environment,
        notes=payload.notes,
        created_by=ctx.user.id,
    )
    ctx.session.add(connection)
    ctx.session.flush()
    ctx.audit.record(
        action="meta_connection.created",
        entity_type="meta_connection",
        entity_id=connection.id,
        after=snapshot(connection),
    )
    ctx.commit()
    return _serialize_connection(connection)


@connections_router.get("/{connection_id}")
def get_connection(ctx: OwnerCtx, connection_id: uuid.UUID) -> dict[str, Any]:
    connection = get_or_404(ctx.session, MetaConnection, connection_id, ctx.workspace_id, label="Meta connection")
    return _serialize_connection(connection)


@connections_router.post("/{connection_id}/check-capability")
def check_capability(ctx: OwnerCtx, connection_id: uuid.UUID) -> dict[str, Any]:
    connection = get_or_404(ctx.session, MetaConnection, connection_id, ctx.workspace_id, label="Meta connection")
    provider = _provider_for(connection)
    check = provider.check_capability()
    connection.capabilities_json = {
        "list_business_managers": check.list_business_managers,
        "create_ad_account": check.create_ad_account,
        "share_ad_account_access": check.share_ad_account_access,
        "share_pixel_access": check.share_pixel_access,
        "reason": check.reason.value if check.reason else None,
    }
    connection.business_managers_json = provider.list_business_managers() if check.list_business_managers else []
    connection.last_capability_check_at = datetime.now(UTC)
    ctx.session.flush()
    ctx.audit.record(
        action="meta_connection.capability_checked",
        entity_type="meta_connection",
        entity_id=connection.id,
        after={"capabilities": connection.capabilities_json},
    )
    ctx.commit()
    return _serialize_connection(connection)


@connections_router.post("/{connection_id}/discoveries", status_code=201)
def run_discovery(ctx: OwnerCtx, connection_id: uuid.UUID) -> dict[str, Any]:
    """Read the configured Business Manager, then its ad accounts and Pixels. Read-only.

    Only ever runs because an operator asked: there is no timer, no page-load trigger and no
    retry, so every call against a real Business Manager's rate-limit budget is one a person
    chose to spend.
    """
    connection = get_or_404(ctx.session, MetaConnection, connection_id, ctx.workspace_id, label="Meta connection")
    service = _discovery_service(ctx, connection)

    run = service.validate_configured_business_manager(connection, actor_id=ctx.user.id)
    if run.status == DiscoveryRunStatus.SUCCEEDED:
        # Assets are read only after the configured BM was actually read back. A failed
        # validation stops here with its reason intact rather than producing an inventory that
        # cannot be attributed to anything.
        service.discover_assets(run)

    payload = _serialize_discovery_run(
        run,
        ad_accounts=service.reconcile_ad_accounts(run),
        pixels=service.reconcile_pixels(run),
    )
    ctx.commit()
    return payload


@connections_router.get("/{connection_id}/discoveries/latest")
def latest_discovery(ctx: OwnerCtx, connection_id: uuid.UUID) -> dict[str, Any] | None:
    """The most recent run, with reconciliation recomputed against the registry as it is now.

    Recomputed rather than stored: the registry changes between runs, and a cached comparison
    would keep asserting a relationship that no longer holds. Reading this makes no provider
    call at all.
    """
    connection = get_or_404(ctx.session, MetaConnection, connection_id, ctx.workspace_id, label="Meta connection")
    run = ctx.session.execute(
        sa.select(BusinessManagerDiscoveryRun)
        .where(
            BusinessManagerDiscoveryRun.workspace_id == ctx.workspace_id,
            BusinessManagerDiscoveryRun.meta_connection_id == connection.id,
            BusinessManagerDiscoveryRun.archived_at.is_(None),
        )
        .order_by(BusinessManagerDiscoveryRun.started_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if run is None:
        return None

    service = _discovery_service(ctx, connection)
    return _serialize_discovery_run(
        run,
        ad_accounts=service.reconcile_ad_accounts(run),
        pixels=service.reconcile_pixels(run),
    )


# ------------------------------------------------------------------------- Account creation

creation_router = APIRouter(prefix="/account-creation-batches", tags=["meta-operations"])


def _serialize_creation_detail(service: AccountCreationBatchService, batch: AccountCreationBatch) -> dict[str, Any]:
    preview = service.preview(batch)
    return {
        "batch": s.AccountCreationBatchOut.model_validate(batch).model_dump(),
        "items": [s.AccountCreationItemOut.model_validate(item).model_dump() for item in preview["items"]],
        "current_preview_hash": preview["preview_hash"],
    }


@creation_router.post("", status_code=201)
def draft_creation_batch(ctx: OwnerCtx, payload: s.AccountCreationDraftRequest) -> dict[str, Any]:
    service = AccountCreationBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    batch = service.create_draft(
        meta_connection_id=payload.meta_connection_id,
        business_manager_external_id=payload.business_manager_external_id,
        items=[
            DraftAccountItem(
                name=i.name,
                currency=i.currency,
                country=i.country,
                timezone=i.timezone,
                timezone_id=i.timezone_id,
            )
            for i in payload.items
        ],
    )
    ctx.commit()
    return _serialize_creation_detail(service, batch)


@creation_router.get("/{batch_id}")
def get_creation_batch(ctx: OwnerCtx, batch_id: uuid.UUID) -> dict[str, Any]:
    service = AccountCreationBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    return _serialize_creation_detail(service, service.get(batch_id))


@creation_router.post("/{batch_id}/confirm")
def confirm_creation_batch(ctx: OwnerCtx, batch_id: uuid.UUID, payload: s.ConfirmBatchRequest) -> dict[str, Any]:
    service = AccountCreationBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    batch = service.confirm(service.get(batch_id), preview_hash=payload.preview_hash)
    ctx.commit()
    return _serialize_creation_detail(service, batch)


@creation_router.post("/{batch_id}/run")
def run_creation_batch(ctx: OwnerCtx, batch_id: uuid.UUID) -> dict[str, Any]:
    service = AccountCreationBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    batch = service.get(batch_id)
    connection = get_or_404(
        ctx.session, MetaConnection, batch.meta_connection_id, ctx.workspace_id, label="Meta connection"
    )
    batch = service.run(batch, _provider_for(connection))
    ctx.commit()
    return _serialize_creation_detail(service, batch)


@creation_router.post("/items/{item_id}/reconcile")
def reconcile_creation_item(ctx: OwnerCtx, item_id: uuid.UUID) -> dict[str, Any]:
    service = AccountCreationBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    item = service.get_item(item_id)
    batch = service.get(item.batch_id)
    connection = get_or_404(
        ctx.session, MetaConnection, batch.meta_connection_id, ctx.workspace_id, label="Meta connection"
    )
    item = service.reconcile(item, _provider_for(connection))
    ctx.commit()
    return s.AccountCreationItemOut.model_validate(item).model_dump()


# ------------------------------------------------------------------------- Access share

share_router = APIRouter(prefix="/access-share-batches", tags=["meta-operations"])


def _serialize_share_detail(service: AccessShareBatchService, batch: AccessShareBatch) -> dict[str, Any]:
    preview = service.preview(batch)
    return {
        "batch": s.AccessShareBatchOut.model_validate(batch).model_dump(),
        "items": [s.AccessShareItemOut.model_validate(item).model_dump() for item in preview["items"]],
        "current_preview_hash": preview["preview_hash"],
    }


@share_router.post("", status_code=201)
def draft_share_batch(ctx: OwnerCtx, payload: s.AccessShareDraftRequest) -> dict[str, Any]:
    service = AccessShareBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    batch = service.create_draft(
        meta_connection_id=payload.meta_connection_id,
        items=[
            DraftShareItem(
                source_external_account_id=i.source_external_account_id,
                recipient_reference=i.recipient_reference,
                role=i.role,
            )
            for i in payload.items
        ],
    )
    ctx.commit()
    return _serialize_share_detail(service, batch)


@share_router.get("/{batch_id}")
def get_share_batch(ctx: OwnerCtx, batch_id: uuid.UUID) -> dict[str, Any]:
    service = AccessShareBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    return _serialize_share_detail(service, service.get(batch_id))


@share_router.post("/{batch_id}/confirm")
def confirm_share_batch(ctx: OwnerCtx, batch_id: uuid.UUID, payload: s.ConfirmBatchRequest) -> dict[str, Any]:
    service = AccessShareBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    batch = service.confirm(service.get(batch_id), preview_hash=payload.preview_hash)
    ctx.commit()
    return _serialize_share_detail(service, batch)


@share_router.post("/{batch_id}/run")
def run_share_batch(ctx: OwnerCtx, batch_id: uuid.UUID) -> dict[str, Any]:
    service = AccessShareBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    batch = service.get(batch_id)
    connection = get_or_404(
        ctx.session, MetaConnection, batch.meta_connection_id, ctx.workspace_id, label="Meta connection"
    )
    batch = service.run(batch, _provider_for(connection))
    ctx.commit()
    return _serialize_share_detail(service, batch)


# ------------------------------------------------------------------------- Pixel share (A8)

pixel_share_router = APIRouter(prefix="/pixel-share-batches", tags=["meta-operations"])


def _serialize_pixel_share_detail(service: PixelShareBatchService, batch: PixelShareBatch) -> dict[str, Any]:
    preview = service.preview(batch)
    return {
        "batch": s.PixelShareBatchOut.model_validate(batch).model_dump(),
        "items": [s.PixelShareItemOut.model_validate(item).model_dump() for item in preview["items"]],
        "current_preview_hash": preview["preview_hash"],
    }


@pixel_share_router.post("", status_code=201)
def draft_pixel_share_batch(ctx: OwnerCtx, payload: s.PixelShareDraftRequest) -> dict[str, Any]:
    service = PixelShareBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    batch = service.create_draft(
        meta_connection_id=payload.meta_connection_id,
        items=[
            DraftPixelShareItem(
                source_external_pixel_id=i.source_external_pixel_id,
                target_ad_account_external_id=i.target_ad_account_external_id,
            )
            for i in payload.items
        ],
    )
    ctx.commit()
    return _serialize_pixel_share_detail(service, batch)


@pixel_share_router.get("/{batch_id}")
def get_pixel_share_batch(ctx: OwnerCtx, batch_id: uuid.UUID) -> dict[str, Any]:
    service = PixelShareBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    return _serialize_pixel_share_detail(service, service.get(batch_id))


@pixel_share_router.post("/{batch_id}/confirm")
def confirm_pixel_share_batch(ctx: OwnerCtx, batch_id: uuid.UUID, payload: s.ConfirmBatchRequest) -> dict[str, Any]:
    service = PixelShareBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    batch = service.confirm(service.get(batch_id), preview_hash=payload.preview_hash)
    ctx.commit()
    return _serialize_pixel_share_detail(service, batch)


@pixel_share_router.post("/{batch_id}/run")
def run_pixel_share_batch(ctx: OwnerCtx, batch_id: uuid.UUID) -> dict[str, Any]:
    service = PixelShareBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    batch = service.get(batch_id)
    connection = get_or_404(
        ctx.session, MetaConnection, batch.meta_connection_id, ctx.workspace_id, label="Meta connection"
    )
    batch = service.run(batch, _provider_for(connection))
    ctx.commit()
    return _serialize_pixel_share_detail(service, batch)


router.include_router(connections_router)
router.include_router(creation_router)
router.include_router(share_router)
router.include_router(pixel_share_router)
