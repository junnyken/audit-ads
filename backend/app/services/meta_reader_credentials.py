"""O4 — Meta reader credentials obtained through Facebook Login for Business, kept in the vault.

Everything about a vault credential's life is here, so its rules live in one place:

* **How one arrives.** Only from Meta's own login flow: an owner presses *Connect*
  (`start_connect` signs a `state` and returns Meta's dialog URL); a real person consents on
  Meta's page in their own browser; Meta redirects to the public callback with a `code`;
  `handle_callback` exchanges it server-side (`GET oauth/access_token`) and asks Meta what the
  token is (`GET debug_token`, app token). No person ever types, pastes or posts a token, and no
  request body carries one (rule 1).
* **What is refused at the door.** A token for another app (`app_mismatch`), an invalid one
  (`invalid_token`), one missing `ads_read` or `business_management` (`scope_missing`), and
  **any** token carrying `ads_management` (`scope_too_broad`) — nothing is stored for any of them.
* **When it may be read with.** Only once Meta has confirmed it can read the Business Manager(s)
  (`_verify_binding`). Until then it is `pending_verification`; after Meta says it is dead it is
  `reconnect_required` with the reason as a code; `revoked` is terminal. `resolve_reader` decides
  from that status and never falls back to a server token (rule 40).
* **How it is watched.** `check_credential` (the verify button and the dispatcher's
  `credential_check_pass`, off by default): at most three GETs. A death raises **one** `critical`
  alert (Telegram per policy); a token expiring within `CREDENTIAL_EXPIRY_WARNING_DAYS` raises a
  `warning`. For a `user` token near expiry, one `fb_exchange_token` is *tried* and whether it
  extended anything is counted, never assumed (Meta does not document it — T4).

Outbound calls: only `MetaGraphTransport.get` (rule 20), through `graph_transport`, the one seam
tests replace — no test reaches the network. The token is never logged, audited, returned or put
in an alert; audit metadata carries kind, scopes, expiry and the granting id at most.
"""
from __future__ import annotations

import logging
import re
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode, urlparse

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.enums import (
    ACTIVE_ALERT_STATUSES,
    AlertSeverity,
    AlertSourceType,
    AlertStatus,
    BusinessAuthority,
    DeliveryReason,
    MetaEnvironment,
    ReaderCredentialKind,
    ReaderCredentialStatus,
    ReferenceStatus,
    WorkspaceRole,
)
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.redaction import redact
from app.core.secret_vault import (
    StateInvalidError,
    VaultNotConfiguredError,
    encrypt_secret,
    sign_state,
    vault_configured,
    verify_state,
)
from app.models.alerts import Alert
from app.models.entities import AdAccount, BusinessManager, User, WorkspaceMember
from app.models.meta_operations import MetaConnection
from app.models.meta_reader_credential import MetaReaderCredential
from app.services.audit import AuditLogService
from app.services.base import snapshot as orm_snapshot
from app.services.extension_context import canonical_external_id
from app.services.meta_graph_transport import GraphResponse, MetaGraphTransport
from app.services.meta_provider import MetaFailureCode
from app.services.meta_real_provider import (
    READER_VAULT,
    RealMetaBusinessProvider,
    resolve_reader,
)

logger = logging.getLogger(__name__)

#: The two read scopes the Login configuration must grant — both, exactly.
REQUIRED_SCOPES: tuple[str, ...] = ("ads_read", "business_management")
#: Refused without exception (Constraint 2): a credential that can change ads is never stored.
FORBIDDEN_SCOPES: tuple[str, ...] = ("ads_management",)
#: A scope name is stored only if it looks like one. Anything else Meta returns is dropped.
_SCOPE_NAME = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
#: `me/businesses` is paged at most this many times (100 per page).
MAX_BUSINESS_PAGES = 10

#: Short-lived user tokens (about two hours) are swapped for a long-lived one at connect time.
SHORT_LIVED_BELOW = timedelta(days=1)

#: `debug_token` / Graph `error_subcode` -> reconnect reason. Documented by Meta (T9).
SUBCODE_REASONS = {
    458: "app_not_installed",
    459: "checkpointed",
    460: "password_changed",
    463: "expired",
    464: "invalid_token",
    467: "invalid_token",
}

#: Every reason a credential can be refused at the door, or need reconnecting. Codes only.
CALLBACK_REASONS = frozenset(
    {
        "invalid_state", "not_configured", "vault_unavailable", "not_authorized", "login_cancelled",
        "code_missing", "code_exchange_failed", "token_check_failed", "app_mismatch",
        "invalid_token", "scope_missing", "scope_too_broad", "unsupported_token_type",
        "business_manager_required", "user_mismatch", "credential_revoked",
        "business_not_readable", "businesses_unreadable", "rate_limited",
    }
)

RECONNECT_NEXT_STEPS = {
    "password_changed": "Sign in to facebook.com with that account, then press Reconnect in Settings.",
    "checkpointed": "Sign in to facebook.com and clear the security checkpoint, then press Reconnect in Settings.",
    "expired": "Press Reconnect in Settings and consent again on Meta's page.",
    "app_not_installed": "The app was removed from the account or business. Press Reconnect in Settings.",
    "scope_missing": "A permission was removed. Press Reconnect in Settings and grant ads_read and business_management.",
    "scope_too_broad": "The Login configuration grants ads_management. Fix the configuration in Meta, then Reconnect.",
    "vault_unavailable": "The vault key changed or is missing on the server. Restore it, or Reconnect.",
}
DEFAULT_NEXT_STEP = "Press Reconnect in Settings → Meta reader credentials."

SETTINGS_SECTION_PATH = "/settings"


class CredentialFlowError(Exception):
    """A refusal on the Login round trip, carrying a short code from `CALLBACK_REASONS`."""

    def __init__(self, reason: str, credential_id: uuid.UUID | None = None) -> None:
        assert reason in CALLBACK_REASONS, reason
        super().__init__(reason)
        self.reason = reason
        self.credential_id = credential_id


# ---------------------------------------------------------------------------------- seams


def graph_transport(settings, access_token: str) -> MetaGraphTransport:
    """The one place this module gets a transport. Tests replace it with a scripted fake."""
    return MetaGraphTransport(
        access_token=access_token,
        api_base_url=settings.meta_graph_api_base_url,
        api_version=settings.meta_graph_api_version,
        timeout_seconds=settings.meta_timeout_seconds,
    )


def _app_token(settings) -> str:
    """The app access token `debug_token` requires (T8). Server configuration, never stored."""
    return f"{settings.meta_app_id.strip()}|{settings.meta_app_secret.strip()}"


