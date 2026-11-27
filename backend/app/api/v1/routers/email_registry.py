"""P1 routes: cache prevention also covers dependency/validation/domain failures."""

from __future__ import annotations

import re
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from app.api.deps import ApiContext, get_email_registry_context
from app.core.config import get_settings
from app.core.errors import DomainError, ValidationError, error_payload
from app.schemas import email_registry as s
from app.schemas.common import Page, StrictPayload
from app.schemas.facebook_identities import RevealEmailRequest
from app.services.email_registry import EmailRegistryService

Ctx = Annotated[ApiContext, Depends(get_email_registry_context)]


class PrivateRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request):
            try:
                result = await original(request)
            except DomainError as exc:
                result = JSONResponse(
                    status_code=exc.status_code,
                    content=error_payload(
                        exc.code, exc.message, {} if isinstance(exc, ValidationError) else exc.details
                    ),
                )
            except RequestValidationError:
                result = JSONResponse(
                    status_code=422,
                    content=error_payload("validation_error", "Request payload is not valid."),
                )
            except Exception:
                # No exception text/request data is returned or logged here. Dependency
                # session cleanup rolls back any uncommitted work.
                result = JSONResponse(
                    status_code=503,
                    content=error_payload(
                        "registry_unavailable", "Registry operation could not be completed."
                    ),
                )
            result.headers["Cache-Control"] = "no-store"
            return result

        return handler


router = APIRouter(prefix="/email-registry", tags=["email-registry"], route_class=PrivateRoute)


def service(ctx):
    return EmailRegistryService(ctx, get_settings())


def version(value):
    if value is None:
        return None
    if not re.fullmatch(r'"[1-9][0-9]{0,18}"', value):
        raise ValidationError("If-Match must contain one quoted positive version.")
    return int(value[1:-1])


def detail_response(response, result):
    response.headers["ETag"] = '"' + str(result["version"]) + '"'
    return result


def allowed_query(request, allowed):
    if set(request.query_params) - set(allowed) or any(
        len(request.query_params.getlist(k)) != 1 for k in request.query_params
    ):
        raise ValidationError("Unknown or repeated query parameter.")


@router.post("", status_code=201, response_model=s.DetailOut)
def create(ctx: Ctx, payload: s.Create, response: Response):
    return detail_response(response, service(ctx).create(payload))


@router.get("", response_model=Page[s.ListOut])
def listing(
    ctx: Ctx,
    request: Request,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
    provider: s.Provider | None = None,
    account_kind: s.Kind | None = None,
    state: s.State | None = None,
    responsible_member_id: uuid.UUID | None = None,
    archived: Literal["exclude", "only", "all"] = "exclude",
    overdue: bool | None = None,
    attention: bool | None = None,
):
    allowed_query(
        request,
        {
            "page",
            "page_size",
            "provider",
            "account_kind",
            "state",
            "responsible_member_id",
            "archived",
            "overdue",
            "attention",
        },
    )
    return service(ctx).listing(
        {
            "page": page,
            "page_size": page_size,
            "provider": provider,
            "account_kind": account_kind,
            "state": state,
            "responsible_member_id": responsible_member_id,
            "archived": archived,
            "overdue": overdue,
            "attention": attention,
        }
    )


@router.get("/eligible-members", response_model=list[s.EligibleMemberOut])
def eligible_members(ctx: Ctx, request: Request):
    allowed_query(request, set())
    return service(ctx).eligible_members()


@router.get("/reminder-policy", response_model=s.ReminderPolicy)
def reminder_policy(ctx: Ctx, request: Request):
    allowed_query(request, set())
    return service(ctx).reminder_policy()


@router.patch("/reminder-policy", response_model=s.ReminderPolicy)
def update_reminder_policy(ctx: Ctx, request: Request, payload: s.ReminderPolicy):
    allowed_query(request, set())
    return service(ctx).reminder_policy(payload)


@router.get("/{entry_id}", response_model=s.DetailOut)
def detail(ctx: Ctx, entry_id: uuid.UUID, response: Response):
    return detail_response(response, service(ctx).detail(entry_id))


@router.patch("/{entry_id}", response_model=s.DetailOut)
def patch(
    ctx: Ctx,
    entry_id: uuid.UUID,
    payload: s.Patch,
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
):
    return detail_response(response, service(ctx).mutate(entry_id, payload, version(if_match)))


@router.post("/{entry_id}/reassign", response_model=s.DetailOut)
def reassign(
    ctx: Ctx,
    entry_id: uuid.UUID,
    payload: s.Reassign,
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
):
    return detail_response(
        response, service(ctx).mutate(entry_id, payload, version(if_match), action="reassigned")
    )


@router.post("/{entry_id}/archive", response_model=s.DetailOut)
def archive(
    ctx: Ctx,
    entry_id: uuid.UUID,
    payload: StrictPayload,
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
):
    return detail_response(
        response, service(ctx).mutate(entry_id, payload, version(if_match), action="archived")
    )


@router.post("/{entry_id}/reveal-address", response_model=s.RevealOut)
def reveal(ctx: Ctx, entry_id: uuid.UUID, payload: RevealEmailRequest):
    return service(ctx).reveal(entry_id, payload.pin)


@router.get("/{entry_id}/history", response_model=Page[s.HistoryOut])
def history(
    ctx: Ctx,
    entry_id: uuid.UUID,
    request: Request,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
):
    allowed_query(request, {"page", "page_size"})
    return service(ctx).history(entry_id, page, page_size)
