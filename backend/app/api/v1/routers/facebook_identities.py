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