# ------------------------------------------------------------------------------- facts


@dataclass
class TokenFacts:
    """What `debug_token` said about a token, reduced to allowlisted fields."""

    is_valid: bool
    app_id: str | None
    kind: ReaderCredentialKind | None
    raw_type: str | None
    user_id: str | None
    scopes: list[str]
    issued_at: datetime | None
    expires_at: datetime | None
    data_access_expires_at: datetime | None
    error_subcode: int | None


def _ts(value: Any) -> datetime | None:
    """Meta reports Unix seconds; `0` means "does not expire" and becomes `None`."""
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        return None
    if seconds <= 0:
        return None
    return datetime.fromtimestamp(seconds, tz=UTC)


def parse_debug_token(payload: dict) -> TokenFacts:
    data = payload.get("data") if isinstance(payload, dict) else None
    data = data if isinstance(data, dict) else {}
    scopes: set[str] = set()
    for scope in data.get("scopes") or []:
        if isinstance(scope, str):
            scopes.add(scope)
    # With a system-user token the permissions may live only in `granular_scopes` (mb-connect).
    for entry in data.get("granular_scopes") or []:
        if isinstance(entry, dict) and isinstance(entry.get("scope"), str):
            scopes.add(entry["scope"])
    raw_type = str(data.get("type") or "").upper() or None
    kind = {
        "SYSTEM_USER": ReaderCredentialKind.SYSTEM_USER,
        "USER": ReaderCredentialKind.USER,
    }.get(raw_type or "")
    error = data.get("error") if isinstance(data.get("error"), dict) else {}
    subcode = error.get("subcode")
    return TokenFacts(
        is_valid=data.get("is_valid") is True,
        app_id=str(data["app_id"]) if data.get("app_id") is not None else None,
        kind=kind,
        raw_type=raw_type,
        user_id=str(data["user_id"]) if data.get("user_id") is not None else None,
        scopes=sorted(scope for scope in scopes if _SCOPE_NAME.match(scope)),
        issued_at=_ts(data.get("issued_at")),
        expires_at=_ts(data.get("expires_at")),
        data_access_expires_at=_ts(data.get("data_access_expires_at")),
        error_subcode=subcode if isinstance(subcode, int) and not isinstance(subcode, bool) else None,
    )


def refusal_reason(facts: TokenFacts, settings, *, now: datetime) -> str | None:
    """`None` if the token may be kept; otherwise why not. Order matters: a token for another app
    says nothing trustworthy about itself, and a write scope is refused even on a valid token."""
    if facts.app_id != (settings.meta_app_id or "").strip():
        return "app_mismatch"
    if not facts.is_valid:
        if facts.error_subcode in SUBCODE_REASONS:
            return SUBCODE_REASONS[facts.error_subcode]
        if facts.expires_at is not None and facts.expires_at <= now:
            return "expired"
        return "invalid_token"
    if any(scope in facts.scopes for scope in FORBIDDEN_SCOPES):
        return "scope_too_broad"
    if not all(scope in facts.scopes for scope in REQUIRED_SCOPES):
        return "scope_missing"
    return None


def derived_state(credential: MetaReaderCredential, settings=None, *, now: datetime | None = None) -> str:
    """What the UI shows. `expiring` is computed from `expires_at`, never stored (rule 28)."""
    settings = settings or get_settings()
    now = now or datetime.now(UTC)
    if credential.status != ReaderCredentialStatus.ACTIVE:
        return credential.status.value
    if credential.expires_at is not None and credential.expires_at - now <= timedelta(
        days=settings.credential_expiry_warning_days
    ):
        return "expiring"
    return "active"


# ------------------------------------------------------------------------- configuration


def login_availability(settings=None) -> tuple[bool, str | None]:
    """Whether *Connect* can work at all, and if not the one reason why. Never a value."""
    settings = settings or get_settings()
    if not settings.meta_login_configured:
        return False, "not_configured"
    if not vault_configured(settings):
        return False, "vault_unavailable"
    return True, None


def config_kind(settings=None) -> str:
    settings = settings or get_settings()
    kind = (settings.meta_login_config_kind or "").strip().lower()
    return kind if kind in ("system_user", "user") else "system_user"


def frontend_base_url(settings=None) -> str | None:
    """Where the callback sends the browser back to: `PUBLIC_APP_URL`, else the first CORS
    origin. Both are server configuration — never a value from the request, so the callback
    cannot be turned into an open redirect."""
    settings = settings or get_settings()
    for candidate in [settings.public_app_url, *settings.cors_origins]:
        parsed = urlparse((candidate or "").strip())
        if parsed.scheme in ("http", "https") and parsed.hostname:
            return (candidate or "").strip().rstrip("/")
    return None


def callback_redirect(settings, *, ok: bool, reason: str | None, credential_id: uuid.UUID | None) -> str:
    base = frontend_base_url(settings) or ""
    query: dict[str, str] = {"meta_login": "ok" if ok else "error"}
    if reason:
        query["reason"] = reason if reason in CALLBACK_REASONS else "token_check_failed"
    if credential_id:
        query["reader"] = str(credential_id)
    return f"{base}{SETTINGS_SECTION_PATH}?{urlencode(query)}#meta-readers"


# ------------------------------------------------------------------------------ service


@dataclass
class CheckOutcome:
    """One credential's share of a check. Counters only; no value Meta returned."""

    credential: MetaReaderCredential
    result: str = "valid"  # valid | reconnect_required | pending | rate_limited | failed | vault_unavailable
    renewed: bool = False
    renew_not_extended: bool = False
    businesses_added: int = 0
    businesses_not_listed: int = 0
    expiring: bool = False
    gets: int = 0


@dataclass
class _GetCounter:
    count: int = 0
    calls: list[str] = field(default_factory=list)


