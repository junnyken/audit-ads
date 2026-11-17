"""SessionRegistryService (A9 Step 2 — session architecture first).

Dashboard JWTs are stateless: signature + `exp` only, nothing checked server-side once issued
(see `docs/AUDIT_BEFORE_BUILD_A9.md` §4). This module gives the dashboard the same revocable
shape A5's `ExtensionInstallation` already has for extension sessions — a `DeviceSession` row
carrying the JWT's `session_id` claim, re-loaded and re-checked on every request. Revoking sets
`revoked_at`; nothing waits for the token's own expiry.
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.enums import DeviceSessionType
from app.core.errors import ConflictError, NotFoundError
from app.models.team import DeviceSession
from app.services.audit import AuditLogService

#: Coarse enough to be a useful label, specific enough to be useless as a fingerprint.
_BROWSERS = ("Edg", "Chrome", "Firefox", "Safari")
_OS = (("Windows", "Windows"), ("Mac OS X", "macOS"), ("Android", "Android"), ("Linux", "Linux"), ("iPhone", "iOS"))

#: Throttle for `touch()` — a write on every request would turn "who's logged in" into a
#: write-storm the same way A2's health evaluation had to guard against per-account N+1 queries.
LAST_SEEN_THROTTLE = timedelta(minutes=5)


def _parse_user_agent(user_agent: str | None) -> tuple[str | None, str | None]:
    ua = user_agent or ""
    browser = next((name for name in _BROWSERS if name in ua), None)
    os_family = next((label for token, label in _OS if token in ua), None)
    return browser, os_family


def hash_ip(ip: str | None) -> str | None:
    """Salted with the server's own JWT secret — never the raw address, never reversible
    without a secret only this server holds (A9 guardrail 20)."""
    if not ip:
        return None
    salted = f"{get_settings().jwt_secret}:{ip}".encode()
    return hashlib.sha256(salted).hexdigest()


def default_label(browser_family: str | None, os_family: str | None) -> str:
    if browser_family and os_family:
        return f"{browser_family} on {os_family}"
    return browser_family or os_family or "Unknown browser"


class SessionRegistryService:
    def __init__(self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit

    def create(
        self, *, user_id: uuid.UUID, expires_at: datetime, user_agent: str | None, ip: str | None
    ) -> DeviceSession:
        browser_family, os_family = _parse_user_agent(user_agent)
        row = DeviceSession(
            workspace_id=self.workspace_id,
            user_id=user_id,
            session_type=DeviceSessionType.WEB,
            label=default_label(browser_family, os_family),
            browser_family=browser_family,
            os_family=os_family,
            ip_hash=hash_ip(ip),
            last_seen_at=datetime.now(UTC),
            expires_at=expires_at,
        )
        self.session.add(row)
        self.session.flush()
        # No audit row per sign-in: a login already has nowhere quieter to be noisy than here,
        # and `session_created` is listed as required in the spec — record it, but the actor
        # here is the session's own owner, matching every other self-service audit entry.
        self.audit.record(
            action="session.created",
            entity_type="device_session",
            entity_id=row.id,
            # Never a key containing "session" here — `SENSITIVE_NAME_FRAGMENTS` masks any such
            # key on principle (it could be a session token), so this domain's own field names
            # have to route around that rather than have a harmless value silently `[REDACTED]`.
            after={"label": row.label, "channel": row.session_type.value},
        )
        return row

    def get_active(self, session_id: uuid.UUID) -> DeviceSession | None:
        row = self.session.get(DeviceSession, session_id)
        if row is None or row.workspace_id != self.workspace_id:
            return None
        return row if row.is_active else None

    def touch(self, row: DeviceSession) -> None:
        now = datetime.now(UTC)
        if row.last_seen_at is not None and now - row.last_seen_at < LAST_SEEN_THROTTLE:
            return
        row.last_seen_at = now
        self.session.flush()

    def list_for_user(self, user_id: uuid.UUID) -> list[DeviceSession]:
        return list(
            self.session.execute(
                sa.select(DeviceSession)
                .where(DeviceSession.workspace_id == self.workspace_id, DeviceSession.user_id == user_id)
                .order_by(DeviceSession.created_at.desc())
            ).scalars().all()
        )

    def _get_owned(self, session_id: uuid.UUID, *, user_id: uuid.UUID) -> DeviceSession:
        row = self.session.execute(
            sa.select(DeviceSession).where(
                DeviceSession.id == session_id,
                DeviceSession.workspace_id == self.workspace_id,
                DeviceSession.user_id == user_id,
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFoundError("Device session not found.")
        return row

    def revoke_own(self, session_id: uuid.UUID, *, user_id: uuid.UUID, current_session_id: uuid.UUID) -> DeviceSession:
        """A9 guardrail 10: a user must not accidentally revoke their own current session
        through this endpoint — sign-out is a separate, existing flow."""
        if session_id == current_session_id:
            raise ConflictError(
                "You cannot revoke your current session here. Sign out instead."
            )
        row = self._get_owned(session_id, user_id=user_id)
        return self._revoke(row, reason="Revoked by the session's own owner.", actor_id=user_id)

    def logout_other_devices(self, *, user_id: uuid.UUID, current_session_id: uuid.UUID) -> int:
        rows = [
            row
            for row in self.list_for_user(user_id)
            if row.is_active and row.id != current_session_id
        ]
        for row in rows:
            self._revoke(row, reason="Logged out from another device.", actor_id=user_id)
        if rows:
            self.audit.record(
                action="sessions.logout_other_devices",
                entity_type="user",
                entity_id=user_id,
                after={"revoked_count": len(rows)},
            )
        return len(rows)

    def revoke_for_member(
        self, target_user_id: uuid.UUID, *, session_id: uuid.UUID | None, reason: str, actor_id: uuid.UUID
    ) -> int:
        """Owner-only path (enforced by the caller): revoke one specific session, or every
        active session, belonging to another member."""
        rows = [
            row
            for row in self.list_for_user(target_user_id)
            if row.is_active and (session_id is None or row.id == session_id)
        ]
        if session_id is not None and not rows:
            from app.core.errors import NotFoundError

            raise NotFoundError("Device session not found.")
        for row in rows:
            self._revoke(row, reason=reason, actor_id=actor_id)
        return len(rows)

    def revoke_all_for_member(self, target_user_id: uuid.UUID, *, reason: str, actor_id: uuid.UUID | None) -> int:
        """Used by member deactivation/suspension — every active session, no exceptions,
        because there is no "current session" concept from the actor performing this."""
        rows = [row for row in self.list_for_user(target_user_id) if row.is_active]
        for row in rows:
            self._revoke(row, reason=reason, actor_id=actor_id)
        return len(rows)

    def _revoke(self, row: DeviceSession, *, reason: str, actor_id: uuid.UUID | None) -> DeviceSession:
        row.revoked_at = datetime.now(UTC)
        row.revoked_by = actor_id
        row.revoked_reason = reason[:200]
        self.session.flush()
        self.audit.record(
            action="session.revoked",
            entity_type="device_session",
            entity_id=row.id,
            after={"revoked_reason": row.revoked_reason},
        )
        return row


__all__ = ["SessionRegistryService", "hash_ip", "default_label"]
