"""MINI-SPEC A9 Step 2/5 — dashboard device-session self-service, plus the owner-of-another-
member path on the same `/revoke` endpoint (spec §E "Revoke one session": "User may revoke own
non-current active session. Owner may revoke any member session, requiring reason." — one
endpoint, branching on whose session it is, not two).
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter

import app.schemas.team as s
from app.api.deps import Ctx
from app.core.enums import WorkspaceRole
from app.core.errors import AuthorizationError, NotFoundError, ValidationError
from app.services.session_registry import SessionRegistryService

router = APIRouter(prefix="/security/sessions", tags=["security"])


def _serialize(row, *, current_id: uuid.UUID | None) -> s.DeviceSessionOut:
    out = s.DeviceSessionOut.model_validate(row)
    out.is_current = current_id is not None and row.id == current_id
    return out


@router.get("/me", response_model=list[s.DeviceSessionOut])
def list_my_sessions(ctx: Ctx) -> list[s.DeviceSessionOut]:
    registry = SessionRegistryService(ctx.session, ctx.workspace_id, ctx.audit)
    rows = registry.list_for_user(ctx.user.id)
    return [_serialize(row, current_id=ctx.device_session_id) for row in rows]


@router.post("/{session_id}/revoke", response_model=s.DeviceSessionOut)
def revoke_session(
    ctx: Ctx, session_id: uuid.UUID, payload: s.SessionRevokeRequest | None = None
) -> s.DeviceSessionOut:
    registry = SessionRegistryService(ctx.session, ctx.workspace_id, ctx.audit)
    target = registry.get_active(session_id)
    if target is None:
        raise NotFoundError("Device session not found.")

    if target.user_id == ctx.user.id:
        row = registry.revoke_own(session_id, user_id=ctx.user.id, current_session_id=ctx.device_session_id)
    else:
        if ctx.membership.role != WorkspaceRole.OWNER:
            raise AuthorizationError("Only the workspace owner can revoke another member's session.")
        reason = payload.reason if payload else None
        if not reason:
            raise ValidationError("A reason is required to revoke another member's session.")
        registry.revoke_for_member(
            target.user_id, session_id=session_id, reason=reason, actor_id=ctx.user.id
        )
        row = target  # already mutated in place by revoke_for_member's own `_revoke`
    ctx.commit()
    return _serialize(row, current_id=ctx.device_session_id)


@router.post("/logout-other-devices", response_model=s.RevokeSessionResult)
def logout_other_devices(ctx: Ctx) -> s.RevokeSessionResult:
    registry = SessionRegistryService(ctx.session, ctx.workspace_id, ctx.audit)
    count = registry.logout_other_devices(user_id=ctx.user.id, current_session_id=ctx.device_session_id)
    ctx.commit()
    return s.RevokeSessionResult(revoked_count=count)