class MetaReaderCredentialService:
    def __init__(
        self,
        session: Session,
        workspace_id: uuid.UUID,
        audit: AuditLogService,
        *,
        settings=None,
    ) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit
        self.settings = settings or get_settings()

    # ------------------------------------------------------------------ reads
    def get(self, credential_id: uuid.UUID) -> MetaReaderCredential:
        credential = self.session.execute(
            sa.select(MetaReaderCredential).where(
                MetaReaderCredential.id == credential_id,
                MetaReaderCredential.workspace_id == self.workspace_id,
                MetaReaderCredential.archived_at.is_(None),
            )
        ).scalar_one_or_none()
        if credential is None:
            raise NotFoundError("Meta reader credential not found.")
        return credential

    def list(self) -> list[MetaReaderCredential]:
        return list(
            self.session.execute(
                sa.select(MetaReaderCredential)
                .where(
                    MetaReaderCredential.workspace_id == self.workspace_id,
                    MetaReaderCredential.archived_at.is_(None),
                )
                .order_by(MetaReaderCredential.connected_at.asc(), MetaReaderCredential.id.asc())
            ).scalars().all()
        )

    def connections_for(self, credential: MetaReaderCredential) -> list[MetaConnection]:
        return list(
            self.session.execute(
                sa.select(MetaConnection)
                .where(
                    MetaConnection.workspace_id == self.workspace_id,
                    MetaConnection.archived_at.is_(None),
                    MetaConnection.reader_credential_id == credential.id,
                )
                .order_by(MetaConnection.created_at.asc(), MetaConnection.id.asc())
            ).scalars().all()
        )

    def serialize(self, credential: MetaReaderCredential, *, now: datetime | None = None) -> dict[str, Any]:
        """Everything that may be disclosed (rule 40) — and nothing else. Never the ciphertext."""
        now = now or datetime.now(UTC)
        connections = self.connections_for(credential)
        bound = {(c.business_manager_reference or "").strip() for c in connections}
        seen = [
            {
                "external_id": str(item.get("external_id") or ""),
                "name": item.get("name") or None,
                "permitted_roles": item.get("permitted_roles") or None,
                "bound_here": str(item.get("external_id") or "") in bound,
            }
            for item in (credential.businesses_seen_json or [])
            if isinstance(item, dict)
        ]
        return {
            "id": str(credential.id),
            "label": credential.label,
            "kind": credential.kind.value,
            "status": credential.status.value,
            "derived_state": derived_state(credential, self.settings, now=now),
            "provider_user_external_id": credential.provider_user_external_id,
            "provider_user_name": credential.provider_user_name,
            # F1: the person, as the owner recorded it (with a System User, Meta only names the system user).
            "personal_account_reference_id": (
                str(credential.personal_account_reference_id) if credential.personal_account_reference_id else None
            ),
            "scopes": list(credential.scopes_json or []),
            "issued_at": _iso(credential.issued_at),
            "expires_at": _iso(credential.expires_at),
            "data_access_expires_at": _iso(credential.data_access_expires_at),
            "last_verified_at": _iso(credential.last_verified_at),
            "last_verify_outcome": credential.last_verify_outcome,
            "reconnect_reason": credential.reconnect_reason,
            "businesses_seen": seen,
            "connections": [
                {
                    "id": str(c.id),
                    "label": c.label,
                    "business_manager_reference": (c.business_manager_reference or "").strip() or None,
                }
                for c in connections
            ],
            "connected_at": _iso(credential.connected_at),
            "secret_last_rotated_at": _iso(credential.secret_last_rotated_at),
            "revoked_at": _iso(credential.revoked_at),
        }

    # ---------------------------------------------------------- connect start
    def start_connect(
        self,
        *,
        actor: User,
        label: str,
        business_manager_reference: str | None,
        reconnect: MetaReaderCredential | None = None,
    ) -> str:
        """Sign a `state` and return Meta's Login dialog URL. Makes no outbound call."""
        available, reason = login_availability(self.settings)
        if not available:
            raise ConflictError(
                "Connecting a Facebook account is not configured on this server.",
                details={"reason": reason},
            )
        label = (label or "").strip()
        bm_reference = canonical_external_id(business_manager_reference or "") or ""
        if business_manager_reference and (not bm_reference or not bm_reference.isdigit()):
            raise ValidationError(
                "A Business Manager id is a number, as shown in Business Settings.",
                details={"field": "business_manager_reference"},
            )
        if reconnect is not None:
            if reconnect.status == ReaderCredentialStatus.REVOKED:
                raise ConflictError(
                    "A revoked credential cannot be reconnected. Connect a new one instead.",
                    details={"reason": "credential_revoked"},
                )
            label = label or reconnect.label
            if not bm_reference and reconnect.kind == ReaderCredentialKind.SYSTEM_USER:
                bm_reference = self._bound_business(reconnect) or ""
        if not label:
            raise ValidationError("Give this connection a label.", details={"field": "label"})
        if config_kind(self.settings) == "system_user" and not bm_reference:
            # The system-user token cannot name its business (measured 2026-09-10); the owner
            # names the one they will pick in Meta's dialog, and verification proves it.
            raise ValidationError(
                "Enter the Business Manager id you will choose in Meta's dialog.",
                details={"field": "business_manager_reference", "reason": "business_manager_required"},
            )
        payload = {
            "w": str(self.workspace_id),
            "u": str(actor.id),
            "l": label[:200],
            "b": bm_reference or None,
            "c": str(reconnect.id) if reconnect is not None else None,
            "n": secrets.token_hex(8),
        }
        state = sign_state(self.settings, payload)
        version = self.settings.meta_graph_api_version.strip()
        query = urlencode(
            {
                "client_id": self.settings.meta_app_id.strip(),
                "redirect_uri": self.settings.meta_oauth_redirect_uri.strip(),
                "state": state,
                "config_id": self.settings.meta_login_config_id.strip(),
                "response_type": "code",
                "override_default_response_type": "true",
            }
        )
        self.audit.record(
            action="meta_reader_credential.connect_started",
            entity_type="meta_reader_credential",
            entity_id=reconnect.id if reconnect is not None else "new",
            metadata={
                "label": label[:200],
                "business_manager_reference": bm_reference or None,
                "reconnect": reconnect is not None,
                "config_kind": config_kind(self.settings),
            },
        )
        return f"https://www.facebook.com/{version}/dialog/oauth?{query}"

    def _bound_business(self, credential: MetaReaderCredential) -> str | None:
        for connection in self.connections_for(credential):
            reference = (connection.business_manager_reference or "").strip()
            if reference:
                return reference
        return None

    # ---------------------------------------------------------------- callback
    def complete_callback(
        self, *, state_payload: dict, code: str, actor: User
    ) -> MetaReaderCredential:
        """Exchange, inspect, refuse or store, then verify. Raises `CredentialFlowError`.

        `state_payload` is already verified and its workspace matches this service's. Nothing is
        stored for any refusal; a stored credential that then fails verification stays
        `pending_verification` (never read with) and the error says why.
        """
        if not code:
            raise CredentialFlowError("code_missing")
        now = datetime.now(UTC)
        token = self._exchange_code(code)
        facts = self._inspect(token)
        reason = refusal_reason(facts, self.settings, now=now)
        if reason is not None:
            raise CredentialFlowError(reason)
        if facts.kind is None:
            raise CredentialFlowError("unsupported_token_type")
        if facts.kind == ReaderCredentialKind.USER and (
            facts.expires_at is not None and facts.expires_at - now < SHORT_LIVED_BELOW
        ):
            # A short-lived user token (about two hours) would die before the first sweep. The
            # long-lived exchange is documented (T2); the result is inspected again, not trusted.
            exchanged = self._exchange_long_lived(token)
            if exchanged:
                exchanged_facts = self._inspect(exchanged)
                if refusal_reason(exchanged_facts, self.settings, now=now) is None:
                    token, facts = exchanged, exchanged_facts

        bm_reference = str(state_payload.get("b") or "") or None
        if facts.kind == ReaderCredentialKind.SYSTEM_USER and not bm_reference:
            raise CredentialFlowError("business_manager_required")

        reconnect_id = state_payload.get("c")
        if reconnect_id:
            try:
                credential = self.get(uuid.UUID(str(reconnect_id)))
            except (ValueError, NotFoundError):
                raise CredentialFlowError("invalid_state") from None
            if credential.status == ReaderCredentialStatus.REVOKED:
                raise CredentialFlowError("credential_revoked", credential.id)
            if (
                credential.provider_user_external_id
                and facts.user_id != credential.provider_user_external_id
            ) or credential.kind != facts.kind:
                # A different Facebook identity is a different credential, bound explicitly —
                # never a quiet swap of who reads these Business Managers.
                raise CredentialFlowError("user_mismatch", credential.id)
            before = self._audit_view(credential)
            credential.encrypted_secret = self._encrypt(token)
            credential.secret_last_rotated_at = now
            credential.status = ReaderCredentialStatus.PENDING_VERIFICATION
            credential.reconnect_reason = None
            self._apply_facts(credential, facts)
            self.session.flush()
            self.audit.record(
                action="meta_reader_credential.renewed",
                entity_type="meta_reader_credential",
                entity_id=credential.id,
                before=before,
                after=self._audit_view(credential),
                metadata={"via": "oauth_callback", "reconnect": True},
            )
        else:
            credential = MetaReaderCredential(
                workspace_id=self.workspace_id,
                label=str(state_payload.get("l") or "Meta reader")[:200],
                kind=facts.kind,
                status=ReaderCredentialStatus.PENDING_VERIFICATION,
                encrypted_secret=self._encrypt(token),
                secret_last_rotated_at=now,
                provider_user_external_id=facts.user_id,
                connected_by=actor.id,
                connected_at=now,
            )
            self._apply_facts(credential, facts)
            self.session.add(credential)
            self.session.flush()
            self.audit.record(
                action="meta_reader_credential.connected",
                entity_type="meta_reader_credential",
                entity_id=credential.id,
                after=self._audit_view(credential),
                metadata={"via": "oauth_callback"},
            )

        failure = self._verify_and_bind(credential, token, bm_reference=bm_reference, actor_id=actor.id)
        if failure is not None:
            raise CredentialFlowError(failure, credential.id)
        return credential

    def _encrypt(self, token: str) -> str:
        try:
            return encrypt_secret(self.settings, token)
        except VaultNotConfiguredError:
            raise CredentialFlowError("vault_unavailable") from None

    def _exchange_code(self, code: str) -> str:
        response = graph_transport(self.settings, "").get(
            "oauth/access_token",
            {
                "client_id": self.settings.meta_app_id.strip(),
                "client_secret": self.settings.meta_app_secret.strip(),
                "redirect_uri": self.settings.meta_oauth_redirect_uri.strip(),
                "code": code,
            },
        )
        token = response.payload.get("access_token") if response.ok else None
        if not isinstance(token, str) or not token:
            raise CredentialFlowError(
                "rate_limited" if response.failure_code is MetaFailureCode.RATE_LIMITED else "code_exchange_failed"
            )
        return token

    def _exchange_long_lived(self, token: str) -> str | None:
        response = graph_transport(self.settings, "").get(
            "oauth/access_token",
            {
                "grant_type": "fb_exchange_token",
                "client_id": self.settings.meta_app_id.strip(),
                "client_secret": self.settings.meta_app_secret.strip(),
                "fb_exchange_token": token,
            },
        )
        exchanged = response.payload.get("access_token") if response.ok else None
        return exchanged if isinstance(exchanged, str) and exchanged else None

    def _inspect(self, token: str) -> TokenFacts:
        response = self._debug_token(token)
        if not response.ok:
            raise CredentialFlowError(
                "rate_limited" if response.failure_code is MetaFailureCode.RATE_LIMITED else "token_check_failed"
            )
        return parse_debug_token(response.payload)

    def _debug_token(self, token: str) -> GraphResponse:
        return graph_transport(self.settings, _app_token(self.settings)).get(
            "debug_token", {"input_token": token}
        )

    @staticmethod
    def _apply_facts(credential: MetaReaderCredential, facts: TokenFacts) -> None:
        credential.scopes_json = list(facts.scopes)
        credential.issued_at = facts.issued_at
        credential.expires_at = facts.expires_at
        credential.data_access_expires_at = facts.data_access_expires_at
        if facts.user_id and not credential.provider_user_external_id:
            credential.provider_user_external_id = facts.user_id

    @staticmethod
    def _audit_view(credential: MetaReaderCredential) -> dict[str, Any]:
        """The audit shape. Never `encrypted_secret` — and the redactor would mask it anyway."""
        return {
            "label": credential.label,
            "kind": credential.kind.value if credential.kind else None,
            "status": credential.status.value if credential.status else None,
            "scopes": list(credential.scopes_json or []),
            "expires_at": _iso(credential.expires_at),
            "provider_user_external_id": credential.provider_user_external_id,
            "reconnect_reason": credential.reconnect_reason,
        }

    # ------------------------------------------------------------ verification
    def _verify_and_bind(
        self,
        credential: MetaReaderCredential,
        token: str,
        *,
        bm_reference: str | None,
        actor_id: uuid.UUID | None,
        counter: _GetCounter | None = None,
        max_gets: int | None = None,
    ) -> str | None:
        """Prove the credential can read before anything reads with it. `None` on success
        (credential `active`), else the reason (credential stays `pending_verification`).

        Inside a SAVEPOINT: a defect here rolls back the binding, never the stored credential."""
        counter = counter or _GetCounter()
        transport = graph_transport(self.settings, token)
        try:
            with self.session.begin_nested():
                if credential.kind == ReaderCredentialKind.SYSTEM_USER:
                    reason = self._verify_system_user(credential, transport, bm_reference, actor_id, counter)
                else:
                    reason, _, _ = self._refresh_businesses(credential, transport, actor_id, counter)
                if reason is None and (max_gets is None or counter.count < max_gets):
                    # Who granted it, so four credentials can be told apart. Skipped when the
                    # scheduled check has already spent its three GETs.
                    identity = RealMetaBusinessProvider(transport=transport).identify()
                    counter.count += 1
                    if identity.name:
                        credential.provider_user_name = identity.name[:200]
        except CredentialFlowError as exc:
            reason = exc.reason
        except Exception as exc:  # noqa: BLE001 - a defect must not activate a credential
            logger.exception("reader_credential_verify_failed", extra={"error_type": type(exc).__name__})
            reason = "token_check_failed"

        now = datetime.now(UTC)
        before = self._audit_view(credential)
        credential.last_verified_at = now
        if reason is None:
            credential.status = ReaderCredentialStatus.ACTIVE
            credential.reconnect_reason = None
            credential.last_verify_outcome = "valid"
            self.session.flush()
            self.audit.record(
                action="meta_reader_credential.verified",
                entity_type="meta_reader_credential",
                entity_id=credential.id,
                before=before,
                after=self._audit_view(credential),
                metadata={"outcome": "valid"},
            )
            self._resolve_alerts(credential, kinds=("reconnect",), reason="The credential was reconnected and verified.")
            return None
        credential.reconnect_reason = reason
        credential.last_verify_outcome = reason
        self.session.flush()
        self.audit.record(
            action="meta_reader_credential.verification_failed",
            entity_type="meta_reader_credential",
            entity_id=credential.id,
            before=before,
            after=self._audit_view(credential),
            metadata={"outcome": reason},
        )
        return reason

    def _verify_system_user(
        self,
        credential: MetaReaderCredential,
        transport: MetaGraphTransport,
        bm_reference: str | None,
        actor_id: uuid.UUID | None,
        counter: _GetCounter,
    ) -> str | None:
        if not bm_reference:
            return "business_manager_required"
        provider = RealMetaBusinessProvider(transport=transport, business_id=bm_reference)
        found, response = provider._read_business_managers(limit="1")
        counter.count += 1
        if not response.ok:
            if response.failure_code is MetaFailureCode.RATE_LIMITED:
                return "rate_limited"
            return "business_not_readable"
        if not found:
            return "business_not_readable"
        # A system user can read a business node it has no role in (measured 2026-09-11);
        # only a member reads `{bm}/system_users`. The BM the owner typed must be the one they
        # chose in Meta's dialog — refused otherwise, never bound on the owner's word alone.
        authority = provider.check_business_authority(bm_reference)
        counter.count += 1
        if authority != BusinessAuthority.ESTABLISHED:
            return "business_not_readable"
        name = found[0].get("name") or None
        credential.businesses_seen_json = [
            {"external_id": bm_reference, "name": name, "permitted_roles": None}
        ]
        self._bind_business(credential, bm_reference, name, actor_id)
        return None

    def _read_businesses(
        self, transport: MetaGraphTransport, counter: _GetCounter
    ) -> tuple[list[dict] | None, GraphResponse | None]:
        rows: list[dict] = []
        cursor: str | None = None
        last: GraphResponse | None = None
        for _ in range(MAX_BUSINESS_PAGES):
            params = {"fields": "id,name,permitted_roles", "limit": "100"}
            if cursor:
                params["after"] = cursor
            last = transport.get("me/businesses", params)
            counter.count += 1
            if not last.ok:
                return None, last
            for row in last.payload.get("data", []) or []:
                if not isinstance(row, dict):
                    continue
                external_id = canonical_external_id(row.get("id"))
                if not external_id or not external_id.isdigit():
                    continue
                roles = row.get("permitted_roles")
                rows.append(
                    {
                        "external_id": external_id,
                        "name": str(row.get("name") or "")[:200] or None,
                        "permitted_roles": [str(r)[:40] for r in roles if isinstance(r, str)][:10]
                        if isinstance(roles, list)
                        else None,
                    }
                )
            paging = last.payload.get("paging")
            if not isinstance(paging, dict) or not paging.get("next"):
                break
            cursors = paging.get("cursors") if isinstance(paging.get("cursors"), dict) else {}
            cursor = cursors.get("after")
            if not cursor:
                break
        return rows, last

    def _refresh_businesses(
        self,
        credential: MetaReaderCredential,
        transport: MetaGraphTransport,
        actor_id: uuid.UUID | None,
        counter: _GetCounter,
    ) -> tuple[str | None, int, int]:
        """`me/businesses` for a user token: record what it sees, bind or create a connection for
        each Business Manager, and flag (never archive) a bound one that is no longer listed."""
        rows, response = self._read_businesses(transport, counter)
        if rows is None:
            if response is not None and response.failure_code is MetaFailureCode.RATE_LIMITED:
                return "rate_limited", 0, 0
            return "businesses_unreadable", 0, 0
        credential.businesses_seen_json = rows
        added = 0
        for row in rows:
            if self._bind_business(credential, row["external_id"], row.get("name"), actor_id):
                added += 1
        listed = {row["external_id"] for row in rows}
        not_listed = 0
        for connection in self.connections_for(credential):
            reference = (connection.business_manager_reference or "").strip()
            if reference and reference not in listed:
                not_listed += 1
                self._raise_alert(
                    credential,
                    kind="not_listed",
                    key_suffix=f"not_listed:{reference}",
                    severity=AlertSeverity.INFO,
                    title=f"Business Manager {reference} no longer listed for {credential.label}",
                    summary=(
                        f"The Facebook account behind {credential.label} no longer lists Business "
                        f"Manager {reference}. Nothing was archived; reads continue and record "
                        "whatever Meta answers."
                    ),
                    reason="business_manager_not_listed",
                    next_step="Check the account's role in that Business Manager's Business Settings.",
                )
        return None, added, not_listed

    def _bind_business(
        self,
        credential: MetaReaderCredential,
        business_id: str,
        name: str | None,
        actor_id: uuid.UUID | None,
    ) -> bool:
        """Bind this credential to the Business Manager's connection, or create one. `True` when a
        connection was created.

        Chosen once and never switched by the system (Constraint 9): a connection already bound to
        another credential is left alone — the owner switches it explicitly
        (`assign_to_connection`). A new connection is `production` with both O3 switches off.
        """
        candidates = list(
            self.session.execute(
                sa.select(MetaConnection)
                .where(
                    MetaConnection.workspace_id == self.workspace_id,
                    MetaConnection.archived_at.is_(None),
                    MetaConnection.environment == MetaEnvironment.PRODUCTION,
                    MetaConnection.business_manager_reference == business_id,
                )
                .order_by(MetaConnection.created_at.asc(), MetaConnection.id.asc())
            ).scalars().all()
        )
        if any(c.reader_credential_id == credential.id for c in candidates):
            return False
        if candidates:
            free = next((c for c in candidates if c.reader_credential_id is None), None)
            if free is None:
                return False  # bound to another credential: the owner decides
            free.reader_credential_id = credential.id
            free.updated_by = actor_id
            self.session.flush()
            self.audit.record(
                action="meta_reader_credential.assigned_to_connection",
                entity_type="meta_connection",
                entity_id=free.id,
                after={"vault_reader_id": str(credential.id), "business_manager_reference": business_id},
                metadata={"via": "connect", "reader_label": credential.label},
            )
            return False
        created_by = actor_id or credential.connected_by
        connection = MetaConnection(
            workspace_id=self.workspace_id,
            label=f"{credential.label} — {name or business_id}"[:200],
            environment=MetaEnvironment.PRODUCTION,
            status=ReferenceStatus.UNKNOWN,
            business_manager_reference=business_id,
            notes="Created from a Facebook Login for Business connection (O4).",
            created_by=created_by,
            reader_credential_id=credential.id,
        )
        self.session.add(connection)
        self.session.flush()
        self.audit.record(
            action="meta_connection.created_from_credential",
            entity_type="meta_connection",
            entity_id=connection.id,
            after={
                "label": connection.label,
                "environment": connection.environment.value,
                "business_manager_reference": business_id,
                "vault_reader_id": str(credential.id),
                "auto_discovery_enabled": False,
                "auto_import_enabled": False,
            },
            metadata={"reader_label": credential.label},
        )
        return True

    # ----------------------------------------------------------------- check
    def check(self, credential: MetaReaderCredential, *, actor_id: uuid.UUID | None = None) -> CheckOutcome:
        """Liveness, expiry, and (user tokens) what Business Managers it lists. ≤ 3 GETs.

        Used by `POST /{id}/verify` and `credential_check_pass`. A failure to *ask* Meta
        (rate limit, timeout, a wrong app secret on our side) never kills a credential; only
        `debug_token` saying the token is invalid, expired or under-scoped does.
        """
        outcome = CheckOutcome(credential=credential)
        counter = _GetCounter()
        now = datetime.now(UTC)
        if not vault_configured(self.settings):
            # The server lost its key (a deployment slip, not Meta's verdict). Reads already stop
            # — `resolve_reader` cannot open anything — but no credential is marked dead for it:
            # restoring the key restores every credential, with no reconnect needed.
            outcome.result = "vault_unavailable"
            return outcome
        token, source = resolve_reader(self.settings, None, credential=credential, include_unverified=True)
        if source != READER_VAULT:
            # A key is configured and it cannot open this ciphertext: the key was changed. There
            # is no rotation in O4, so this credential needs reconnecting.
            self._mark_reconnect(credential, "vault_unavailable", actor_id=actor_id)
            outcome.result = "reconnect_required"
            return outcome

        response = self._debug_token(token)
        counter.count += 1
        if not response.ok:
            credential.last_verify_outcome = (response.failure_code or MetaFailureCode.UNKNOWN_ERROR).value
            self.session.flush()
            outcome.result = "rate_limited" if response.failure_code is MetaFailureCode.RATE_LIMITED else "failed"
            outcome.gets = counter.count
            return outcome
        facts = parse_debug_token(response.payload)
        reason = refusal_reason(facts, self.settings, now=now)
        if reason is not None:
            self._mark_reconnect(credential, reason, actor_id=actor_id)
            outcome.result = "reconnect_required"
            outcome.gets = counter.count
            return outcome

        before_expiry = credential.expires_at
        self._apply_facts(credential, facts)
        credential.last_verified_at = now
        credential.last_verify_outcome = "valid"
        self.session.flush()

        if credential.status == ReaderCredentialStatus.PENDING_VERIFICATION:
            bm_reference = self._bound_business(credential) or next(
                (str(item.get("external_id")) for item in (credential.businesses_seen_json or []) if isinstance(item, dict)),
                None,
            )
            failure = self._verify_and_bind(
                credential, token, bm_reference=bm_reference, actor_id=actor_id, counter=counter, max_gets=3
            )
            outcome.result = "valid" if failure is None else ("rate_limited" if failure == "rate_limited" else "pending")
        elif credential.kind == ReaderCredentialKind.USER:
            renew_window = timedelta(days=self.settings.credential_renew_before_days)
            if credential.expires_at is not None and credential.expires_at - now <= renew_window:
                self._try_renew(credential, token, outcome, counter, previous_expiry=before_expiry)
            else:
                transport = graph_transport(self.settings, token)
                try:
                    with self.session.begin_nested():
                        failure, added, not_listed = self._refresh_businesses(credential, transport, actor_id, counter)
                except Exception as exc:  # noqa: BLE001 - one defect costs this step only
                    logger.exception("reader_credential_businesses_failed", extra={"error_type": type(exc).__name__})
                    failure, added, not_listed = "businesses_unreadable", 0, 0
                outcome.businesses_added = added
                outcome.businesses_not_listed = not_listed
                if failure == "rate_limited":
                    outcome.result = "rate_limited"
            self.audit.record(
                action="meta_reader_credential.verified",
                entity_type="meta_reader_credential",
                entity_id=credential.id,
                after=self._audit_view(credential),
                metadata={"outcome": "valid", "renewed": outcome.renewed, "renew_not_extended": outcome.renew_not_extended},
            )
        else:
            self.audit.record(
                action="meta_reader_credential.verified",
                entity_type="meta_reader_credential",
                entity_id=credential.id,
                after=self._audit_view(credential),
                metadata={"outcome": "valid"},
            )

        self._expiry_alert(credential, outcome, now=now)
        outcome.gets = counter.count
        return outcome

    def _try_renew(
        self,
        credential: MetaReaderCredential,
        token: str,
        outcome: CheckOutcome,
        counter: _GetCounter,
        *,
        previous_expiry: datetime | None,
    ) -> None:
        """T4 measured on every pass instead of trusted: try one `fb_exchange_token`, keep the
        result only if `debug_token` says it expires later. Two GETs; `me/businesses` waits for
        the next pass so the check stays within three."""
        exchanged = self._exchange_long_lived(token)
        counter.count += 1
        if not exchanged:
            outcome.renew_not_extended = True
            return
        response = self._debug_token(exchanged)
        counter.count += 1
        if not response.ok:
            outcome.renew_not_extended = True
            return
        facts = parse_debug_token(response.payload)
        current = credential.expires_at
        if (
            refusal_reason(facts, self.settings, now=datetime.now(UTC)) is not None
            or facts.user_id != credential.provider_user_external_id
            or facts.expires_at is None
            or current is None
            or facts.expires_at <= current
        ):
            outcome.renew_not_extended = True
            return
        before = self._audit_view(credential)
        credential.encrypted_secret = encrypt_secret(self.settings, exchanged)
        credential.secret_last_rotated_at = datetime.now(UTC)
        self._apply_facts(credential, facts)
        self.session.flush()
        outcome.renewed = True
        self.audit.record(
            action="meta_reader_credential.renewed",
            entity_type="meta_reader_credential",
            entity_id=credential.id,
            before=before,
            after=self._audit_view(credential),
            metadata={
                "via": "fb_exchange_token",
                "previous_expires_at": _iso(previous_expiry or current),
                "new_expires_at": _iso(facts.expires_at),
            },
        )

    def _mark_reconnect(self, credential: MetaReaderCredential, reason: str, *, actor_id: uuid.UUID | None) -> None:
        before = self._audit_view(credential)
        was = credential.status
        credential.status = ReaderCredentialStatus.RECONNECT_REQUIRED
        credential.reconnect_reason = reason
        credential.last_verified_at = datetime.now(UTC)
        credential.last_verify_outcome = reason
        self.session.flush()
        if was != ReaderCredentialStatus.RECONNECT_REQUIRED:
            self.audit.record(
                action="meta_reader_credential.reconnect_required",
                entity_type="meta_reader_credential",
                entity_id=credential.id,
                before=before,
                after=self._audit_view(credential),
                metadata={"reason": reason},
            )
        connections, accounts = self._blast_radius(credential)
        self._raise_alert(
            credential,
            kind="reconnect",
            key_suffix="reconnect",
            severity=AlertSeverity.CRITICAL,
            title=f"Meta reader needs reconnecting — {credential.label}",
            summary=(
                f"Meta reports the credential {credential.label} can no longer be used ({reason}). "
                f"Nothing is read through it: {connections} connection(s) and {accounts} ad "
                "account(s) are not observable until it is reconnected."
            ),
            reason=reason,
            next_step=RECONNECT_NEXT_STEPS.get(reason, DEFAULT_NEXT_STEP),
            extra={"connections_affected": connections, "accounts_affected": accounts},
        )
        self._resolve_alerts(credential, kinds=("expiring",), reason="Superseded: the credential needs reconnecting.")

    def _blast_radius(self, credential: MetaReaderCredential) -> tuple[int, int]:
        references = {
            (c.business_manager_reference or "").strip()
            for c in self.connections_for(credential)
            if (c.business_manager_reference or "").strip()
        }
        if not references:
            return 0, 0
        accounts = int(
            self.session.execute(
                sa.select(sa.func.count())
                .select_from(AdAccount)
                .join(BusinessManager, BusinessManager.id == AdAccount.business_manager_id)
                .where(
                    AdAccount.workspace_id == self.workspace_id,
                    AdAccount.archived_at.is_(None),
                    BusinessManager.archived_at.is_(None),
                    BusinessManager.external_id.in_(references),
                )
            ).scalar_one()
        )
        return len(self.connections_for(credential)), accounts

    def _expiry_alert(self, credential: MetaReaderCredential, outcome: CheckOutcome, *, now: datetime) -> None:
        if credential.status != ReaderCredentialStatus.ACTIVE:
            return
        expires = credential.expires_at
        window = timedelta(days=self.settings.credential_expiry_warning_days)
        if expires is not None and expires - now <= window:
            outcome.expiring = True
            date = expires.date().isoformat()
            self._resolve_alerts(
                credential,
                kinds=("expiring",),
                reason="Superseded: the expiry date changed.",
                keep_key=self._key(credential, f"expiring:{date}"),
            )
            self._raise_alert(
                credential,
                kind="expiring",
                key_suffix=f"expiring:{date}",
                severity=AlertSeverity.WARNING,
                title=f"Meta reader expires {date} — {credential.label}",
                summary=(
                    f"The credential {credential.label} expires on {date}. Reads stop then unless "
                    "it is reconnected (or Meta extends it, which is counted, not assumed)."
                ),
                reason="expiring",
                next_step="Press Reconnect in Settings before that date.",
            )
        else:
            self._resolve_alerts(credential, kinds=("expiring",), reason="The credential no longer expires within the warning window.")

    # ----------------------------------------------------------------- alerts
    def _key(self, credential: MetaReaderCredential, suffix: str) -> str:
        return f"reader_credential:{credential.id}:{suffix}"

    def _raise_alert(
        self,
        credential: MetaReaderCredential,
        *,
        kind: str,
        key_suffix: str,
        severity: AlertSeverity,
        title: str,
        summary: str,
        reason: str,
        next_step: str,
        extra: dict | None = None,
    ) -> Alert | None:
        """One alert per standing condition: an active alert with the same key is touched, never
        duplicated, and no second message is planned (rule 16/17 — alerting only, in a SAVEPOINT
        so a failure here degrades alerting only, rule 21)."""
        from app.services.alert_service import AlertPolicyService
        from app.services.notification_service import NotificationPlannerService

        key = self._key(credential, key_suffix)
        now = datetime.now(UTC)
        try:
            with self.session.begin_nested():
                existing = self.session.execute(
                    sa.select(Alert).where(Alert.workspace_id == self.workspace_id, Alert.active_key == key)
                ).scalar_one_or_none()
                if existing is not None:
                    existing.last_observed_at = now
                    self.session.flush()
                    return None
                alert = Alert(
                    workspace_id=self.workspace_id,
                    ad_account_id=None,
                    source_type=AlertSourceType.READER_CREDENTIAL,
                    source_entity_type="meta_reader_credential",
                    source_entity_id=str(credential.id),
                    alert_key=key,
                    active_key=key,
                    category="reader_credential",
                    severity=severity,
                    status=AlertStatus.OPEN,
                    title=title[:200],
                    summary=summary,
                    source_snapshot_json=redact(
                        {
                            "alert_kind": kind,
                            "vault_reader_id": str(credential.id),
                            "reader_label": credential.label,
                            "reader_kind": credential.kind.value,
                            "granted_by": credential.provider_user_name or credential.provider_user_external_id,
                            "reason": reason,
                            "expires_at": _iso(credential.expires_at),
                            "recommended_next_step": next_step,
                            **(extra or {}),
                        }
                    ),
                    first_observed_at=now,
                    last_observed_at=now,
                )
                self.session.add(alert)
                self.session.flush()
                self.audit.record(
                    action="alert.created",
                    entity_type="alert",
                    entity_id=alert.id,
                    after=orm_snapshot(alert),
                    metadata={"source_type": alert.source_type.value, "severity": alert.severity.value},
                )
                policy = AlertPolicyService(self.session, self.workspace_id, self.audit).get_or_create()
                NotificationPlannerService(self.session, self.workspace_id, self.audit).plan(
                    alert, policy, None, reason=DeliveryReason.INITIAL
                )
                return alert
        except Exception as exc:  # noqa: BLE001 - alerting degrades alerting only (rule 21)
            logger.exception("reader_credential_alert_failed", extra={"error_type": type(exc).__name__})
            return None

    def _resolve_alerts(
        self,
        credential: MetaReaderCredential,
        *,
        kinds: tuple[str, ...],
        reason: str,
        keep_key: str | None = None,
    ) -> int:
        prefix = self._key(credential, "")
        rows = self.session.execute(
            sa.select(Alert).where(
                Alert.workspace_id == self.workspace_id,
                Alert.source_type == AlertSourceType.READER_CREDENTIAL,
                Alert.alert_key.like(f"{prefix}%"),
                Alert.status.in_(list(ACTIVE_ALERT_STATUSES)),
            )
        ).scalars().all()
        closed = 0
        for alert in rows:
            suffix = alert.alert_key[len(prefix):]
            if not any(suffix == kind or suffix.startswith(f"{kind}:") for kind in kinds):
                continue
            if keep_key and alert.alert_key == keep_key:
                continue
            before = orm_snapshot(alert)
            alert.status = AlertStatus.RESOLVED
            alert.active_key = None
            alert.resolved_at = datetime.now(UTC)
            alert.resolved_by = None
            alert.resolution_reason = reason
            self.session.flush()
            self.audit.record(
                action="alert.resolved",
                entity_type="alert",
                entity_id=alert.id,
                before=before,
                after=orm_snapshot(alert),
                metadata={"resolved_by": "source_condition"},
            )
            closed += 1
        return closed

    # ---------------------------------------------------------------- owner acts
    def revoke(self, credential: MetaReaderCredential, *, actor_id: uuid.UUID, reason: str) -> MetaReaderCredential:
        """Terminal. The ciphertext is cleared; the row, its history and the connections' pointer
        stay, so what was read with it remains attributable and nothing falls back to env."""
        if credential.status == ReaderCredentialStatus.REVOKED:
            raise ConflictError("This credential is already revoked.")
        before = self._audit_view(credential)
        now = datetime.now(UTC)
        credential.status = ReaderCredentialStatus.REVOKED
        credential.encrypted_secret = None
        credential.reconnect_reason = "revoked_by_owner"
        credential.revoked_by = actor_id
        credential.revoked_at = now
        credential.revoke_reason = (reason or "").strip()[:1000] or None
        self.session.flush()
        self.audit.record(
            action="meta_reader_credential.revoked",
            entity_type="meta_reader_credential",
            entity_id=credential.id,
            before=before,
            after=self._audit_view(credential),
            metadata={"reason": credential.revoke_reason},
        )
        self._resolve_alerts(
            credential, kinds=("reconnect", "expiring", "not_listed"), reason="The owner revoked this credential."
        )
        return credential

    def assign_to_connection(
        self, connection: MetaConnection, credential: MetaReaderCredential, *, actor_id: uuid.UUID
    ) -> MetaConnection:
        """The owner's explicit switch of which identity reads a Business Manager (G8)."""
        reference = (connection.business_manager_reference or "").strip()
        if connection.environment != MetaEnvironment.PRODUCTION:
            raise ConflictError(
                "Only a production connection can read with a vault credential.",
                details={"reason": "not_production"},
            )
        if not reference:
            raise ConflictError(
                "This connection does not name its own Business Manager.",
                details={"reason": "business_manager_not_configured"},
            )
        if credential.status != ReaderCredentialStatus.ACTIVE:
            raise ConflictError(
                "Only an active credential can be used for a connection.",
                details={"reason": "credential_not_active"},
            )
        seen = {
            str(item.get("external_id"))
            for item in (credential.businesses_seen_json or [])
            if isinstance(item, dict)
        }
        if reference not in seen:
            raise ConflictError(
                "This credential has not been seen reading that Business Manager.",
                details={"reason": "business_manager_not_seen"},
            )
        if connection.reader_credential_id == credential.id:
            return connection
        previous = connection.reader_credential_id
        connection.reader_credential_id = credential.id
        connection.updated_by = actor_id
        self.session.flush()
        self.audit.record(
            action="meta_reader_credential.assigned_to_connection",
            entity_type="meta_connection",
            entity_id=connection.id,
            before={"vault_reader_id": str(previous) if previous else None},
            after={"vault_reader_id": str(credential.id), "business_manager_reference": reference},
            metadata={"via": "owner", "reader_label": credential.label},
        )
        return connection


