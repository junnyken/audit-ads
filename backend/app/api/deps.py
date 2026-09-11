"""Request context: identity, workspace scope and the audit writer, resolved once per request.

Routers never read a workspace id from the request body. It comes from the authenticated
membership, which is the only reason cross-workspace access is structurally impossible rather
than a rule each endpoint has to remember (A1 Guardrail 11).
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated, Any

import jwt
import sqlalchemy as sa
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.enums import WorkspaceRole
from app.core.errors import AuthenticationError, AuthorizationError
from app.core.security import TOKEN_USE_DASHBOARD, TOKEN_USE_EXTENSION, decode_access_token
from app.db.session import get_db
from app.models.entities import User, Workspace, WorkspaceMember
from app.services.audit import AuditLogService
from app.services.scope_authorization import ScopeAuthorizationService
from app.services.session_registry import SessionRegistryService
from app.services.workspace import WorkspaceAccessService

bearer_scheme = HTTPBearer(auto_error=False)

#: Distinguishes "not computed yet" from a computed `None` (which means "owner, no filter").
_UNSET: Any = object()


@dataclass
class ApiContext:
    session: Session
    user: User
    membership: WorkspaceMember
    workspace: Workspace
    audit: AuditLogService
    #: The dashboard `DeviceSession` this request authenticated through. `None` for an
    #: extension token (A5 keeps its own, separate revocation model — see A9 audit).
    device_session_id: uuid.UUID | None = None
    #: Lazily computed once per request — see the `scope` property below.
    _scope: Any = None
    _visible_accounts: Any = _UNSET
    _visible_bms: Any = _UNSET

    @property
    def workspace_id(self) -> uuid.UUID:
        return self.workspace.id

    @property
    def actor_id(self) -> uuid.UUID:
        return self.user.id

    def commit(self) -> None:
        self.session.commit()

    # ---------------------------------------------------------------- A9 resource scope
    # `None` means "no filter" — the owner, who sees the whole workspace. A non-owner always
    # gets a concrete set, empty included: "assigned nothing" is a real answer, not a missing
    # one, and must never be read as "assigned everything" (CLAUDE.md rule 4).

    @property
    def scope(self) -> ScopeAuthorizationService:
        if self._scope is None:
            self._scope = ScopeAuthorizationService(self.session, self.workspace_id)
        return self._scope

    def visible_ad_account_ids(self) -> set[uuid.UUID] | None:
        if self._visible_accounts is _UNSET:
            self._visible_accounts = self.scope.visible_ad_account_ids(self.membership)
        return self._visible_accounts

    def visible_business_manager_ids(self) -> set[uuid.UUID] | None:
        if self._visible_bms is _UNSET:
            self._visible_bms = self.scope.visible_business_manager_ids(self.membership)
        return self._visible_bms


def _decode(credentials: HTTPAuthorizationCredentials | None) -> dict:
    if credentials is None or not credentials.credentials:
        raise AuthenticationError("An access token is required.")
    try:
        return decode_access_token(credentials.credentials)
    except jwt.ExpiredSignatureError as exc:
        raise AuthenticationError("The access token has expired. Sign in again.") from exc
    except jwt.PyJWTError as exc:
        raise AuthenticationError("The access token is not valid.") from exc


def token_use(payload: dict) -> str:
    """Tokens issued before A5 carry no `token_use` claim; they are dashboard sessions."""
    return str(payload.get("token_use") or TOKEN_USE_DASHBOARD)


def _build_context(session: Session, payload: dict) -> ApiContext:
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
    audit = AuditLogService(session, workspace.id, user.id)

    device_session_id: uuid.UUID | None = None
    if token_use(payload) == TOKEN_USE_DASHBOARD:
        # A9: a dashboard token that predates the session registry, or one whose row was
        # revoked/expired since it was issued, is refused here — the same "sign in again"
        # boundary as an expired/invalid signature, not a silent downgrade.
        try:
            claimed_id = uuid.UUID(str(payload["session_id"]))
        except (KeyError, ValueError, TypeError) as exc:
            raise AuthenticationError("Your session has ended. Sign in again.") from exc
        registry = SessionRegistryService(session, workspace.id, audit)
        device_session = registry.get_active(claimed_id)
        if device_session is None:
            raise AuthenticationError("Your session has ended. Sign in again.")
        registry.touch(device_session)
        device_session_id = device_session.id

    return ApiContext(
        session=session,
        user=user,
        membership=membership,
        workspace=workspace,
        audit=audit,
        device_session_id=device_session_id,
    )


def get_context(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: Annotated[Session, Depends(get_db)],
) -> ApiContext:
    """The dashboard session.

    An extension token is refused here on purpose (A5). It lives in browser storage, so it must
    not be able to create accounts, change readiness, resolve alerts or trigger a test send —
    a stolen extension token is then a much smaller problem than a stolen dashboard token.
    """
    payload = _decode(credentials)
    if token_use(payload) == TOKEN_USE_EXTENSION:
        raise AuthenticationError(
            "An extension session cannot be used here. Sign in to the dashboard."
        )
    return _build_context(session, payload)


def get_any_context(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: Annotated[Session, Depends(get_db)],
) -> ApiContext:
    """Read-only routes that both the dashboard and the extension legitimately need."""
    return _build_context(session, _decode(credentials))


@dataclass
class ExtensionContext:
    """An extension session: an API context plus the installation it was issued to.

    The installation is re-checked on every request, so revoking one takes effect immediately
    rather than whenever its token happens to expire.
    """

    api: ApiContext
    installation: Any

    @property
    def session(self) -> Session:
        return self.api.session

    @property
    def workspace_id(self):
        return self.api.workspace_id

    @property
    def actor_id(self):
        return self.api.actor_id

    @property
    def audit(self) -> AuditLogService:
        return self.api.audit

    def commit(self) -> None:
        self.api.commit()


def get_extension_context(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: Annotated[Session, Depends(get_db)],
) -> ExtensionContext:
    payload = _decode(credentials)
    if token_use(payload) != TOKEN_USE_EXTENSION:
        raise AuthenticationError(
            "This endpoint needs an extension session. Connect the extension first."
        )
    api = _build_context(session, payload)
    from app.services.extension_session import ExtensionSessionService

    installation = ExtensionSessionService(
        session, api.workspace_id, api.audit
    ).load_installation(payload.get("installation_id"))
    if installation.user_id != api.user.id:
        raise AuthenticationError("This extension session is not valid. Connect again.")
    return ExtensionContext(api=api, installation=installation)


def get_write_context(ctx: Annotated[ApiContext, Depends(get_context)]) -> ApiContext:
    WorkspaceAccessService.require_mutation(ctx.membership)
    return ctx


def get_audit_context(ctx: Annotated[ApiContext, Depends(get_context)]) -> ApiContext:
    WorkspaceAccessService.require_audit_read(ctx.membership)
    return ctx


def get_owner_context(ctx: Annotated[ApiContext, Depends(get_context)]) -> ApiContext:
    """A9: every team-seat/invite/role/assignment/member-lifecycle mutation is owner-only —
    a stricter gate than `WriteCtx`'s `MUTATION_ROLES` (owner/admin/buyer)."""
    if ctx.membership.role != WorkspaceRole.OWNER:
        raise AuthorizationError("Only the workspace owner can do this.")
    return ctx


