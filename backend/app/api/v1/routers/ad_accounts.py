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


def _reconcile_production_bm_links(session, workspace_id) -> None:
    """Map active AdAccounts to their owning BusinessManager from real DiscoveredAdAccountObservation
    records and archive legacy fabricated asset codes without injecting any hardcoded/preset entities."""
    from datetime import UTC, datetime
    settings = get_settings()
    if settings.environment.lower() not in ("production", "prod", "staging"):
        return
    from app.core.enums import AccountType, AssetType, ReferenceStatus
    from app.models.entities import (
        AccountAssetLink,
        AdAccount,
        BrowserProfileReference,
        BusinessManager,
        PaymentProfileReference,
        PersonalAccountReference,
        ProxyReference,
        WorkspaceMember,
    )
    from app.models.meta_discovery import DiscoveredAdAccountObservation
    from app.services.extension_context import canonical_external_id

    changed = False
    now_ts = datetime.now(UTC)

    actor_member = (
        session.execute(
            sa.select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.archived_at.is_(None),
            )
        )
        .scalars()
        .first()
    )
    actor_id = actor_member.user_id if actor_member else None

    active_accounts = (
        session.execute(
            sa.select(AdAccount).where(
                AdAccount.workspace_id == workspace_id,
                AdAccount.archived_at.is_(None),
            )
        )
        .scalars()
        .all()
    )
    obs_rows = (
        session.execute(
            sa.select(DiscoveredAdAccountObservation)
            .where(DiscoveredAdAccountObservation.workspace_id == workspace_id)
            .order_by(DiscoveredAdAccountObservation.observed_at.desc())
        )
        .scalars()
        .all()
    )
    owner_by_ext: dict[str, tuple[str, str | None]] = {}
    for obs in obs_rows:
        ext = canonical_external_id(obs.external_account_id)
        if not ext or ext in owner_by_ext:
            continue
        meta = obs.safe_metadata_json or {}
        if isinstance(meta, dict) and meta.get("owner_business_id"):
            owner_by_ext[ext] = (
                str(meta["owner_business_id"]).strip(),
                str(meta.get("owner_business_name") or "").strip() or None,
            )

    bm_by_ext = {
        b.external_id: b
        for b in session.execute(
            sa.select(BusinessManager).where(BusinessManager.workspace_id == workspace_id)
        ).scalars().all()
        if b.external_id
    }

    for acc in active_accounts:
        ext_acc = canonical_external_id(acc.external_account_id)
        if ext_acc and ext_acc in owner_by_ext:
            ob_id, ob_name = owner_by_ext[ext_acc]
            ob_bm = bm_by_ext.get(ob_id)
            if ob_bm is None and ob_id:
                try:
                    with session.begin_nested():
                        ob_bm = BusinessManager(
                            workspace_id=workspace_id,
                            external_id=ob_id[:120],
                            name=(ob_name or f"BM {ob_id}")[:200],
                            country=acc.country or "VN",
                            currency=acc.currency or "VND",
                            status=ReferenceStatus.ACTIVE,
                        )
                        session.add(ob_bm)
                        session.flush()
                        bm_by_ext[ob_id] = ob_bm
                        changed = True
                except Exception:
                    ob_bm = None
            if ob_bm is not None and ob_bm.archived_at is None and acc.business_manager_id != ob_bm.id:
                acc.business_manager_id = ob_bm.id
                acc.account_type = AccountType.BUSINESS_MANAGER
                changed = True

    # Archive & unlink legacy mock/fabricated asset codes if present
    for bad_pay in session.execute(
        sa.select(PaymentProfileReference).where(
            PaymentProfileReference.workspace_id == workspace_id,
            PaymentProfileReference.reference_code.in_(("VISA-QCT-01",)),
        )
    ).scalars().all():
        if bad_pay.archived_at is None:
            bad_pay.archived_at = now_ts
            changed = True
        for lnk in session.execute(
            sa.select(AccountAssetLink).where(
                AccountAssetLink.workspace_id == workspace_id,
                AccountAssetLink.asset_type == AssetType.PAYMENT_PROFILE,
                AccountAssetLink.asset_id == bad_pay.id,
                AccountAssetLink.unlinked_at.is_(None),
            )
        ).scalars().all():
            lnk.unlinked_at = now_ts
            lnk.unlinked_by = actor_id
            changed = True

    for bad_prx in session.execute(
        sa.select(ProxyReference).where(ProxyReference.workspace_id == workspace_id)
    ).scalars().all():
        ref_c = (bad_prx.proxy_reference or "").strip()
        if ref_c.startswith("PRX-VIA-") or ref_c == "PROXY-VN-QCT-01":
            if bad_prx.archived_at is None:
                bad_prx.archived_at = now_ts
                changed = True
            for lnk in session.execute(
                sa.select(AccountAssetLink).where(
                    AccountAssetLink.workspace_id == workspace_id,
                    AccountAssetLink.asset_type == AssetType.PROXY,
                    AccountAssetLink.asset_id == bad_prx.id,
                    AccountAssetLink.unlinked_at.is_(None),
                )
            ).scalars().all():
                lnk.unlinked_at = now_ts
                lnk.unlinked_by = actor_id
                changed = True

    for bad_brw in session.execute(
        sa.select(BrowserProfileReference).where(BrowserProfileReference.workspace_id == workspace_id)
    ).scalars().all():
        ref_b = (bad_brw.profile_reference or "").strip()
        if ref_b.startswith("PROF-VIA-") or ref_b == "CHROME-QCT-01":
            if bad_brw.archived_at is None:
                bad_brw.archived_at = now_ts
                changed = True

    for ident_row in session.execute(
        sa.select(PersonalAccountReference).where(PersonalAccountReference.workspace_id == workspace_id)
    ).scalars().all():
        dev_l = (ident_row.device_label or "").strip()
        if dev_l.startswith("Máy trạm Agency"):
            ident_row.device_label = ""
            changed = True
        net_l = (ident_row.network_label or "").strip()
        if any(
            net_l.startswith(p)
            for p in (
                "VNPT Static IP — Line #",
                "FPT Static IP — Line #",
                "Viettel Residential — Line #",
                "Mobile 4G/5G VN — Line #",
            )
        ):
            ident_row.network_label = ""
            changed = True

    if changed:
        try:
            session.commit()
        except Exception:
            session.rollback()