def owner_member(session: Session, workspace_id: uuid.UUID, user_id: uuid.UUID) -> User | None:
    """The callback has no session: the actor is the owner who pressed *Connect*, read from the
    signed state and re-checked here — still active, still the workspace owner."""
    user = session.get(User, user_id)
    if user is None or not user.is_active:
        return None
    member = session.execute(
        sa.select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
        )
    ).scalar_one_or_none()
    if member is None or member.role != WorkspaceRole.OWNER or getattr(member, "archived_at", None) is not None:
        return None
    return user


def read_state(settings, state: str) -> dict:
    try:
        payload = verify_state(settings, state)
        uuid.UUID(str(payload.get("w")))
        uuid.UUID(str(payload.get("u")))
    except (StateInvalidError, ValueError, TypeError):
        raise CredentialFlowError("invalid_state") from None
    return payload


def reader_credential_summary(session: Session, workspace_id: uuid.UUID, settings=None) -> dict[str, int]:
    """Counts for System Status. `expiring` is derived, so it is counted from rows, not a column."""
    settings = settings or get_settings()
    now = datetime.now(UTC)
    counts = {"active": 0, "expiring": 0, "pending_verification": 0, "reconnect_required": 0, "revoked": 0}
    for credential in session.execute(
        sa.select(MetaReaderCredential).where(
            MetaReaderCredential.workspace_id == workspace_id,
            MetaReaderCredential.archived_at.is_(None),
        )
    ).scalars():
        counts[derived_state(credential, settings, now=now)] += 1
    return counts


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None
