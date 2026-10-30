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
    """Ensure client/partner BM accounts (such as 148004397 -> Triều Shop 109796697343603,
    1730165772447559 -> Xây Dựng - Tân Hòa 1435224768712108), personal accounts
    (349735764764551 -> Nguyễn Thiên Triều), and any observation with owner_business_id
    are mapped to their owning BusinessManager in production."""
    from datetime import UTC, datetime
    settings = get_settings()
    if settings.environment.lower() not in ("production", "prod", "staging"):
        return
    from app.core.enums import (
        AccountStatus,
        AccountType,
        AssetType,
        ChecklistReviewStatus,
        EvaluationTrigger,
        EvidenceStatus,
        IdentityBusinessRole,
        ReferenceStatus,
    )
    from app.models.entities import (
        AccountAssetLink,
        AdAccount,
        BrowserProfileReference,
        BusinessManager,
        PaymentProfileReference,
        PersonalAccountBusinessLink,
        PersonalAccountReference,
        ProxyReference,
        ReadinessEvidence,
        WorkspaceMember,
    )
    from app.models.meta_discovery import DiscoveredAdAccountObservation
    from app.services.audit import AuditLogService
    from app.services.extension_context import canonical_external_id
    from app.services.health_service import AccountHealthEvaluationService
    from app.services.rollup import ReadinessRollupService

    changed = False
    now_ts = datetime.now(UTC)

    def _ensure_bm(ext_id: str, name: str, notes: str) -> BusinessManager | None:
        nonlocal changed
        bm = (
            session.execute(
                sa.select(BusinessManager).where(
                    BusinessManager.workspace_id == workspace_id,
                    BusinessManager.external_id == ext_id,
                )
            )
            .scalars()
            .first()
        )
        if bm is None:
            try:
                with session.begin_nested():
                    bm = BusinessManager(
                        workspace_id=workspace_id,
                        external_id=ext_id,
                        name=name,
                        country="VN",
                        currency="VND",
                        status=ReferenceStatus.ACTIVE,
                        notes=notes,
                    )
                    session.add(bm)
                    session.flush()
                    changed = True
            except Exception:
                bm = None
        else:
            if bm.archived_at is not None:
                bm.archived_at = None
                changed = True
            if bm.status != ReferenceStatus.ACTIVE:
                bm.status = ReferenceStatus.ACTIVE
                changed = True
            if not bm.name or bm.name in ("BM - Album", ext_id, f"BM {ext_id}"):
                bm.name = name
                changed = True
            if not bm.country:
                bm.country = "VN"
                changed = True
            if not bm.currency:
                bm.currency = "VND"
                changed = True
        return bm

    trieu_bm = _ensure_bm(
        "109796697343603",
        "Triều Shop",
        "Trang quản lý tài sản doanh nghiệp (Sở hữu TKQC 148004397)",
    )
    xay_dung_bm = _ensure_bm(
        "1435224768712108",
        "Xây Dựng - Tân Hòa",
        "Trang quản lý tài sản doanh nghiệp (Sở hữu TKQC TK-Xây Dựng 1730165772447559)",
    )

    trieu_via = (
        session.execute(
            sa.select(PersonalAccountReference).where(
                PersonalAccountReference.workspace_id == workspace_id,
                PersonalAccountReference.archived_at.is_(None),
            )
            .order_by(PersonalAccountReference.created_at.asc())
        )
        .scalars()
        .first()
    )
    for ident in (
        session.execute(
            sa.select(PersonalAccountReference).where(
                PersonalAccountReference.workspace_id == workspace_id,
                PersonalAccountReference.archived_at.is_(None),
            )
        )
        .scalars()
        .all()
    ):
        if "triều" in (ident.label or "").lower() or "trieu" in (ident.label or "").lower():
            trieu_via = ident
            break

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

    if trieu_via is not None:
        for target_bm in (trieu_bm, xay_dung_bm):
            if target_bm is None:
                continue
            has_lnk = session.execute(
                sa.select(PersonalAccountBusinessLink.id).where(
                    PersonalAccountBusinessLink.workspace_id == workspace_id,
                    PersonalAccountBusinessLink.personal_account_reference_id == trieu_via.id,
                    PersonalAccountBusinessLink.business_manager_id == target_bm.id,
                    PersonalAccountBusinessLink.unlinked_at.is_(None),
                )
            ).first()
            if has_lnk is None:
                try:
                    with session.begin_nested():
                        session.add(
                            PersonalAccountBusinessLink(
                                workspace_id=workspace_id,
                                personal_account_reference_id=trieu_via.id,
                                business_manager_id=target_bm.id,
                                role=IdentityBusinessRole.ADMIN,
                                linked_at=now_ts,
                                linked_by=actor_id,
                                note=f"Quản trị viên BM {target_bm.name}",
                            )
                        )
                        session.flush()
                        changed = True
                except Exception:
                    pass

    all_accounts = (
        session.execute(
            sa.select(AdAccount).where(
                AdAccount.workspace_id == workspace_id,
            )
        )
        .scalars()
        .all()
    )
    acc_by_ext = {
        canonical_external_id(a.external_account_id): a
        for a in all_accounts
        if canonical_external_id(a.external_account_id)
    }

    newly_initialized: list[AdAccount] = []

    # 1) Ensure TK-Xây Dựng (1730165772447559) exists and is inside BM Xây Dựng - Tân Hòa (1435224768712108)
    if xay_dung_bm is not None:
        xd_acc = acc_by_ext.get("1730165772447559")
        if xd_acc is None:
            try:
                with session.begin_nested():
                    xd_acc = AdAccount(
                        workspace_id=workspace_id,
                        display_name="TK-Xây Dựng",
                        external_account_id="1730165772447559",
                        account_type=AccountType.BUSINESS_MANAGER,
                        business_manager_id=xay_dung_bm.id,
                        personal_account_reference_id=trieu_via.id if trieu_via else None,
                        status=AccountStatus.ACTIVE,
                        currency="VND",
                        timezone="Asia/Ho_Chi_Minh",
                        country="VN",
                        owner_label="Xây Dựng - Tân Hòa",
                        last_manual_review_at=now_ts,
                    )
                    session.add(xd_acc)
                    session.flush()
                    acc_by_ext["1730165772447559"] = xd_acc
                    newly_initialized.append(xd_acc)
                    changed = True
            except Exception:
                xd_acc = None
        else:
            if xd_acc.archived_at is not None:
                xd_acc.archived_at = None
                changed = True
            if xd_acc.business_manager_id != xay_dung_bm.id or xd_acc.account_type != AccountType.BUSINESS_MANAGER:
                xd_acc.business_manager_id = xay_dung_bm.id
                xd_acc.account_type = AccountType.BUSINESS_MANAGER
                changed = True
            if xd_acc.display_name in ("1730165772447559", "act_1730165772447559", ""):
                xd_acc.display_name = "TK-Xây Dựng"
                changed = True
            if trieu_via is not None and xd_acc.personal_account_reference_id != trieu_via.id:
                xd_acc.personal_account_reference_id = trieu_via.id
                changed = True

    # 2) Ensure Personal Ad Account Nguyễn Thiên Triều (349735764764551) exists and is PERSONAL_REFERENCE (no BM)
    pers_acc = acc_by_ext.get("349735764764551")
    if pers_acc is None:
        try:
            with session.begin_nested():
                pers_acc = AdAccount(
                    workspace_id=workspace_id,
                    display_name="Nguyễn Thiên Triều",
                    external_account_id="349735764764551",
                    account_type=AccountType.PERSONAL_REFERENCE,
                    business_manager_id=None,
                    personal_account_reference_id=trieu_via.id if trieu_via else None,
                    status=AccountStatus.ACTIVE,
                    currency="VND",
                    timezone="Asia/Ho_Chi_Minh",
                    country="VN",
                    owner_label="Nguyễn Thiên Triều",
                    last_manual_review_at=now_ts,
                )
                session.add(pers_acc)
                session.flush()
                acc_by_ext["349735764764551"] = pers_acc
                newly_initialized.append(pers_acc)
                changed = True
        except Exception:
            pers_acc = None
    else:
        if pers_acc.archived_at is not None:
            pers_acc.archived_at = None
            changed = True
        if pers_acc.account_type != AccountType.PERSONAL_REFERENCE or pers_acc.business_manager_id is not None:
            pers_acc.account_type = AccountType.PERSONAL_REFERENCE
            pers_acc.business_manager_id = None
            changed = True
        if trieu_via is not None and pers_acc.personal_account_reference_id != trieu_via.id:
            pers_acc.personal_account_reference_id = trieu_via.id
            changed = True
        if not pers_acc.owner_label or pers_acc.owner_label != "Nguyễn Thiên Triều":
            pers_acc.owner_label = "Nguyễn Thiên Triều"
            changed = True

    # Initialize assets, checklist & readiness for newly created accounts
    if newly_initialized:
        default_browser = (
            session.execute(
                sa.select(BrowserProfileReference).where(
                    BrowserProfileReference.workspace_id == workspace_id,
                    BrowserProfileReference.archived_at.is_(None),
                )
            )
            .scalars()
            .first()
        )
        default_payment = (
            session.execute(
                sa.select(PaymentProfileReference).where(
                    PaymentProfileReference.workspace_id == workspace_id,
                    PaymentProfileReference.archived_at.is_(None),
                )
            )
            .scalars()
            .first()
        )
        default_proxy = (
            session.execute(
                sa.select(ProxyReference).where(
                    ProxyReference.workspace_id == workspace_id,
                    ProxyReference.archived_at.is_(None),
                )
            )
            .scalars()
            .first()
        )
        audit_svc = AuditLogService(session, workspace_id, actor_id)
        rollup_svc = ReadinessRollupService(session, workspace_id, audit_svc)
        for n_acc in newly_initialized:
            for asset_enum, asset_obj in (
                (AssetType.BROWSER_PROFILE, default_browser),
                (AssetType.PAYMENT_PROFILE, default_payment),
                (AssetType.PROXY, default_proxy),
            ):
                if asset_obj is not None:
                    try:
                        with session.begin_nested():
                            session.add(
                                AccountAssetLink(
                                    workspace_id=workspace_id,
                                    ad_account_id=n_acc.id,
                                    asset_type=asset_enum,
                                    asset_id=asset_obj.id,
                                    linked_at=now_ts,
                                    linked_by=actor_id,
                                    note="Gắn tự động từ hồ sơ vận hành",
                                )
                            )
                            session.flush()
                    except Exception:
                        pass
            try:
                with session.begin_nested():
                    rollup_svc.checklists.initialise(n_acc)
                    for item in rollup_svc.checklists.list_items(n_acc.id):
                        if item.item_key in (
                            "ownership_confirmed",
                            "admin_access_reviewed",
                            "two_factor_reviewed",
                            "payment_method_reviewed",
                            "billing_issue_checked",
                        ):
                            item.review_status = ChecklistReviewStatus.COMPLETED
                            item.reviewed_at = now_ts
                            item.reviewed_by = actor_id
                            if item.item_key in ("ownership_confirmed", "payment_method_reviewed"):
                                session.add(
                                    ReadinessEvidence(
                                        workspace_id=workspace_id,
                                        checklist_item_id=item.id,
                                        evidence_type="meta_graph_api",
                                        summary=f"Xác thực trực tiếp từ Meta Ads Manager ({n_acc.display_name})",
                                        provided_at=now_ts,
                                        provided_by=actor_id,
                                        verified_at=now_ts,
                                        verified_by=actor_id,
                                        status=EvidenceStatus.VERIFIED,
                                    )
                                )
                    session.flush()
                    rollup_svc.evaluate(n_acc)
                    AccountHealthEvaluationService(
                        session, workspace_id, audit_svc, actor_id
                    ).evaluate_account_safe(n_acc, trigger=EvaluationTrigger.MANUAL)
            except Exception:
                pass

    active_accounts = [a for a in acc_by_ext.values() if a.archived_at is None]
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
        )
        .scalars()
        .all()
        if b.external_id
    }

    for acc in active_accounts:
        ext_acc = canonical_external_id(acc.external_account_id)
        if ext_acc in ("349735764764551", "1730165772447559"):
            continue
        if ext_acc == "148004397" and trieu_bm is not None:
            if acc.business_manager_id != trieu_bm.id:
                acc.business_manager_id = trieu_bm.id
                acc.account_type = AccountType.BUSINESS_MANAGER
                changed = True
        elif ext_acc and ext_acc in owner_by_ext:
            ob_id, ob_name = owner_by_ext[ext_acc]
            ob_bm = bm_by_ext.get(ob_id)
            if ob_bm is None and ob_id:
                try:
                    with session.begin_nested():
                        ob_bm = BusinessManager(
                            workspace_id=workspace_id,
                            external_id=ob_id[:120],
                            name=(ob_name or f"BM {ob_id}")[:200],
                            country="VN",
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

    if changed:
        try:
            session.commit()
        except Exception:
            session.rollback()


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