def get_optional_authenticated_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: Annotated[Session, Depends(get_db)],
) -> User | None:
    """For `POST /team/invitations/accept` only: `None` when no bearer token was supplied
    (the brand-new-email registration path); a real, validated `User` when one was (the
    existing-account path) — never a silent fallback from an *invalid* token to `None`, since
    that would let a stale or forged token quietly downgrade into "create a new account"
    instead of failing loudly.
    """
    if credentials is None or not credentials.credentials:
        return None
    payload = _decode(credentials)
    if token_use(payload) != TOKEN_USE_DASHBOARD:
        raise AuthenticationError("Sign in to the dashboard to accept this invitation.")
    try:
        user_id = uuid.UUID(payload["sub"])
        workspace_id = uuid.UUID(payload["workspace_id"])
        session_id = uuid.UUID(str(payload["session_id"]))
    except (KeyError, ValueError, TypeError) as exc:
        raise AuthenticationError("The access token is not valid.") from exc
    user = session.get(User, user_id)
    if user is None or not user.is_active:
        raise AuthenticationError("This account is no longer active.")
    # Same boundary as `_build_context`: a revoked/expired session must not count as
    # authentication anywhere, including here.
    registry = SessionRegistryService(session, workspace_id, AuditLogService(session, workspace_id, user_id))
    if registry.get_active(session_id) is None:
        raise AuthenticationError("Your session has ended. Sign in again.")
    return user


Ctx = Annotated[ApiContext, Depends(get_context)]
AnyCtx = Annotated[ApiContext, Depends(get_any_context)]
ExtCtx = Annotated[ExtensionContext, Depends(get_extension_context)]
WriteCtx = Annotated[ApiContext, Depends(get_write_context)]
AuditCtx = Annotated[ApiContext, Depends(get_audit_context)]
OwnerCtx = Annotated[ApiContext, Depends(get_owner_context)]
OptionalUser = Annotated[User | None, Depends(get_optional_authenticated_user)]
