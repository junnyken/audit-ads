"""Reference resources: BMs, personal-account references, Pages, Pixels, payment, browser and
proxy references.

All seven have identical semantics, so the router is generated from one factory. `DELETE` is
never generated: A1 forbids a hard-delete endpoint, and archive/restore are explicit actions.
"""
# NOTE: `from __future__ import annotations` is deliberately absent. The endpoints below are
# generated inside a factory, so their body/response annotations are closure variables; PEP 563
# string annotations would leave FastAPI unable to resolve them and it would silently treat the
# request body as a query parameter.
import uuid
from typing import Any

from fastapi import APIRouter, Query

from app.api.deps import Ctx, WriteCtx
from app.models.entities import (
    BrowserProfileReference,
    BusinessManager,
    Page,
    PaymentProfileReference,
    PersonalAccountReference,
    Pixel,
    ProxyReference,
)
from app.schemas import registry as s
from app.schemas.common import page_response
from app.services.references import ReferenceService, ReferenceSpec

router = APIRouter(tags=["references"])

SORTABLE = frozenset({"updated_at", "created_at"})


def _mount(
    *,
    path: str,
    spec: ReferenceSpec,
    create_schema: type[Any],
    update_schema: type[Any],
    out_schema: type[Any],
    tag: str,
) -> None:
    def service(ctx) -> ReferenceService:
        return ReferenceService(ctx.session, ctx.workspace_id, ctx.audit, spec)

    @router.get(path, tags=[tag], name=f"list_{spec.entity_type}")
    def _list(
        ctx: Ctx,
        search: str | None = None,
        status: str | None = None,
        archived: bool = False,
        page: int = Query(1, ge=1),
        page_size: int = Query(50, ge=1, le=200),
        sort: str = "updated_at",
        sort_direction: str = Query("desc", pattern="^(asc|desc)$"),
    ) -> dict[str, Any]:
        rows, total = service(ctx).list(
            search=search,
            status=status,
            archived=archived,
            page=page,
            page_size=page_size,
            sort=sort,
            sort_direction=sort_direction,
        )
        return page_response(
            [out_schema.model_validate(row) for row in rows],
            page=page,
            page_size=page_size,
            total=total,
        )

    @router.post(path, tags=[tag], status_code=201, response_model=out_schema, name=f"create_{spec.entity_type}")
    def _create(ctx: WriteCtx, payload: create_schema) -> Any:  # type: ignore[valid-type]
        instance = service(ctx).create(payload.model_dump(exclude_unset=False))
        ctx.commit()
        return out_schema.model_validate(instance)

    @router.get(path + "/{entity_id}", tags=[tag], response_model=out_schema, name=f"get_{spec.entity_type}")
    def _get(ctx: Ctx, entity_id: uuid.UUID) -> Any:
        return out_schema.model_validate(service(ctx).get(entity_id))

    @router.patch(path + "/{entity_id}", tags=[tag], response_model=out_schema, name=f"update_{spec.entity_type}")
    def _update(ctx: WriteCtx, entity_id: uuid.UUID, payload: update_schema) -> Any:  # type: ignore[valid-type]
        svc = service(ctx)
        instance = svc.update(svc.get(entity_id), payload.model_dump(exclude_unset=True))
        ctx.commit()
        return out_schema.model_validate(instance)

    @router.post(path + "/{entity_id}/archive", tags=[tag], response_model=out_schema, name=f"archive_{spec.entity_type}")
    def _archive(ctx: WriteCtx, entity_id: uuid.UUID) -> Any:
        svc = service(ctx)
        instance = svc.archive(svc.get(entity_id))
        ctx.commit()
        return out_schema.model_validate(instance)

    @router.post(path + "/{entity_id}/restore", tags=[tag], response_model=out_schema, name=f"restore_{spec.entity_type}")
    def _restore(ctx: WriteCtx, entity_id: uuid.UUID) -> Any:
        svc = service(ctx)
        instance = svc.restore(svc.get(entity_id))
        ctx.commit()
        return out_schema.model_validate(instance)


_mount(
    path="/business-managers",
    spec=ReferenceSpec(
        model=BusinessManager,
        entity_type="business_manager",
        label="Business Manager",
        search_fields=("name", "external_id", "notes"),
        unique_fields=(("external_id",),),
        sortable=SORTABLE | {"name"},
    ),
    create_schema=s.BusinessManagerCreate,
    update_schema=s.BusinessManagerUpdate,
    out_schema=s.BusinessManagerOut,
    tag="business-managers",
)

_mount(
    path="/personal-account-references",
    spec=ReferenceSpec(
        model=PersonalAccountReference,
        entity_type="personal_account_reference",
        label="Personal account reference",
        search_fields=("label", "display_name", "external_reference_id", "notes"),
        unique_fields=(("external_reference_id",),),
        sortable=SORTABLE | {"label"},
    ),
    create_schema=s.PersonalAccountReferenceCreate,
    update_schema=s.PersonalAccountReferenceUpdate,
    out_schema=s.PersonalAccountReferenceOut,
    tag="personal-account-references",
)

_mount(
    path="/pages",
    spec=ReferenceSpec(
        model=Page,
        entity_type="page",
        label="Page",
        search_fields=("name", "external_page_id", "url", "notes"),
        unique_fields=(("external_page_id",),),
        sortable=SORTABLE | {"name"},
    ),
    create_schema=s.PageCreate,
    update_schema=s.PageUpdate,
    out_schema=s.PageOut,
    tag="pages",
)

_mount(
    path="/pixels",
    spec=ReferenceSpec(
        model=Pixel,
        entity_type="pixel",
        label="Pixel",
        search_fields=("name", "external_pixel_id", "notes"),
        unique_fields=(("external_pixel_id",),),
        sortable=SORTABLE | {"name"},
    ),
    create_schema=s.PixelCreate,
    update_schema=s.PixelUpdate,
    out_schema=s.PixelOut,
    tag="pixels",
)

_mount(
    path="/payment-profile-references",
    spec=ReferenceSpec(
        model=PaymentProfileReference,
        entity_type="payment_profile_reference",
        label="Payment profile reference",
        search_fields=("reference_code", "label", "provider", "notes"),
        unique_fields=(("reference_code",),),
        sortable=SORTABLE | {"reference_code"},
    ),
    create_schema=s.PaymentProfileReferenceCreate,
    update_schema=s.PaymentProfileReferenceUpdate,
    out_schema=s.PaymentProfileReferenceOut,
    tag="payment-profile-references",
)

_mount(
    path="/browser-profile-references",
    spec=ReferenceSpec(
        model=BrowserProfileReference,
        entity_type="browser_profile_reference",
        label="Browser profile reference",
        search_fields=("profile_reference", "label", "provider", "notes"),
        unique_fields=(("provider", "profile_reference"),),
        sortable=SORTABLE | {"profile_reference"},
    ),
    create_schema=s.BrowserProfileReferenceCreate,
    update_schema=s.BrowserProfileReferenceUpdate,
    out_schema=s.BrowserProfileReferenceOut,
    tag="browser-profile-references",
)

_mount(
    path="/proxy-references",
    spec=ReferenceSpec(
        model=ProxyReference,
        entity_type="proxy_reference",
        label="Proxy reference",
        search_fields=("proxy_reference", "label", "provider", "notes"),
        unique_fields=(("provider", "proxy_reference"),),
        sortable=SORTABLE | {"proxy_reference"},
    ),
    create_schema=s.ProxyReferenceCreate,
    update_schema=s.ProxyReferenceUpdate,
    out_schema=s.ProxyReferenceOut,
    tag="proxy-references",
)