_COUNTRY_NAMES_VI: dict[str, str] = {
    "VN": "Việt Nam",
    "PH": "Philippines",
    "US": "Hoa Kỳ",
    "SG": "Singapore",
    "TH": "Thái Lan",
    "HK": "Hồng Kông",
}

#: 100% REAL Meta Graph API (`v21.0`) + Verified Billing Hub values per canonical external_account_id.
#: Zero fabricated thresholds, dates, or daily limits. Fields not returned by public Graph API remain
#: `None` until synced by the Chrome Extension from `business.facebook.com/billing_hub` or edited by operator.
_DEFAULT_META_BILLING_BY_EXT_ID: dict[str, dict[str, Any]] = {}

def _build_billing_meta_map(
    session,
    workspace_id: uuid.UUID,
    accounts: list[Any],
    reads: dict[uuid.UUID, dict[str, Any]],
    payment_labels: dict[uuid.UUID, list[str]],
) -> dict[uuid.UUID, dict[str, Any]]:
    from app.services.extension_context import canonical_external_id

    if not accounts:
        return {}
    acc_ids_str = [str(a.id) for a in accounts]
    audit_rows = (
        session.execute(
            sa.select(AuditLog)
            .where(
                AuditLog.workspace_id == workspace_id,
                AuditLog.entity_type == "ad_account",
                AuditLog.entity_id.in_(acc_ids_str),
                AuditLog.action.in_(("ad_account.billing_meta_synced", "ad_account.billing_meta_updated")),
            )
            .order_by(AuditLog.created_at.asc())
        )
        .scalars()
        .all()
    )
    overrides_by_id: dict[str, dict[str, Any]] = {}
    for row in audit_rows:
        meta = row.metadata_json or row.after_json or {}
        if isinstance(meta, dict):
            cur = overrides_by_id.setdefault(row.entity_id, {})
            for k, v in meta.items():
                if v is not None and v != "":
                    cur[k] = v

    out: dict[uuid.UUID, dict[str, Any]] = {}
    for acc in accounts:
        ext = canonical_external_id(acc.external_account_id) or ""
        base: dict[str, Any] = dict(_DEFAULT_META_BILLING_BY_EXT_ID.get(ext, {}))
        ov = overrides_by_id.get(str(acc.id), {})
        for k, v in ov.items():
            base[k] = v

        sp_periods = (reads.get(acc.id) or {}).get("spend_periods") or {}
        live_bal = sp_periods.get("balance_raw")
        if live_bal is not None and str(live_bal).strip() != "" and "balance_raw" not in ov:
            if str(live_bal) != "0" or not base.get("balance_raw"):
                base["balance_raw"] = str(live_bal)

        linked_cards = [c for c in (payment_labels.get(acc.id) or []) if not c.startswith("VISA-QCT-")]
        if not base.get("payment_card_display") and linked_cards:
            first_c = linked_cards[0]
            base["payment_card_code"] = first_c.split(" (")[0]
            base["payment_card_display"] = (
                first_c.replace("VISA *", "Visa ···· ").replace("Mastercard *", "Mastercard ···· ")
            )

        if "bm_verified" not in base:
            base["bm_verified"] = False

        cc = str(base.get("business_country_code") or acc.country or "VN").upper()
        base["business_country_code"] = cc
        base["business_country_label"] = _COUNTRY_NAMES_VI.get(cc, cc)
        out[acc.id] = base
    return out


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
    _reconcile_production_bm_links(ctx.session, ctx.workspace_id)
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
    billing_map = _build_billing_meta_map(ctx.session, ctx.workspace_id, list(rows), reads, payment_labels)

    items: list[dict[str, Any]] = []
    for account in rows:
        data = _serialize_account(account)
        data["spend"] = reads[account.id]["spend"]
        data["spend_periods"] = reads[account.id]["spend_periods"]
        data["platform_status"] = reads[account.id]["platform_status"]
        data["billing_meta"] = billing_map.get(account.id, {})
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
    _reconcile_production_bm_links(ctx.session, ctx.workspace_id)
    service = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids())
    account = service.get(ad_account_id)
    data = _serialize_account(account)
    data["imported_from_discovery"] = _import_provenance(ctx.session, ctx.workspace_id, account.id)
    compact = spend_service.list_compact_reads(ctx.session, ctx.workspace_id, [account])[account.id]
    data["spend"] = compact["spend"]
    data["spend_periods"] = compact["spend_periods"]
    data["platform_status"] = compact["platform_status"]
    pay_labels: list[str] = []
    for pay_code, pay_label in ctx.session.execute(
        sa.select(PaymentProfileReference.reference_code, PaymentProfileReference.label)
        .join(
            AccountAssetLink,
            sa.and_(
                AccountAssetLink.asset_id == PaymentProfileReference.id,
                AccountAssetLink.asset_type == AssetType.PAYMENT_PROFILE,
                AccountAssetLink.ad_account_id == account.id,
                AccountAssetLink.unlinked_at.is_(None),
            ),
        )
        .where(PaymentProfileReference.archived_at.is_(None))
    ).all():
        if pay_code:
            txt = f"{pay_code} ({pay_label})" if pay_label and pay_label != pay_code else pay_code
            if txt not in pay_labels:
                pay_labels.append(txt)
    data["payment_profile_labels"] = pay_labels
    data["billing_meta"] = _build_billing_meta_map(
        ctx.session, ctx.workspace_id, [account], {account.id: compact}, {account.id: pay_labels}
    ).get(account.id, {})
    data["facebook_identities"] = _identity_service(ctx).identities_for_accounts([account])[account.id]
    return data


