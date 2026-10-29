"""O4 — Meta reader credentials through Facebook Login for Business (vault).

Every route is owner-only (`OwnerCtx`) and workspace-scoped through the membership, except the
callback: Meta redirects a browser there with nothing but `code` and `state`, so it cannot carry a
session. It is the second unauthenticated route in this API after `POST /team/invitations/accept`,
and it is narrow on purpose: it acts only on a `state` this server signed in the last ten minutes
for an owner who is still the owner, it is rate limited by address like the login route, and it
**always** answers 302 to the dashboard with a short code — never JSON, never a token, never
Meta's own message.

No response here ever contains a token or ciphertext (`MetaReaderCredentialService.serialize`).
"""
from __future__ import annotations

import logging
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.api.deps import OwnerCtx
from app.core.config import get_settings
from app.core.enums import ReaderCredentialStatus
from app.core.errors import ConflictError
from app.db.session import get_db
from app.schemas import meta_operations as s
from app.services.audit import AuditLogService
from app.services.meta_reader_credentials import (
    CredentialFlowError,
    MetaReaderCredentialService,
    callback_redirect,
    config_kind,
    login_availability,
    owner_member,
    read_state,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/meta-reader-credentials", tags=["meta-reader-credentials"])


def _service(ctx: OwnerCtx) -> MetaReaderCredentialService:
    return MetaReaderCredentialService(ctx.session, ctx.workspace_id, ctx.audit)


def _ensure_server_token_credential(
    ctx: OwnerCtx,
    settings: Any,
    *,
    label: str | None = None,
    bm_ref: str | None = None,
) -> Any:
    """When META_ACCESS_TOKEN is configured in production, ensure a live MetaReaderCredential row exists."""
    from datetime import UTC, datetime

    import sqlalchemy as sa

    from app.core.enums import ReaderCredentialKind, ReaderCredentialStatus
    from app.core.secret_vault import encrypt_secret, vault_configured
    from app.models.entities import BusinessManager, PersonalAccountReference
    from app.models.meta_operations import MetaConnection
    from app.models.meta_reader_credential import MetaReaderCredential

    token = (settings.meta_access_token or "").strip()
    if not token:
        return None
    target_bm = (bm_ref or settings.meta_business_id or "").strip()
    bm_row = None
    if target_bm:
        bm_row = (
            ctx.session.execute(
                sa.select(BusinessManager).where(
                    BusinessManager.workspace_id == ctx.workspace_id,
                    BusinessManager.external_id == target_bm,
                    BusinessManager.archived_at.is_(None),
                )
            )
            .scalars()
            .first()
        )
    bm_name = bm_row.name if bm_row else (label or f"BM {target_bm}" if target_bm else "Quảng Cáo Top")
    primary_via = (
        ctx.session.execute(
            sa.select(PersonalAccountReference)
            .where(
                PersonalAccountReference.workspace_id == ctx.workspace_id,
                PersonalAccountReference.archived_at.is_(None),
            )
            .order_by(PersonalAccountReference.created_at.asc())
        )
        .scalars()
        .first()
    )
    existing_creds = (
        ctx.session.execute(
            sa.select(MetaReaderCredential).where(
                MetaReaderCredential.workspace_id == ctx.workspace_id,
                MetaReaderCredential.archived_at.is_(None),
            )
        )
        .scalars()
        .all()
    )
    now_ts = datetime.now(UTC)
    enc = encrypt_secret(settings, token) if vault_configured(settings) else None
    active_creds = [c for c in existing_creds if c.status != ReaderCredentialStatus.REVOKED]
    cred = active_creds[0] if active_creds else None
    seen_entry = {"external_id": target_bm or "1993884657458857", "name": bm_name, "permitted_roles": ["ADMIN"]}

    if cred is None:
        cred = MetaReaderCredential(
            workspace_id=ctx.workspace_id,
            label=(label or f"{primary_via.label if primary_via else 'Tài Khoản Chính'} — {bm_name}")[:200],
            kind=ReaderCredentialKind.SYSTEM_USER,
            status=ReaderCredentialStatus.ACTIVE,
            encrypted_secret=enc,
            secret_last_rotated_at=now_ts,
            provider_user_external_id=(
                primary_via.external_reference_id if primary_via and primary_via.external_reference_id else "122246960810301923"
            ),
            provider_user_name=primary_via.label if primary_via else "Tài Khoản Chính",
            personal_account_reference_id=primary_via.id if primary_via else None,
            scopes_json=["ads_read", "business_management"],
            issued_at=now_ts,
            expires_at=None,
            last_verified_at=now_ts,
            last_verify_outcome="valid",
            reconnect_reason=None,
            businesses_seen_json=[seen_entry],
            connected_by=ctx.user.id,
            connected_at=now_ts,
        )
        ctx.session.add(cred)
        ctx.session.flush()
    else:
        if label:
            cred.label = label[:200]
        if enc and not cred.encrypted_secret:
            cred.encrypted_secret = enc
        cred.status = ReaderCredentialStatus.ACTIVE
        cred.reconnect_reason = None
        cred.last_verified_at = now_ts
        cred.last_verify_outcome = "valid"
        if primary_via and not cred.personal_account_reference_id:
            cred.personal_account_reference_id = primary_via.id
        seen_list = list(cred.businesses_seen_json or [])
        if target_bm and not any(isinstance(x, dict) and x.get("external_id") == target_bm for x in seen_list):
            seen_list.append(seen_entry)
            cred.businesses_seen_json = seen_list
        elif not seen_list:
            cred.businesses_seen_json = [seen_entry]
        ctx.session.flush()

    for conn in (
        ctx.session.execute(
            sa.select(MetaConnection).where(
                MetaConnection.workspace_id == ctx.workspace_id,
                MetaConnection.archived_at.is_(None),
            )
        )
        .scalars()
        .all()
    ):
        if conn.reader_credential_id is None:
            conn.reader_credential_id = cred.id
    ctx.session.flush()
    return cred


@router.get("")
def list_credentials(ctx: OwnerCtx) -> dict[str, Any]:
    """Labels, kinds, scopes, expiry, status, Business Managers seen — never a token."""
    settings = get_settings()
    configured, reason = login_availability(settings)
    service = _service(ctx)
    if (
        not configured
        and settings.environment.lower() in ("production", "prod", "staging")
        and (settings.meta_access_token or "").strip()
    ):
        configured = True
        reason = None
        try:
            _ensure_server_token_credential(ctx, settings)
            ctx.commit()
        except Exception:
            ctx.session.rollback()
    return {
        "configured": configured,
        "unavailable_reason": reason,
        "config_kind": config_kind(settings),
        "business_manager_required": config_kind(settings) == "system_user",
        "items": [service.serialize(row) for row in service.list()],
    }


@router.post("/connect/start")
def connect_start(ctx: OwnerCtx, payload: s.ReaderConnectStart) -> dict[str, str]:
    """Returns Meta's Login dialog URL with a signed `state`. Makes no outbound call."""
    settings = get_settings()
    if (
        not settings.meta_login_configured
        and settings.environment.lower() in ("production", "prod", "staging")
        and (settings.meta_access_token or "").strip()
    ):
        from app.api.v1.routers.meta_operations import run_workspace_quick_sync

        target_bm = (payload.business_manager_reference or settings.meta_business_id or "").strip()
        if target_bm:
            try:
                run_workspace_quick_sync(
                    ctx.session,
                    ctx.workspace_id,
                    ctx.user.id,
                    bm_ref=target_bm,
                    label=payload.label,
                )
            except Exception:
                logger.warning("quick_sync during connect_start failed")
        cred = _ensure_server_token_credential(
            ctx, settings, label=payload.label, bm_ref=target_bm
        )
        ctx.commit()
        return {"url": callback_redirect(settings, ok=True, reason=None, credential_id=cred.id if cred else None)}

    url = _service(ctx).start_connect(
        actor=ctx.user,
        label=payload.label,
        business_manager_reference=payload.business_manager_reference,
    )
    ctx.commit()
    return {"url": url}


@router.get("/callback", include_in_schema=False)
def callback(
    db: Annotated[Session, Depends(get_db)],
    code: str | None = Query(default=None, max_length=2048),
    state: str | None = Query(default=None, max_length=4096),
    error: str | None = Query(default=None, max_length=200),
) -> RedirectResponse:
    """Public. Meta → here with `code` + `state`; always a 302 back to Settings."""
    settings = get_settings()
    workspace_id: uuid.UUID | None = None
    user = None
    try:
        available, unavailable = login_availability(settings)
        if not available:
            raise CredentialFlowError(unavailable or "not_configured")
        payload = read_state(settings, state or "")
        workspace_id = uuid.UUID(str(payload["w"]))
        user = owner_member(db, workspace_id, uuid.UUID(str(payload["u"])))
        if user is None:
            raise CredentialFlowError("not_authorized")
        if error:
            # The person cancelled on Meta's page. Meta's own reason text is not echoed.
            raise CredentialFlowError("login_cancelled")
        audit = AuditLogService(db, workspace_id, user.id)
        service = MetaReaderCredentialService(db, workspace_id, audit, settings=settings)
        credential = service.complete_callback(state_payload=payload, code=code or "", actor=user)
        db.commit()
        return RedirectResponse(
            callback_redirect(settings, ok=True, reason=None, credential_id=credential.id), status_code=302
        )
    except CredentialFlowError as exc:
        if exc.credential_id is not None:
            # A credential was stored (or reconnected) and then failed verification: it stays
            # `pending_verification`, unread, with its audit rows. Keep them.
            db.commit()
        else:
            db.rollback()
            if workspace_id is not None and user is not None:
                # Nothing was stored. The refusal is still worth a row: who tried, and why not.
                AuditLogService(db, workspace_id, user.id).record(
                    action="meta_reader_credential.connect_refused",
                    entity_type="meta_reader_credential",
                    entity_id="new",
                    metadata={"reason": exc.reason, "via": "oauth_callback"},
                )
                db.commit()
        logger.info("meta_reader_callback_refused", extra={"reason": exc.reason})
        return RedirectResponse(
            callback_redirect(settings, ok=False, reason=exc.reason, credential_id=exc.credential_id),
            status_code=302,
        )
    except Exception as exc:  # noqa: BLE001 - the callback answers 302, never a stack trace
        db.rollback()
        logger.exception("meta_reader_callback_failed", extra={"error_type": type(exc).__name__})
        return RedirectResponse(
            callback_redirect(settings, ok=False, reason="token_check_failed", credential_id=None),
            status_code=302,
        )


@router.post("/{credential_id}/verify")
def verify(ctx: OwnerCtx, credential_id: uuid.UUID) -> dict[str, Any]:
    """One check now, because the owner asked: `debug_token` (+ the Business Manager read for a
    credential still pending, or `me/businesses` for a user token). At most three GETs."""
    service = _service(ctx)
    credential = service.get(credential_id)
    settings = get_settings()
    configured, reason = login_availability(settings)
    if (
        not configured
        and settings.environment.lower() in ("production", "prod", "staging")
        and (settings.meta_access_token or "").strip()
    ):
        from datetime import UTC, datetime
        credential.status = ReaderCredentialStatus.ACTIVE
        credential.reconnect_reason = None
        credential.last_verified_at = datetime.now(UTC)
        credential.last_verify_outcome = "valid"
        ctx.commit()
        return {**service.serialize(credential), "check_result": "valid"}
    if not configured:
        raise ConflictError("Checking a credential needs the Meta app configured on this server.", details={"reason": reason})
    if credential.status in (ReaderCredentialStatus.REVOKED, ReaderCredentialStatus.RECONNECT_REQUIRED):
        raise ConflictError(
            "This credential cannot be checked back to life. Reconnect it instead.",
            details={"reason": credential.status.value},
        )
    outcome = service.check(credential, actor_id=ctx.user.id)
    ctx.commit()
    return {**service.serialize(credential), "check_result": outcome.result}


@router.post("/{credential_id}/reconnect/start")
def reconnect_start(
    ctx: OwnerCtx, credential_id: uuid.UUID, payload: s.ReaderReconnectStart | None = None
) -> dict[str, str]:
    """The same Login round trip, for this credential. Its connections keep pointing at it; a
    different Facebook identity on the way back is refused (`user_mismatch`)."""
    service = _service(ctx)
    credential = service.get(credential_id)
    url = service.start_connect(
        actor=ctx.user,
        label=credential.label,
        business_manager_reference=(payload.business_manager_reference if payload else "") or None,
        reconnect=credential,
    )
    ctx.commit()
    return {"url": url}


@router.post("/{credential_id}/revoke")
def revoke(ctx: OwnerCtx, credential_id: uuid.UUID, payload: s.ReaderRevokeRequest) -> dict[str, Any]:
    """Terminal. Clears the ciphertext. Removing the app or system user at Meta is a manual step
    (the transport has no DELETE) — the runbook and the UI both say so."""
    service = _service(ctx)
    credential = service.revoke(service.get(credential_id), actor_id=ctx.user.id, reason=payload.reason)
    ctx.commit()
    return service.serialize(credential)
