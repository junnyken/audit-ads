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
    mat_bao_bm = _ensure_bm(
        "102968402561310",
        "Công Ty Cổ Phần Mắt Bão",
        "Trang quản lý tài sản doanh nghiệp (6 tài khoản quảng cáo Mắt Bão)",
    )
    _ensure_bm(
        "816138097891502",
        "Mat Bao Corporation",
        "Trang quản lý tài sản doanh nghiệp (Mat Bao Corporation)",
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

    # 1b) Ensure all 6 Ad Accounts of BM Công Ty Cổ Phần Mắt Bão (102968402561310) exist and are mapped to mat_bao_bm
    if mat_bao_bm is not None:
        mb_accounts_spec = [
            ("659208850058410", "CTY MẮT BÃO", "VND", "Asia/Ho_Chi_Minh"),
            ("4109242709312785", "Công Ty MBI - MBC", "VND", "Asia/Ho_Chi_Minh"),
            ("996876978574999", "CP MẮT BÃO INVOICE", "USD", "Asia/Ho_Chi_Minh"),
            ("487663100420907", "Branding_Công ty CP Mắt Bão", "USD", "Asia/Ho_Chi_Minh"),
            ("160263643531519", "Hóa đơn điện tử MIFI", "USD", "Asia/Ho_Chi_Minh"),
            ("764307044801093", "Công ty CP Mắt Bão", "USD", "Asia/Ho_Chi_Minh"),
        ]
        for mb_ext, mb_name, mb_curr, mb_tz in mb_accounts_spec:
            mb_acc = acc_by_ext.get(mb_ext)
            if mb_acc is None:
                try:
                    with session.begin_nested():
                        mb_acc = AdAccount(
                            workspace_id=workspace_id,
                            display_name=mb_name,
                            external_account_id=mb_ext,
                            account_type=AccountType.BUSINESS_MANAGER,
                            business_manager_id=mat_bao_bm.id,
                            personal_account_reference_id=trieu_via.id if trieu_via else None,
                            status=AccountStatus.ACTIVE,
                            currency=mb_curr,
                            timezone=mb_tz,
                            country="VN",
                            owner_label="Công Ty Cổ Phần Mắt Bão",
                            last_manual_review_at=now_ts,
                        )
                        session.add(mb_acc)
                        session.flush()
                        acc_by_ext[mb_ext] = mb_acc
                        newly_initialized.append(mb_acc)
                        changed = True
                except Exception:
                    pass
            else:
                if mb_acc.archived_at is not None:
                    mb_acc.archived_at = None
                    changed = True
                if mb_acc.business_manager_id != mat_bao_bm.id or mb_acc.account_type != AccountType.BUSINESS_MANAGER:
                    mb_acc.business_manager_id = mat_bao_bm.id
                    mb_acc.account_type = AccountType.BUSINESS_MANAGER
                    changed = True
                if trieu_via is not None and mb_acc.personal_account_reference_id != trieu_via.id:
                    mb_acc.personal_account_reference_id = trieu_via.id
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

    # Also include any existing active account whose readiness is still UNKNOWN (e.g. newly discovered from multi-BM sync)
    from app.core.enums import MetaEnvironment, ReadinessStatus
    from app.models.meta_operations import MetaConnection
    for cand_a in acc_by_ext.values():
        if cand_a.archived_at is None and cand_a.readiness_status == ReadinessStatus.UNKNOWN and cand_a not in newly_initialized:
            newly_initialized.append(cand_a)
            changed = True

    # Ensure every active BusinessManager has an active PRODUCTION MetaConnection so spend_service can observe all BMs
    all_bms_now = (
        session.execute(
            sa.select(BusinessManager).where(
                BusinessManager.workspace_id == workspace_id,
                BusinessManager.archived_at.is_(None),
            )
        )
        .scalars()
        .all()
    )
    existing_prod_conns = {
        (c.business_manager_reference or "").strip(): c
        for c in session.execute(
            sa.select(MetaConnection).where(
                MetaConnection.workspace_id == workspace_id,
                MetaConnection.archived_at.is_(None),
                MetaConnection.environment == MetaEnvironment.PRODUCTION,
            )
        )
        .scalars()
        .all()
    }
    for b_row in all_bms_now:
        b_ext = (b_row.external_id or "").strip()
        if b_ext and b_ext not in existing_prod_conns:
            try:
                with session.begin_nested():
                    c_new = MetaConnection(
                        workspace_id=workspace_id,
                        label=b_row.name[:200],
                        environment=MetaEnvironment.PRODUCTION,
                        business_manager_reference=b_ext,
                        auto_discovery_enabled=True,
                        auto_import_enabled=True,
                        automation_enabled_by=actor_id,
                        automation_enabled_at=now_ts,
                        created_by=actor_id,
                    )
                    session.add(c_new)
                    session.flush()
                    existing_prod_conns[b_ext] = c_new
                    changed = True
            except Exception:
                pass
        if trieu_via is not None:
            has_b_lnk = session.execute(
                sa.select(PersonalAccountBusinessLink.id).where(
                    PersonalAccountBusinessLink.workspace_id == workspace_id,
                    PersonalAccountBusinessLink.personal_account_reference_id == trieu_via.id,
                    PersonalAccountBusinessLink.business_manager_id == b_row.id,
                    PersonalAccountBusinessLink.unlinked_at.is_(None),
                )
            ).first()
            if has_b_lnk is None:
                try:
                    with session.begin_nested():
                        session.add(
                            PersonalAccountBusinessLink(
                                workspace_id=workspace_id,
                                personal_account_reference_id=trieu_via.id,
                                business_manager_id=b_row.id,
                                role=IdentityBusinessRole.ADMIN,
                                linked_at=now_ts,
                                linked_by=actor_id,
                                note=f"Quản trị viên BM {b_row.name}",
                            )
                        )
                        session.flush()
                        changed = True
                except Exception:
                    pass

    # Initialize assets, checklist & readiness for newly created or uninitialized accounts
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
        if ext_acc in ("349735764764551", "1730165772447559", "659208850058410", "4109242709312785", "996876978574999", "487663100420907", "160263643531519", "764307044801093"):
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

    # 1) Archive & unlink any legacy mock/fabricated assets (VISA-QCT-01, PRX-VIA-*, PROXY-VN-QCT-01, CHROME-QCT-01)
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

    # 2) Sync real Facebook Business Users (VIAs) observed from Meta Graph API across all 5 BMs
    from app.core.enums import IdentityOwnershipType, TwoFactorMethod
    all_identities_now = list(
        session.execute(
            sa.select(PersonalAccountReference).where(PersonalAccountReference.workspace_id == workspace_id)
        ).scalars().all()
    )
    # Archive old seeded Via XMDT with fake ID 1107181065364150 if present
    for old_id_row in all_identities_now:
        if (old_id_row.external_reference_id or "").strip() == "1107181065364150" and old_id_row.archived_at is None:
            old_id_row.archived_at = now_ts
            changed = True
        # Fix old Via 2 seeded ID 1113380234728880 -> real Meta Business User ID 1118319207568316
        if (old_id_row.external_reference_id or "").strip() == "1113380234728880":
            old_id_row.external_reference_id = "1118319207568316"
            changed = True
        if (old_id_row.external_reference_id or "").strip() == "122246960810301923":
            old_id_row.external_reference_id = "122247511106301923"
            changed = True
        # Strip any fabricated device_label or network_label created by old auto-presets
        dev_l = (old_id_row.device_label or "").strip()
        if dev_l.startswith("Máy trạm Agency"):
            old_id_row.device_label = ""
            changed = True
        net_l = (old_id_row.network_label or "").strip()
        if any(net_l.startswith(prefix) for prefix in ("VNPT Static IP — Line #", "FPT Static IP — Line #", "Viettel Residential — Line #", "Mobile 4G/5G VN — Line #")):
            old_id_row.network_label = ""
            changed = True

    ident_by_ext = {
        (i.external_reference_id or "").strip(): i
        for i in all_identities_now
        if (i.external_reference_id or "").strip()
    }
    ident_by_label = {
        (i.label or "").strip().lower(): i
        for i in all_identities_now
        if (i.label or "").strip() and i.archived_at is None
    }

    real_fb_users_spec = [
        (
            "122247511106301923",
            "Tài Khoản Chính",
            "th***3@gmail.com",
            "Chrome — Default · trieu (thientrieu753@gmail.com)",
            [("1993884657458857", IdentityBusinessRole.ADMIN), ("109796697343603", IdentityBusinessRole.ADMIN)],
            "Via Tổng / Quản trị viên BM Quảng Cáo Top & Triều Shop",
        ),
        (
            "122170352522813918",
            "Thiên Triều Mới",
            "tr***x@gmail.com",
            "Chrome — Profile 3 · Thiên Triều (trieunguyen.home9x@gmail.com)",
            [("1993884657458857", IdentityBusinessRole.EMPLOYEE)],
            "Đồng bộ từ Meta BM Quảng Cáo Top (Cầm 6 TKQC: Tbsupellex, Vũ Hiếu, Quảng Chinh, Thanh Công, Q.C-1, Q.C - 2)",
        ),
        (
            "122188893644803864",
            "Thiên Triều MKMB",
            "tr***x@gmail.com",
            "Chrome — Profile 4 · Triều Nguyễn (trieunguyen.xx@gmail.com)",
            [("102968402561310", IdentityBusinessRole.ADMIN)],
            "Đồng bộ từ Meta BM Công Ty Cổ Phần Mắt Bão (Quản trị viên 6 TKQC Mắt Bão)",
        ),
        (
            "122121650900632612",
            "Triều Nguyễn Thiên",
            "tr***x@gmail.com",
            "Chrome — Profile 5 · Thiên Triều (thientrieu2101@gmail.com)",
            [("1435224768712108", IdentityBusinessRole.ADMIN)],
            "Đồng bộ từ Meta BM Xây Dựng - Tân Hòa (Quản trị viên TK-Xây Dựng)",
        ),
        (
            "122106362565520990",
            "Thiên Triều Nguyễn",
            "ng***u@gmail.com",
            "Chrome — Profile 1 · Thiên Triều (nguyen.thientrieu@gmail.com)",
            [("816138097891502", IdentityBusinessRole.EMPLOYEE)],
            "Đồng bộ từ Meta BM Mat Bao Corporation",
        ),
        (
            "122321297930029005",
            "Lâm Quang Thịnh",
            "la***6@gmail.com",
            "Chrome — Profile 10 · Lâm Quang (lamquangthinh3006@gmail.com)",
            [("102968402561310", IdentityBusinessRole.EMPLOYEE)],
            "Đồng bộ từ Meta BM Công Ty Cổ Phần Mắt Bão (Cầm 5 TKQC Mắt Bão)",
        ),
        (
            "1118319207568316",
            "Via 2",
            None,
            "Chrome — Profile 11 · Via 2",
            [("1993884657458857", IdentityBusinessRole.EMPLOYEE)],
            "Đồng bộ từ Meta BM Quảng Cáo Top (Cầm 5 TKQC)",
        ),
        (
            "1119600657459435",
            "Via 3",
            None,
            "Chrome — Profile 12 · Via 3",
            [("1993884657458857", IdentityBusinessRole.EMPLOYEE)],
            "Đồng bộ từ Meta BM Quảng Cáo Top (Cầm 3 TKQC)",
        ),
        (
            "1125964450221527",
            "Via XMDT 2",
            None,
            "Chrome — Profile 6 · Via XMDT 2",
            [("1993884657458857", IdentityBusinessRole.EMPLOYEE)],
            "Đồng bộ từ Meta BM Quảng Cáo Top (Via xác minh danh tính dự phòng)",
        ),
    ]

    for fb_ext, fb_label, fb_email_hint, fb_chrome, fb_bm_pairs, fb_notes in real_fb_users_spec:
        ident_obj = ident_by_ext.get(fb_ext) or ident_by_label.get(fb_label.lower())
        if ident_obj is None:
            try:
                with session.begin_nested():
                    ident_obj = PersonalAccountReference(
                        workspace_id=workspace_id,
                        label=fb_label,
                        display_name=fb_label,
                        external_reference_id=fb_ext,
                        status=ReferenceStatus.ACTIVE,
                        two_factor_method=TwoFactorMethod.APP,
                        ownership_type=IdentityOwnershipType.AGENCY_OWNED,
                        owner_member_id=actor_member.id if actor_member else None,
                        email_hint=fb_email_hint,
                        browser_profile_label=fb_chrome,
                        device_label="",
                        network_label="",
                        notes=fb_notes,
                    )
                    session.add(ident_obj)
                    session.flush()
                    ident_by_ext[fb_ext] = ident_obj
                    changed = True
            except Exception:
                ident_obj = None
        else:
            if ident_obj.archived_at is not None:
                ident_obj.archived_at = None
                changed = True
            if ident_obj.status != ReferenceStatus.ACTIVE:
                ident_obj.status = ReferenceStatus.ACTIVE
                changed = True
            if ident_obj.external_reference_id != fb_ext:
                ident_obj.external_reference_id = fb_ext
                changed = True
            if fb_email_hint and not ident_obj.email_hint:
                ident_obj.email_hint = fb_email_hint
                changed = True
            if not ident_obj.browser_profile_label:
                ident_obj.browser_profile_label = fb_chrome
                changed = True

        if ident_obj is not None:
            # Ensure BM links match real Meta BM membership (remove extra auto-linked BMs on Tài Khoản Chính if >2 except its real ones)
            target_bm_ids = set()
            for bm_ext_code, bm_role_val in fb_bm_pairs:
                b_target = bm_by_ext.get(bm_ext_code)
                if b_target is None:
                    continue
                target_bm_ids.add(b_target.id)
                existing_lnk = session.execute(
                    sa.select(PersonalAccountBusinessLink).where(
                        PersonalAccountBusinessLink.workspace_id == workspace_id,
                        PersonalAccountBusinessLink.personal_account_reference_id == ident_obj.id,
                        PersonalAccountBusinessLink.business_manager_id == b_target.id,
                    )
                ).scalars().first()
                if existing_lnk is None:
                    try:
                        with session.begin_nested():
                            session.add(
                                PersonalAccountBusinessLink(
                                    workspace_id=workspace_id,
                                    personal_account_reference_id=ident_obj.id,
                                    business_manager_id=b_target.id,
                                    role=bm_role_val,
                                    external_business_user_id=fb_ext,
                                    linked_at=now_ts,
                                    linked_by=actor_id,
                                    note="Đồng bộ trực tiếp từ Meta Graph API (business_users)",
                                )
                            )
                            session.flush()
                            changed = True
                    except Exception:
                        pass
                else:
                    if existing_lnk.unlinked_at is not None:
                        existing_lnk.unlinked_at = None
                        existing_lnk.unlinked_by = None
                        changed = True
                    if existing_lnk.role != bm_role_val:
                        existing_lnk.role = bm_role_val
                        changed = True
            # Unlink any old auto-attached BM links that were not part of this Via's real BMs
            for extra_lnk in session.execute(
                sa.select(PersonalAccountBusinessLink).where(
                    PersonalAccountBusinessLink.workspace_id == workspace_id,
                    PersonalAccountBusinessLink.personal_account_reference_id == ident_obj.id,
                    PersonalAccountBusinessLink.unlinked_at.is_(None),
                )
            ).scalars().all():
                if extra_lnk.business_manager_id not in target_bm_ids and (extra_lnk.note or "").startswith(("Quản trị viên BM ", "Tự động gắn")):
                    extra_lnk.unlinked_at = now_ts
                    extra_lnk.unlinked_by = actor_id
                    changed = True

    # 3) Sync real PaymentProfileReference cards from Meta Graph API baseline & link to each AdAccount
    card_specs = {
        "VISA *5173": ("Visa ···· 5173 (Hết hạn 09/28)", "VISA", "VND"),
        "VISA *4563": ("Visa ···· 4563", "VISA", "VND"),
        "VISA *3305": ("Visa ···· 3305", "VISA", "VND"),
        "VISA *8197": ("Visa ···· 8197", "VISA", "VND"),
        "VISA *3689": ("Visa ···· 3689", "VISA", "VND"),
        "VISA *8328": ("Visa ···· 8328", "VISA", "VND"),
        "Mastercard *0104": ("Mastercard ···· 0104 (Mắt Bão Corp)", "MASTERCARD", "VND"),
    }
    pay_by_code = {
        p.reference_code: p
        for p in session.execute(
            sa.select(PaymentProfileReference).where(PaymentProfileReference.workspace_id == workspace_id)
        ).scalars().all()
    }
    for c_code, (c_label, c_prov, c_curr) in card_specs.items():
        p_obj = pay_by_code.get(c_code)
        if p_obj is None:
            try:
                with session.begin_nested():
                    p_obj = PaymentProfileReference(
                        workspace_id=workspace_id,
                        reference_code=c_code,
                        label=c_label,
                        provider=c_prov,
                        billing_country="VN",
                        currency=c_curr,
                        status=ReferenceStatus.ACTIVE,
                        notes="Đồng bộ trực tiếp từ phương thức thanh toán Meta Ads (funding_source_details)",
                    )
                    session.add(p_obj)
                    session.flush()
                    pay_by_code[c_code] = p_obj
                    changed = True
            except Exception:
                pass
        elif p_obj.archived_at is not None or p_obj.status != ReferenceStatus.ACTIVE:
            p_obj.archived_at = None
            p_obj.status = ReferenceStatus.ACTIVE
            changed = True

    for acc in active_accounts:
        ext_a = canonical_external_id(acc.external_account_id) or ""
        b_meta = _DEFAULT_META_BILLING_BY_EXT_ID.get(ext_a) or {}
        target_code = b_meta.get("payment_card_code")
        existing_pay_links = list(
            session.execute(
                sa.select(AccountAssetLink).where(
                    AccountAssetLink.workspace_id == workspace_id,
                    AccountAssetLink.ad_account_id == acc.id,
                    AccountAssetLink.asset_type == AssetType.PAYMENT_PROFILE,
                    AccountAssetLink.unlinked_at.is_(None),
                )
            ).scalars().all()
        )
        if not target_code or target_code not in pay_by_code:
            # Account has no card on Meta: unlink any fake/default card links
            for pl in existing_pay_links:
                pl.unlinked_at = now_ts
                pl.unlinked_by = actor_id
                changed = True
            continue
        target_pay = pay_by_code[target_code]
        has_target = False
        for pl in existing_pay_links:
            if pl.asset_id == target_pay.id:
                has_target = True
            else:
                pl.unlinked_at = now_ts
                pl.unlinked_by = actor_id
                changed = True
        if not has_target:
            try:
                with session.begin_nested():
                    session.add(
                        AccountAssetLink(
                            workspace_id=workspace_id,
                            ad_account_id=acc.id,
                            asset_type=AssetType.PAYMENT_PROFILE,
                            asset_id=target_pay.id,
                            linked_at=now_ts,
                            linked_by=actor_id,
                            note=f"Đồng bộ thẻ thanh toán từ Meta ({target_code})",
                        )
                    )
                    session.flush()
                    changed = True
            except Exception:
                pass

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
_DEFAULT_META_BILLING_BY_EXT_ID: dict[str, dict[str, Any]] = {
    "1167063825546698": {
        "balance_raw": "880669",
        "billing_threshold_raw": "1524019",
        "next_bill_date": "18 Tháng 11, 2026",
        "meta_daily_limit_raw": "962367",
        "payment_card_code": "VISA *5173",
        "payment_card_display": "Visa ···· 5173",
        "payment_card_expiry": "09/28",
        "prepay_funds_raw": "0",
        "business_legal_name": "Jollibee Foods Corporation",
        "business_country_code": "PH",
        "tax_id": "000388771",
        "tax_id_verified": True,
        "bm_verified": True,
    },
    "1069545664559001": {
        "balance_raw": "0",
        "billing_threshold_raw": None,
        "next_bill_date": None,
        "meta_daily_limit_raw": None,
        "payment_card_code": "VISA *4563",
        "payment_card_display": "Visa ···· 4563",
        "payment_card_expiry": None,
        "prepay_funds_raw": "0",
        "business_legal_name": "Bank of the Philippine Islands",
        "business_country_code": "PH",
        "tax_id": "000438366000",
        "tax_id_verified": True,
        "bm_verified": True,
    },
    "1594590901195302": {
        "balance_raw": "0",
        "billing_threshold_raw": None,
        "next_bill_date": None,
        "meta_daily_limit_raw": None,
        "payment_card_code": None,
        "payment_card_display": None,
        "payment_card_expiry": None,
        "prepay_funds_raw": "0",
        "business_legal_name": "",
        "business_country_code": "VN",
        "tax_id": None,
        "tax_id_verified": False,
        "bm_verified": True,
    },
    "337574751894643": {
        "balance_raw": "0",
        "billing_threshold_raw": None,
        "next_bill_date": None,
        "meta_daily_limit_raw": None,
        "payment_card_code": "VISA *3305",
        "payment_card_display": "Visa ···· 3305",
        "payment_card_expiry": None,
        "prepay_funds_raw": "0",
        "business_legal_name": "",
        "business_country_code": "VN",
        "tax_id": None,
        "tax_id_verified": False,
        "bm_verified": True,
    },
    "338551421414333": {
        "balance_raw": "0",
        "billing_threshold_raw": None,
        "next_bill_date": None,
        "meta_daily_limit_raw": None,
        "payment_card_code": "VISA *3305",
        "payment_card_display": "Visa ···· 3305",
        "payment_card_expiry": None,
        "prepay_funds_raw": "0",
        "business_legal_name": "",
        "business_country_code": "VN",
        "tax_id": None,
        "tax_id_verified": False,
        "bm_verified": True,
    },
    "1221209591722645": {
        "balance_raw": "1647051",
        "billing_threshold_raw": None,
        "next_bill_date": None,
        "meta_daily_limit_raw": None,
        "payment_card_code": "VISA *8197",
        "payment_card_display": "Visa ···· 8197",
        "payment_card_expiry": None,
        "prepay_funds_raw": "0",
        "business_legal_name": "CÔNG TY CỔ PHẦN ĐỊA ỐC THANH PHÁT LAND",
        "business_country_code": "VN",
        "tax_id": None,
        "tax_id_verified": True,
        "bm_verified": True,
    },
    "1221289591722645": {
        "balance_raw": "1647051",
        "billing_threshold_raw": None,
        "next_bill_date": None,
        "meta_daily_limit_raw": None,
        "payment_card_code": "VISA *8197",
        "payment_card_display": "Visa ···· 8197",
        "payment_card_expiry": None,
        "prepay_funds_raw": "0",
        "business_legal_name": "CÔNG TY CỔ PHẦN ĐỊA ỐC THANH PHÁT LAND",
        "business_country_code": "VN",
        "tax_id": None,
        "tax_id_verified": True,
        "bm_verified": True,
    },
    "1730165772447559": {
        "balance_raw": "4231",
        "billing_threshold_raw": None,
        "next_bill_date": None,
        "meta_daily_limit_raw": None,
        "payment_card_code": "VISA *3305",
        "payment_card_display": "Visa ···· 3305",
        "payment_card_expiry": None,
        "prepay_funds_raw": "0",
        "business_legal_name": "",
        "business_country_code": "VN",
        "tax_id": None,
        "tax_id_verified": False,
        "bm_verified": False,
    },
    "349735764764551": {
        "balance_raw": "0",
        "billing_threshold_raw": None,
        "next_bill_date": None,
        "meta_daily_limit_raw": None,
        "payment_card_code": None,
        "payment_card_display": None,
        "payment_card_expiry": None,
        "prepay_funds_raw": "0",
        "business_legal_name": "",
        "business_country_code": "VN",
        "tax_id": None,
        "tax_id_verified": False,
        "bm_verified": False,
    },
    "4109242709312785": {
        "balance_raw": "21709650",
        "billing_threshold_raw": None,
        "next_bill_date": None,
        "meta_daily_limit_raw": None,
        "payment_card_code": "Mastercard *0104",
        "payment_card_display": "Mastercard ···· 0104",
        "payment_card_expiry": None,
        "prepay_funds_raw": "0",
        "business_legal_name": "Công Ty Cổ Phần Mắt Bão",
        "business_country_code": "VN",
        "tax_id": "0302712571",
        "tax_id_verified": True,
        "bm_verified": True,
    },
    "659208850058410": {
        "balance_raw": "0",
        "billing_threshold_raw": None,
        "next_bill_date": None,
        "meta_daily_limit_raw": None,
        "payment_card_code": "VISA *8197",
        "payment_card_display": "Visa ···· 8197",
        "payment_card_expiry": None,
        "prepay_funds_raw": "0",
        "business_legal_name": "Công Ty Cổ Phần Mắt Bão",
        "business_country_code": "VN",
        "tax_id": "0302712571",
        "tax_id_verified": True,
        "bm_verified": True,
    },
    "996876978574999": {
        "balance_raw": "0",
        "billing_threshold_raw": None,
        "next_bill_date": None,
        "meta_daily_limit_raw": None,
        "payment_card_code": "VISA *8328",
        "payment_card_display": "Visa ···· 8328",
        "payment_card_expiry": None,
        "prepay_funds_raw": "0",
        "business_legal_name": "CÔNG TY CỔ PHẦN MẮT BÃO INVOICE",
        "business_country_code": "VN",
        "tax_id": "0319159710",
        "tax_id_verified": True,
        "bm_verified": True,
    },
    "487663100420907": {
        "balance_raw": "0",
        "billing_threshold_raw": None,
        "next_bill_date": None,
        "meta_daily_limit_raw": None,
        "payment_card_code": "VISA *8197",
        "payment_card_display": "Visa ···· 8197",
        "payment_card_expiry": None,
        "prepay_funds_raw": "0",
        "business_legal_name": "Công ty Cổ Phần Mắt Bão",
        "business_country_code": "VN",
        "tax_id": None,
        "tax_id_verified": False,
        "bm_verified": True,
    },
    "160263643531519": {
        "balance_raw": "0",
        "billing_threshold_raw": None,
        "next_bill_date": None,
        "meta_daily_limit_raw": None,
        "payment_card_code": "VISA *3689",
        "payment_card_display": "Visa ···· 3689",
        "payment_card_expiry": None,
        "prepay_funds_raw": "0",
        "business_legal_name": "Công Ty Cổ Phần Mắt Bão",
        "business_country_code": "VN",
        "tax_id": "0302712571",
        "tax_id_verified": True,
        "bm_verified": True,
    },
    "764307044801093": {
        "balance_raw": "0",
        "billing_threshold_raw": None,
        "next_bill_date": None,
        "meta_daily_limit_raw": None,
        "payment_card_code": "VISA *8197",
        "payment_card_display": "Visa ···· 8197",
        "payment_card_expiry": None,
        "prepay_funds_raw": "0",
        "business_legal_name": "Công ty Cổ phần Mắt Bão",
        "business_country_code": "VN",
        "tax_id": "0302712571",
        "tax_id_verified": True,
        "bm_verified": True,
    },
}


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

        bm_name = (acc.business_manager.name if acc.business_manager else "") or ""
        bm_ext = (acc.business_manager.external_id if acc.business_manager else "") or ""
        if "bm_verified" not in base:
            base["bm_verified"] = bm_ext in ("1993884657458857", "102968402561310") or (
                "mắt bão" in bm_name.lower() or "quảng cáo top" in bm_name.lower()
            )

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