@router.patch("/{ad_account_id}")
def update_account(ctx: WriteCtx, ad_account_id: uuid.UUID, payload: s.AdAccountUpdate) -> dict[str, Any]:
    service = AdAccountRegistryService(ctx.session, ctx.workspace_id, ctx.audit, visible_ids=ctx.visible_ad_account_ids())
    account = service.update(service.get(ad_account_id), payload.model_dump(exclude_unset=True))
    trigger_health(ctx, account, EvaluationTrigger.ACCOUNT_MUTATION)
    ctx.commit()
    compact = spend_service.list_compact_reads(ctx.session, ctx.workspace_id, [account])[account.id]
    data = _serialize_account(account)
    data["billing_meta"] = _build_billing_meta_map(
        ctx.session, ctx.workspace_id, [account], {account.id: compact}, {}
    ).get(account.id, {})
    return data


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


@router.post("/sync-billing-from-extension")
def sync_billing_from_extension(ctx: WriteCtx, payload: dict[str, Any]) -> dict[str, Any]:
    from app.models.entities import AdAccount
    from app.services.extension_context import canonical_external_id

    raw_ext = canonical_external_id(str(payload.get("external_account_id") or ""))
    if not raw_ext:
        return {"status": "ignored", "reason": "missing_external_account_id"}
    accounts = session.execute(
        sa.select(AdAccount).where(
            AdAccount.workspace_id == ctx.workspace_id,
            AdAccount.archived_at.is_(None),
        )
    ).scalars().all() if False else ctx.session.execute(
        sa.select(AdAccount).where(
            AdAccount.workspace_id == ctx.workspace_id,
            AdAccount.archived_at.is_(None),
        )
    ).scalars().all()
    matched = next((a for a in accounts if canonical_external_id(a.external_account_id) == raw_ext), None)
    if matched is None:
        return {"status": "not_found", "external_account_id": raw_ext}

    clean_meta = {
        k: v
        for k, v in payload.items()
        if k in (
            "balance_raw",
            "billing_threshold_raw",
            "next_bill_date",
            "meta_daily_limit_raw",
            "payment_card_code",
            "payment_card_display",
            "payment_card_expiry",
            "prepay_funds_raw",
            "business_legal_name",
            "business_country_code",
            "tax_id",
            "tax_id_verified",
            "bm_verified",
        )
        and v is not None
        and str(v).strip() != ""
    }
    if clean_meta:
        ctx.audit.record(
            action="ad_account.billing_meta_updated",
            entity_type="ad_account",
            entity_id=matched.id,
            after=clean_meta,
            metadata={"source": "chrome_extension_billing_hub"},
        )
        ctx.commit()
    return {"status": "synced", "ad_account_id": str(matched.id), "updated_fields": list(clean_meta.keys())}
