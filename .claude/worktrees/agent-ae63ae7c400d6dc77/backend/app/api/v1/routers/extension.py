"""Chrome extension endpoints (A5).

Three properties hold across every route here:

* the workspace comes from the authenticated membership, never from a payload;
* an extension session can read a summary and write allowlisted events, and nothing else —
  it is refused by every dashboard route;
* nothing accepted or returned is credential-like, and no raw URL is ever stored.

The extension calls no advertising platform and this module reaches none: it reads records this
product already holds.
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter

from app.api.deps import AnyCtx, Ctx, ExtCtx, WriteCtx
from app.core.enums import ExtensionContextStatus
from app.core.errors import NotFoundError
from app.models.entities import AdAccount
from app.schemas import extension as s
from app.services.extension_context import ExtensionContextResolver
from app.services.extension_events import ExtensionEventIngestService, build_source_context
from app.services.extension_session import ExtensionInstallationService, ExtensionSessionService
from app.services.extension_summary import ExtensionSummaryService

router = APIRouter(prefix="/extension", tags=["extension"])

#: One route belongs to the account, not to the extension, so it keeps the account's path.
#: The dashboard uses it to render exactly what the extension would show.
account_router = APIRouter(prefix="/ad-accounts", tags=["extension"])


# ---- session ---------------------------------------------------------------------------


@router.post("/connect", response_model=s.ExtensionConnectResponse)
def connect(ctx: WriteCtx, payload: s.ExtensionConnectRequest) -> dict[str, Any]:
    """Exchange a dashboard session for a scope-limited extension session.

    Requires a dashboard token: an extension session cannot mint another one, so a stolen
    extension token cannot extend its own life.
    """
    service = ExtensionSessionService(ctx.session, ctx.workspace_id, ctx.audit)
    token, expires_at, installation = service.exchange(
        user_id=ctx.user.id,
        membership=ctx.membership,
        extension_instance_id=payload.extension_instance_id,
        extension_version=payload.extension_version,
        label=payload.label,
    )
    ctx.commit()
    return {
        "access_token": token,
        "expires_at": expires_at,
        "installation_id": installation.id,
        "workspace_name": ctx.workspace.name,
        "user_email": ctx.user.email,
    }


@router.get("/installations", response_model=list[s.ExtensionInstallationOut])
def list_installations(ctx: Ctx) -> list[dict[str, Any]]:
    """Which browsers are connected. Dashboard-only, and scoped to the signed-in operator."""
    installations = ExtensionInstallationService(
        ctx.session, ctx.workspace_id, ctx.audit
    ).list_for_user(ctx.user.id)
    return [_installation_payload(item) for item in installations]


@router.post("/installations/revoke", response_model=s.ExtensionInstallationOut)
def revoke_installation(ctx: WriteCtx, payload: s.ExtensionRevokeRequest) -> dict[str, Any]:
    """Cut off a browser immediately. Revocation is a row, so it does not wait for expiry."""
    service = ExtensionInstallationService(ctx.session, ctx.workspace_id, ctx.audit)
    installations = service.list_for_user(ctx.user.id)
    if payload.installation_id is not None:
        target = next((i for i in installations if i.id == payload.installation_id), None)
    else:
        target = next((i for i in installations if i.is_active), None)
    if target is None:
        raise NotFoundError("No matching extension installation was found.")
    service.revoke(target, reason=payload.reason)
    ctx.commit()
    return _installation_payload(target)


@router.get("/session/current")
def current_session(ctx: ExtCtx) -> dict[str, Any]:
    """A liveness check the extension can call cheaply. It writes no audit row."""
    ExtensionInstallationService(ctx.session, ctx.workspace_id, ctx.audit).touch(ctx.installation)
    ctx.commit()
    return {
        "connected": True,
        "workspace_name": ctx.api.workspace.name,
        "user_email": ctx.api.user.email,
        "installation_id": str(ctx.installation.id),
        "extension_version": ctx.installation.extension_version,
    }


# ---- context ---------------------------------------------------------------------------


@router.post("/context/resolve", response_model=s.ContextResolveResponse)
def resolve_context(ctx: ExtCtx, payload: s.ContextResolveRequest) -> dict[str, Any]:
    """Match what the page showed to exactly one registered account, or say it cannot.

    A `confirmed` result requires an exact account id. Nothing here compares names, and an
    unmatched page never guesses.
    """
    installations = ExtensionInstallationService(ctx.session, ctx.workspace_id, ctx.audit)
    installations.touch(ctx.installation, version=payload.extension_version or None)

    resolution = ExtensionContextResolver(ctx.session, ctx.workspace_id).resolve(
        external_account_id=payload.external_account_id,
        raw_path=payload.safe_path,
        declared_page_type=payload.page_type.value if payload.page_type else None,
    )

    body: dict[str, Any] = {
        "context_status": resolution.status,
        "reason_code": resolution.reason_code,
        "message": resolution.message,
        "page_type": resolution.page_type,
        "safe_path": resolution.safe_path,
    }

    if resolution.status is ExtensionContextStatus.CONFIRMED and resolution.account is not None:
        summary = ExtensionSummaryService(ctx.session, ctx.workspace_id, ctx.audit).build(
            resolution.account
        )
        body.update(summary)
    ctx.commit()
    return body


@router.get("/accounts/{ad_account_id}/summary", response_model=s.ExtensionSummaryResponse)
def extension_summary_for_extension(ctx: ExtCtx, ad_account_id: uuid.UUID) -> dict[str, Any]:
    """The same summary, for an account the operator picked by hand after an ambiguous page."""
    account = _load_account(ctx.session, ctx.workspace_id, ad_account_id)
    return ExtensionSummaryService(ctx.session, ctx.workspace_id, ctx.audit).build(account)


# ---- events ------------------------------------------------------------------------------


@router.post("/events", response_model=s.ExtensionEventResponse, status_code=201)
def record_event(ctx: ExtCtx, payload: s.ExtensionEventRequest) -> dict[str, Any]:
    """Record an operator action as an ordinary A1 account event.

    It goes through `AccountEventService`, so it lands in the same timeline, writes the same
    audit row and recalculates readiness the same way a dashboard-entered event does.
    """
    account = _load_account(ctx.session, ctx.workspace_id, payload.ad_account_id)
    context = build_source_context(
        page_type=payload.page_type,
        context_status=payload.context_status,
        raw_path=payload.safe_path,
        extension_version=payload.extension_version or ctx.installation.extension_version,
        external_account_id=account.external_account_id,
    )
    service = ExtensionEventIngestService(ctx.session, ctx.workspace_id, ctx.audit)
    event = service.ingest(
        account,
        event_type=payload.event_type.value,
        note=payload.note,
        occurred_at=payload.occurred_at,
        source_context=context,
    )
    ExtensionInstallationService(ctx.session, ctx.workspace_id, ctx.audit).touch(ctx.installation)
    ctx.commit()
    return {
        "id": event.id,
        "ad_account_id": event.ad_account_id,
        "event_type": event.event_type,
        "severity": event.severity.value,
        "source": event.source,
        "occurred_at": event.occurred_at,
        "summary": event.summary,
        "source_context": event.source_context_json,
        "timeline_path": f"/accounts/{event.ad_account_id}?tab=events",
    }


# ---- shared read for the dashboard ---------------------------------------------------------


@account_router.get("/{ad_account_id}/extension-summary", response_model=s.ExtensionSummaryResponse)
def extension_summary(ctx: AnyCtx, ad_account_id: uuid.UUID) -> dict[str, Any]:
    """The account summary as the extension sees it, readable from either session type."""
    account = _load_account(ctx.session, ctx.workspace_id, ad_account_id)
    return ExtensionSummaryService(ctx.session, ctx.workspace_id, ctx.audit).build(account)


def _load_account(session, workspace_id: uuid.UUID, ad_account_id: uuid.UUID) -> AdAccount:
    """A foreign account is reported as missing, never as forbidden: an error that
    distinguishes the two tells a caller which ids exist in another workspace."""
    account = session.get(AdAccount, ad_account_id)
    if account is None or account.workspace_id != workspace_id:
        raise NotFoundError("That ad account was not found.")
    return account


def _installation_payload(installation) -> dict[str, Any]:
    return {
        "id": installation.id,
        "label": installation.label,
        "extension_version": installation.extension_version,
        "last_seen_at": installation.last_seen_at,
        "revoked_at": installation.revoked_at,
        "revoked_reason": installation.revoked_reason,
        "created_at": installation.created_at,
        "is_active": installation.is_active,
    }


__all__ = ["router", "account_router"]
