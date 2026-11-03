"""F1 — Facebook account profiles: Business Manager links, the masked email and its PIN-gated reveal.

The profile's own create/update/archive/restore stay on the generic reference routes
(`/personal-account-references`, `references.py`); this router adds what a generic reference has not.
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter

from app.api.deps import Ctx, OwnerCtx, OwnerOrAdminCtx, WriteCtx
from app.core.config import get_settings
from app.models.entities import User, WorkspaceMember
from app.models.meta_reader_credential import MetaReaderCredential
from app.schemas import facebook_identities as s
from app.services.base import get_or_404, require_active
from app.services.facebook_identities import (
    ENTITY_TYPE,
    FacebookIdentityService,
    PinLockedError,
    PinRejectedError,
    RevealPinService,
)

router = APIRouter(tags=["facebook-accounts"])

PROFILE = "/personal-account-references/{identity_id}"


def _service(ctx) -> FacebookIdentityService:
    return FacebookIdentityService(ctx.session, ctx.workspace_id, ctx.audit, get_settings())


@router.get("/facebook-identities/summary", response_model=list[s.IdentitySummaryOut])
def summary(ctx: Ctx) -> Any:
    return _service(ctx).summary(
        visible_ids=ctx.visible_ad_account_ids(), visible_bm_ids=ctx.visible_business_manager_ids()
    )


@router.get(PROFILE + "/profile", response_model=s.IdentityProfileOut)
def profile(ctx: Ctx, identity_id: uuid.UUID) -> Any:
    service = _service(ctx)
    identity = service.get(identity_id)
    accounts = service.ad_accounts(identity.id, visible_ids=ctx.visible_ad_account_ids())
    names = service._member_names([identity.owner_member_id] if identity.owner_member_id else [])
    return {
        "business_links": service.business_links(identity.id, visible_bm_ids=ctx.visible_business_manager_ids()),
        "ad_accounts": [
            {
                "id": a.id,
                "display_name": a.display_name,
                "external_account_id": a.external_account_id,
                "business_manager_id": a.business_manager_id,
                "status": a.status.value,
            }
            for a in accounts
        ],
        "readers": service.reader_credentials(identity.id),
        "owner_member_name": names.get(identity.owner_member_id),
        "has_full_email": identity.email_ciphertext is not None,
        "can_reveal_email": service.can_reveal(identity, ctx.membership),
        "shared_browser_profile_with": service.environment_collisions(identity)[0],
        "shared_network_with": service.environment_collisions(identity)[1],
    }


@router.put(PROFILE + "/email", response_model=s.IdentityEmailOut)
def set_email(ctx: OwnerOrAdminCtx, identity_id: uuid.UUID, payload: s.IdentityEmailUpdate) -> Any:
    service = _service(ctx)
    result = service.set_email(service.get(identity_id), payload.email)
    ctx.commit()
    return result


@router.post(PROFILE + "/reveal-email", response_model=s.RevealEmailOut)
def reveal_email(ctx: Ctx, identity_id: uuid.UUID, payload: s.RevealEmailRequest) -> Any:
    service = _service(ctx)
    identity = service.get(identity_id)
    try:
        email = service.reveal_email(identity, user=ctx.user, membership=ctx.membership, pin=payload.pin)
    except (PinRejectedError, PinLockedError):
        # The failure count and the lock must outlive this request's rollback.
        ctx.commit()
        raise
    ctx.commit()
    return {"email": email}


@router.post(PROFILE + "/business-links", status_code=201, response_model=s.BusinessLinkOut)
def link_business(ctx: WriteCtx, identity_id: uuid.UUID, payload: s.BusinessLinkCreate) -> Any:
    service = _service(ctx)
    identity = service.get(identity_id)
    link = service.link_business(
        identity,
        business_manager_id=payload.business_manager_id,
        role=payload.role,
        note=payload.note,
        actor_id=ctx.actor_id,
        visible_bm_ids=ctx.visible_business_manager_ids(),
    )
    ctx.commit()
    return next(item for item in service.business_links(identity.id) if item["id"] == link.id)


@router.post(PROFILE + "/business-links/{link_id}/unlink", response_model=s.BusinessLinkOut)
def unlink_business(ctx: WriteCtx, identity_id: uuid.UUID, link_id: uuid.UUID) -> Any:
    service = _service(ctx)
    identity = service.get(identity_id)
    link = service.unlink_business(
        identity, link_id, actor_id=ctx.actor_id, visible_bm_ids=ctx.visible_business_manager_ids()
    )
    ctx.commit()
    return next(
        item for item in service.business_links(identity.id, include_inactive=True) if item["id"] == link.id
    )


# ---------------------------------------------------------------------------------- reveal PIN
@router.get("/me/reveal-pin", response_model=s.RevealPinStatusOut)
def pin_status(ctx: Ctx) -> Any:
    return RevealPinService.status(ctx.user)


@router.put("/me/reveal-pin", response_model=s.RevealPinStatusOut)
def set_pin(ctx: Ctx, payload: s.RevealPinSetRequest) -> Any:
    RevealPinService(ctx.session, ctx.audit).set_pin(
        ctx.user, current_password=payload.current_password, new_pin=payload.new_pin
    )
    ctx.commit()
    return RevealPinService.status(ctx.user)


@router.post("/team/members/{member_id}/reveal-pin/clear", response_model=s.RevealPinStatusOut)
def clear_member_pin(ctx: OwnerCtx, member_id: uuid.UUID) -> Any:
    member = get_or_404(ctx.session, WorkspaceMember, member_id, ctx.workspace_id, label="Member")
    user = ctx.session.get(User, member.user_id)
    RevealPinService(ctx.session, ctx.audit).clear(user)
    ctx.commit()
    return RevealPinService.status(user)


# ------------------------------------------------------------------- which account granted a reader
@router.put("/meta-reader-credentials/{reader_id}/facebook-identity", response_model=s.ReaderIdentityAssign)
def assign_reader_identity(ctx: OwnerCtx, reader_id: uuid.UUID, payload: s.ReaderIdentityAssign) -> Any:
    reader = get_or_404(ctx.session, MetaReaderCredential, reader_id, ctx.workspace_id, label="Meta reader")
    target = payload.personal_account_reference_id
    if target is not None:
        require_active(_service(ctx).get(target), label="Facebook account")
    before = reader.personal_account_reference_id
    reader.personal_account_reference_id = target
    ctx.session.flush()
    if before != target:
        ctx.audit.record(
            action="meta_reader.facebook_identity_assigned",
            entity_type="meta_reader",
            entity_id=reader.id,
            before={"personal_account_reference_id": str(before) if before else None},
            after={"personal_account_reference_id": str(target) if target else None},
        )
        if target is not None:
            ctx.audit.record(
                action=f"{ENTITY_TYPE}.reader_assigned",
                entity_type=ENTITY_TYPE,
                entity_id=target,
                metadata={"reader_id": str(reader.id)},
            )
    ctx.commit()
    return {"personal_account_reference_id": target}


@router.post("/facebook-identities/auto-connect-token")
def auto_connect_facebook_token(ctx: WriteCtx, payload: dict[str, Any]) -> dict[str, Any]:
    import json as _json
    import urllib.parse as _urlparse
    import urllib.request as _urlreq
    from datetime import UTC, datetime
    import sqlalchemy as sa
    from app.core.enums import IdentityBusinessRole, IdentityOwnershipType, ReferenceStatus, TwoFactorMethod
    from app.models.entities import BusinessManager, PersonalAccountBusinessLink, PersonalAccountReference, WorkspaceMember

    raw_token = str(payload.get("access_token") or "").strip()
    browser_profile_label = str(payload.get("browser_profile_label") or "").strip()
    network_label = str(payload.get("network_label") or "").strip()

    if not raw_token:
        from app.core.errors import ValidationError
        raise ValidationError("Vui lòng dán Token Facebook (EAAB...) để tự động lấy thông tin tài khoản.")

    def _graph_get(path: str, params: dict[str, str]) -> dict[str, Any]:
        qs = _urlparse.urlencode({**params, "access_token": raw_token})
        url = f"https://graph.facebook.com/v21.0/{path}?{qs}"
        with _urlreq.urlopen(url, timeout=20) as resp:
            return _json.loads(resp.read().decode("utf-8"))

    try:
        me_data = _graph_get("me", {"fields": "id,name,email"})
    except Exception as exc:
        from app.core.errors import ValidationError
        raise ValidationError(f"Token không hợp lệ hoặc đã hết hạn ({type(exc).__name__}).") from None

    fb_id = str(me_data.get("id") or "").strip()
    fb_name = str(me_data.get("name") or fb_id or "Via Facebook").strip()
    fb_email = str(me_data.get("email") or "").strip()

    ident = ctx.session.execute(
        sa.select(PersonalAccountReference).where(
            PersonalAccountReference.workspace_id == ctx.workspace_id,
            sa.or_(
                PersonalAccountReference.external_reference_id == fb_id,
                sa.func.lower(PersonalAccountReference.label) == fb_name.lower(),
            ),
        )
    ).scalars().first()

    owner_member = ctx.session.execute(
        sa.select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == ctx.workspace_id,
            WorkspaceMember.user_id == ctx.user.id,
            WorkspaceMember.archived_at.is_(None),
        )
    ).scalars().first()

    if ident is None:
        ident = PersonalAccountReference(
            workspace_id=ctx.workspace_id,
            label=fb_name[:200],
            display_name=fb_name[:200],
            external_reference_id=fb_id[:120],
            status=ReferenceStatus.ACTIVE,
            two_factor_method=TwoFactorMethod.APP,
            ownership_type=IdentityOwnershipType.AGENCY_OWNED,
            owner_member_id=owner_member.id if owner_member else None,
            browser_profile_label=browser_profile_label[:160],
            network_label=network_label[:160],
            device_label="",
            notes="Kết nối tự động qua Meta Graph API (/me)",
        )
        ctx.session.add(ident)
        ctx.session.flush()
    else:
        ident.archived_at = None
        ident.status = ReferenceStatus.ACTIVE
        ident.display_name = fb_name[:200]
        if fb_id:
            ident.external_reference_id = fb_id[:120]
        if browser_profile_label:
            ident.browser_profile_label = browser_profile_label[:160]
        if network_label:
            ident.network_label = network_label[:160]
        ctx.session.flush()

    if fb_email:
        try:
            _service(ctx).set_email(ident, fb_email)
        except Exception:
            pass

    linked_bms: list[str] = []
    try:
        bms_resp = _graph_get("me/businesses", {"fields": "id,name,permitted_roles", "limit": "50"})
        for b_item in bms_resp.get("data", []) or []:
            b_ext = str(b_item.get("id") or "").strip()
            b_name = str(b_item.get("name") or b_ext).strip()
            if not b_ext:
                continue
            bm_row = ctx.session.execute(
                sa.select(BusinessManager).where(
                    BusinessManager.workspace_id == ctx.workspace_id,
                    BusinessManager.external_id == b_ext,
                )
            ).scalars().first()
            if bm_row is None:
                bm_row = BusinessManager(
                    workspace_id=ctx.workspace_id,
                    external_id=b_ext[:120],
                    name=b_name[:200],
                    country="VN",
                    currency="VND",
                    status=ReferenceStatus.ACTIVE,
                )
                ctx.session.add(bm_row)
                ctx.session.flush()
            else:
                bm_row.archived_at = None
                bm_row.status = ReferenceStatus.ACTIVE

            roles_raw = [str(r).upper() for r in (b_item.get("permitted_roles") or [])]
            role_enum = IdentityBusinessRole.ADMIN if "ADMIN" in roles_raw else IdentityBusinessRole.EMPLOYEE
            existing_lnk = ctx.session.execute(
                sa.select(PersonalAccountBusinessLink).where(
                    PersonalAccountBusinessLink.workspace_id == ctx.workspace_id,
                    PersonalAccountBusinessLink.personal_account_reference_id == ident.id,
                    PersonalAccountBusinessLink.business_manager_id == bm_row.id,
                )
            ).scalars().first()
            if existing_lnk is None:
                ctx.session.add(
                    PersonalAccountBusinessLink(
                        workspace_id=ctx.workspace_id,
                        personal_account_reference_id=ident.id,
                        business_manager_id=bm_row.id,
                        role=role_enum,
                        external_business_user_id=fb_id[:120],
                        linked_at=datetime.now(UTC),
                        linked_by=ctx.user.id,
                        note="Đồng bộ tự động từ Token Via",
                    )
                )
            else:
                existing_lnk.unlinked_at = None
                existing_lnk.role = role_enum
            linked_bms.append(b_name)
    except Exception:
        pass

    ctx.commit()
    return {
        "id": str(ident.id),
        "label": ident.label,
        "external_reference_id": ident.external_reference_id,
        "email_hint": ident.email_hint,
        "linked_business_managers": linked_bms,
    }
