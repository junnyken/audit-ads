"""Request context: identity, workspace scope and the audit writer, resolved once per request.

Routers never read a workspace id from the request body. It comes from the authenticated
membership, which is the only reason cross-workspace access is structurally impossible rather
than a rule each endpoint has to remember (A1 Guardrail 11).
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated

import jwt
import sqlalchemy as sa
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.errors import AuthenticationError
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.entities import User, Workspace, WorkspaceMember
from app.services.audit import AuditLogService
from app.services.workspace import WorkspaceAccessService

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class ApiContext:
    session: Session
    user: User
    membership: WorkspaceMember
    workspace: Workspace
    audit: AuditLogService

    @property
    def workspace_id(self) -> uuid.UUID:
        return self.workspace.id

    @property
    def actor_id(self) -> uuid.UUID:
        return self.user.id

    def commit(self) -> None:
        self.session.commit()


def get_context(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: Annotated[Session, Depends(get_db)],
) -> ApiContext:
    if credentials is None or not credentials.credentials:
        raise AuthenticationError("An access token is required.")
    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.ExpiredSignatureError as exc:
        raise AuthenticationError("The access token has expired. Sign in again.") from exc
    except jwt.PyJWTError as exc:
        raise AuthenticationError("The access token is not valid.") from exc

    try:
        user_id = uuid.UUID(payload["sub"])
        workspace_id = uuid.UUID(payload["workspace_id"])
    except (KeyError, ValueError, TypeError) as exc:
        raise AuthenticationError("The access token is not valid.") from exc

    user = session.get(User, user_id)
    if user is None or not user.is_active:
        raise AuthenticationError("This account is no longer active.")

    workspace = session.execute(
        sa.select(Workspace).where(Workspace.id == workspace_id, Workspace.archived_at.is_(None))
    ).scalar_one_or_none()
    if workspace is None:
        raise AuthenticationError("The workspace is not available.")

    membership = WorkspaceAccessService(session).get_membership(
        user_id=user.id, workspace_id=workspace.id
    )
    return ApiContext(
        session=session,
        user=user,
        membership=membership,
        workspace=workspace,
        audit=AuditLogService(session, workspace.id, user.id),
    )


def get_write_context(ctx: Annotated[ApiContext, Depends(get_context)]) -> ApiContext:
    WorkspaceAccessService.require_mutation(ctx.membership)
    return ctx


def get_audit_context(ctx: Annotated[ApiContext, Depends(get_context)]) -> ApiContext:
    WorkspaceAccessService.require_audit_read(ctx.membership)
    return ctx


Ctx = Annotated[ApiContext, Depends(get_context)]
WriteCtx = Annotated[ApiContext, Depends(get_write_context)]
AuditCtx = Annotated[ApiContext, Depends(get_audit_context)]
