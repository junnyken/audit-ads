"""MINI-SPEC F1 — Facebook account profiles.

Answers one question for every ad account and every alert: *which Facebook account do I log in
to, to fix this?* A profile (`PersonalAccountReference`) records who holds the account, how its
second factor works, where its password is kept and which Business Managers it manages. It never
holds the password, a 2FA seed, a code or a cookie (rule 1 — schema validators refuse them).

The login email is the one sensitive value: stored as ciphertext (`secret_vault.encrypt_contact`),
shown masked everywhere, and returned in full by `reveal_email` only, after the viewer's own PIN
matched (`RevealPinService`). Every reveal writes an audit row that never contains the email.
"""
from __future__ import annotations

import re
import uuid
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import secret_vault
from app.core.enums import IdentityBusinessRole, WorkspaceRole
from app.core.errors import AuthorizationError, ConflictError, DomainError, NotFoundError, ValidationError
from app.core.security import hash_password, verify_password
from app.models.entities import (
    AdAccount,
    BusinessManager,
    PersonalAccountBusinessLink,
    PersonalAccountReference,
    User,
    WorkspaceMember,
)
from app.models.meta_reader_credential import MetaReaderCredential
from app.services.audit import AuditLogService
from app.services.base import get_or_404, require_active
from app.services.references import ReferenceService

ENTITY_TYPE = "personal_account_reference"
#: The partial unique index that allows one active link per (profile, Business Manager) pair.
ACTIVE_LINK_INDEX = "uq_pa_business_links_active"

PIN_PATTERN = re.compile(r"[0-9]{6}")  # used with fullmatch: `$` would also accept a trailing newline
PIN_MAX_FAILURES = 5
PIN_LOCK_MINUTES = 15
#: Who may see a profile's full email besides the person who holds the account.
REVEAL_ROLES = frozenset({WorkspaceRole.OWNER, WorkspaceRole.ADMIN})

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _violates_active_link_index(error: IntegrityError) -> bool:
    """True only for the active-link unique index; any other integrity error is not ours to translate."""
    diag = getattr(error.orig, "diag", None)
    return getattr(diag, "constraint_name", None) == ACTIVE_LINK_INDEX


class PinLockedError(DomainError):
    status_code = 423
    code = "pin_locked"


class PinRejectedError(DomainError):
    status_code = 403
    code = "pin_rejected"


class PinNotSetError(DomainError):
    status_code = 409
    code = "pin_not_set"


class VaultUnavailableError(DomainError):
    status_code = 409
    code = "vault_unavailable"


def _now() -> datetime:
    return datetime.now(UTC)


def _as_aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


# ---------------------------------------------------------------------------------- the reveal PIN
class RevealPinService:
    """A per-user 6-digit PIN, PBKDF2-hashed like the password. Five wrong tries lock it 15 minutes."""

    def __init__(self, session: Session, audit: AuditLogService) -> None:
        self.session = session
        self.audit = audit

    @staticmethod
    def status(user: User) -> dict[str, Any]:
        locked_until = _as_aware(user.reveal_pin_locked_until)
        locked = locked_until is not None and locked_until > _now()
        return {
            "is_set": user.reveal_pin_hash is not None,
            "locked_until": locked_until if locked else None,
        }

    def set_pin(self, user: User, *, current_password: str, new_pin: str) -> None:
        if not verify_password(current_password, user.password_hash):
            raise AuthorizationError("The current password is not correct.")
        if not PIN_PATTERN.fullmatch(new_pin):
            raise ValidationError("The PIN must be exactly 6 digits.")
        if len(set(new_pin)) == 1 or new_pin in ("123456", "654321", "012345"):
            raise ValidationError("This PIN is too easy to guess. Choose another one.")
        changed = user.reveal_pin_hash is not None
        user.reveal_pin_hash = hash_password(new_pin)
        user.reveal_pin_failed_count = 0
        user.reveal_pin_locked_until = None
        self.session.flush()
        self.audit.record(
            action="user.reveal_pin_changed" if changed else "user.reveal_pin_set",
            entity_type="user",
            entity_id=user.id,
        )

    def clear(self, user: User) -> None:
        """Owner reset: the member must set a new PIN before revealing anything again."""
        user.reveal_pin_hash = None
        user.reveal_pin_failed_count = 0
        user.reveal_pin_locked_until = None
        self.session.flush()
        self.audit.record(action="user.reveal_pin_cleared", entity_type="user", entity_id=user.id)

    def verify(self, user: User, pin: str) -> None:
        """Raises unless `pin` matches, serialising all guesses for one user.

        The row lock is deliberate: two requests reading the same failure count must not both write
        the same next value and let a parallel guesser exceed the five-attempt lockout.
        """
        user = self.session.execute(
            sa.select(User)
            .where(User.id == user.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one()
        if user.reveal_pin_hash is None:
            raise PinNotSetError("Set your PIN in Settings → Security first.")
        locked_until = _as_aware(user.reveal_pin_locked_until)
        if locked_until is not None and locked_until > _now():
            raise PinLockedError(
                "Too many wrong PINs. Try again later.",
                details={"locked_until": locked_until.isoformat()},
            )
        if PIN_PATTERN.fullmatch(pin or "") and verify_password(pin, user.reveal_pin_hash):
            user.reveal_pin_failed_count = 0
            user.reveal_pin_locked_until = None
            self.session.flush()
            return
        user.reveal_pin_failed_count = (user.reveal_pin_failed_count or 0) + 1
        remaining = PIN_MAX_FAILURES - user.reveal_pin_failed_count
        if remaining <= 0:
            user.reveal_pin_failed_count = 0
            user.reveal_pin_locked_until = _now() + timedelta(minutes=PIN_LOCK_MINUTES)
        self.session.flush()
        self.audit.record(
            action="user.reveal_pin_failed",
            entity_type="user",
            entity_id=user.id,
            metadata={"locked": remaining <= 0},
        )
        if remaining <= 0:
            # Committed by the caller before the error leaves the request, so the lock holds.
            raise PinLockedError(
                "Too many wrong PINs. Try again later.",
                details={"locked_until": user.reveal_pin_locked_until.isoformat()},
            )
        raise PinRejectedError("The PIN is not correct.", details={"attempts_remaining": remaining})


# ------------------------------------------------------------------------------- profile CRUD
class FacebookIdentityReferenceService(ReferenceService):
    """The generic reference lifecycle, plus: the holder must be a member of this workspace."""

    #: Supplied by the generated reference router for the one resource whose holder changes need
    #: stricter permission than a regular WriteCtx edit.
    membership: WorkspaceMember | None = None

    def _require_holder_admin(self) -> None:
        if self.membership is None or self.membership.role not in REVEAL_ROLES:
            raise AuthorizationError("Only a workspace owner or admin can designate the person holding this Facebook account.")

    def _check_owner(self, payload: dict[str, Any], *, changing: bool = False) -> None:
        # A buyer may create an ordinary unassigned reference, but may neither name a holder nor
        # clear/reassign an existing one: otherwise they can make themselves eligible to reveal it.
        if "owner_member_id" in payload and (changing or payload["owner_member_id"] is not None):
            self._require_holder_admin()
        member_id = payload.get("owner_member_id")
        if member_id is None:
            return
        member = self.session.execute(
            sa.select(WorkspaceMember).where(
                WorkspaceMember.id == member_id,
                WorkspaceMember.workspace_id == self.workspace_id,
                WorkspaceMember.archived_at.is_(None),
            )
        ).scalar_one_or_none()
        if member is None:
            raise ValidationError(
                "The person holding this account must be a member of this workspace.",
                details={"fields": ["owner_member_id"]},
            )

    def create(self, payload: dict[str, Any]) -> Any:
        self._check_owner(payload)
        return super().create(payload)

    def update(self, instance: Any, payload: dict[str, Any]) -> Any:
        self._check_owner(payload, changing=True)
        return super().update(instance, payload)


# ------------------------------------------------------------------------- profiles in context
class FacebookIdentityService:
    def __init__(self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService, settings: Any) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit
        self.settings = settings

    def get(self, identity_id: uuid.UUID) -> PersonalAccountReference:
        return get_or_404(
            self.session, PersonalAccountReference, identity_id, self.workspace_id, label="Facebook account"
        )

    # ------------------------------------------------------------------ email
    def set_email(self, identity: PersonalAccountReference, email: str | None) -> dict[str, Any]:
        require_active(identity, label="Facebook account")
        if email is None or not email.strip():
            had = identity.email_hint is not None
            identity.email_hint = None
            identity.email_ciphertext = None
            self.session.flush()
            if had:
                self.audit.record(action=f"{ENTITY_TYPE}.email_cleared", entity_type=ENTITY_TYPE, entity_id=identity.id)
            return {"email_hint": None, "email_stored": False}
        email = email.strip()
        if not _EMAIL.match(email) or len(email) > 320:
            raise ValidationError("This is not an email address.", details={"fields": ["email"]})
        hint = secret_vault.mask_email(email)
        stored = secret_vault.vault_configured(self.settings)
        identity.email_hint = hint
        # Without a vault key only the masked hint is kept — never the plaintext.
        identity.email_ciphertext = secret_vault.encrypt_contact(self.settings, email) if stored else None
        self.session.flush()
        self.audit.record(
            action=f"{ENTITY_TYPE}.email_set",
            entity_type=ENTITY_TYPE,
            entity_id=identity.id,
            after={"email_hint": hint},
            metadata={"full_email_stored": stored},
        )
        return {"email_hint": hint, "email_stored": stored}

    def can_reveal(self, identity: PersonalAccountReference, membership: WorkspaceMember) -> bool:
        return membership.role in REVEAL_ROLES or identity.owner_member_id == membership.id

    def reveal_email(
        self, identity: PersonalAccountReference, *, user: User, membership: WorkspaceMember, pin: str
    ) -> str:
        if not self.can_reveal(identity, membership):
            raise AuthorizationError("Only the owner, an admin or the person holding this account can see it.")
        # Checked before the PIN, so asking for an email that is not stored never costs an attempt.
        if not identity.email_ciphertext:
            raise NotFoundError("No full email is stored for this account.")
        RevealPinService(self.session, self.audit).verify(user, pin)
        try:
            email = secret_vault.decrypt_contact(self.settings, identity.email_ciphertext)
        except (secret_vault.VaultNotConfiguredError, secret_vault.SecretDecryptionError):
            raise VaultUnavailableError("The stored email cannot be opened with the server's key.") from None
        self.audit.record(action=f"{ENTITY_TYPE}.email_revealed", entity_type=ENTITY_TYPE, entity_id=identity.id)
        return email

    # ------------------------------------------------------------------ Business Manager links
    def link_business(
        self,
        identity: PersonalAccountReference,
        *,
        business_manager_id: uuid.UUID,
        role: IdentityBusinessRole,
        note: str,
        actor_id: uuid.UUID | None,
        visible_bm_ids: set[uuid.UUID] | None = None,
    ) -> PersonalAccountBusinessLink:
        require_active(identity, label="Facebook account")
        # Out of scope reads exactly like a missing Business Manager (A9 §6.2: never 403).
        if visible_bm_ids is not None and business_manager_id not in visible_bm_ids:
            raise NotFoundError("Business Manager not found.")
        bm = get_or_404(self.session, BusinessManager, business_manager_id, self.workspace_id, label="Business Manager")
        require_active(bm, label="Business Manager")
        existing = self.session.execute(
            sa.select(PersonalAccountBusinessLink).where(
                PersonalAccountBusinessLink.personal_account_reference_id == identity.id,
                PersonalAccountBusinessLink.business_manager_id == bm.id,
                PersonalAccountBusinessLink.unlinked_at.is_(None),
            )
        ).scalar_one_or_none()
        if existing is not None:
            raise ConflictError("This Facebook account is already linked to this Business Manager.")
        link = PersonalAccountBusinessLink(
            workspace_id=self.workspace_id,
            personal_account_reference_id=identity.id,
            business_manager_id=bm.id,
            role=role,
            note=note,
            linked_at=_now(),
            linked_by=actor_id,
        )
        # The pre-check above is only a fast path: two requests can both pass it. The partial unique
        # index decides the race, and the savepoint keeps the caller's transaction usable afterwards.
        try:
            with self.session.begin_nested():
                self.session.add(link)
                self.session.flush()
        except IntegrityError as error:
            if _violates_active_link_index(error):
                raise ConflictError("This Facebook account is already linked to this Business Manager.") from None
            raise
        self.audit.record(
            action=f"{ENTITY_TYPE}.business_linked",
            entity_type=ENTITY_TYPE,
            entity_id=identity.id,
            after={"business_manager_id": str(bm.id), "role": role.value, "link_id": str(link.id)},
        )
        return link

    def unlink_business(
        self,
        identity: PersonalAccountReference,
        link_id: uuid.UUID,
        *,
        actor_id: uuid.UUID | None,
        visible_bm_ids: set[uuid.UUID] | None = None,
    ) -> PersonalAccountBusinessLink:
        link = self.session.execute(
            sa.select(PersonalAccountBusinessLink).where(
                PersonalAccountBusinessLink.id == link_id,
                PersonalAccountBusinessLink.workspace_id == self.workspace_id,
                PersonalAccountBusinessLink.personal_account_reference_id == identity.id,
            )
        ).scalar_one_or_none()
        if link is None or (visible_bm_ids is not None and link.business_manager_id not in visible_bm_ids):
            raise NotFoundError("Link not found.")
        if link.unlinked_at is not None:
            raise ConflictError("This link is already removed.")
        link.unlinked_at = _now()
        link.unlinked_by = actor_id
        self.session.flush()
        self.audit.record(
            action=f"{ENTITY_TYPE}.business_unlinked",
            entity_type=ENTITY_TYPE,
            entity_id=identity.id,
            before={"business_manager_id": str(link.business_manager_id), "link_id": str(link.id)},
        )
        return link

    # ------------------------------------------------------------------ reads
    def business_links(
        self,
        identity_id: uuid.UUID,
        *,
        include_inactive: bool = False,
        visible_bm_ids: set[uuid.UUID] | None = None,
    ) -> list[dict[str, Any]]:
        stmt = (
            sa.select(PersonalAccountBusinessLink, BusinessManager)
            .join(BusinessManager, BusinessManager.id == PersonalAccountBusinessLink.business_manager_id)
            .where(
                PersonalAccountBusinessLink.workspace_id == self.workspace_id,
                PersonalAccountBusinessLink.personal_account_reference_id == identity_id,
            )
            .order_by(PersonalAccountBusinessLink.linked_at.desc())
        )
        if not include_inactive:
            stmt = stmt.where(PersonalAccountBusinessLink.unlinked_at.is_(None))
        if visible_bm_ids is not None:
            stmt = stmt.where(PersonalAccountBusinessLink.business_manager_id.in_(visible_bm_ids or {uuid.UUID(int=0)}))
        return [
            {
                "id": link.id,
                "business_manager_id": bm.id,
                "business_manager_name": bm.name,
                "business_manager_external_id": bm.external_id,
                "role": link.role,
                "note": link.note,
                "external_business_user_id": link.external_business_user_id,
                "linked_at": link.linked_at,
                "unlinked_at": link.unlinked_at,
            }
            for link, bm in self.session.execute(stmt).all()
        ]

    def ad_accounts(self, identity_id: uuid.UUID, *, visible_ids: set[uuid.UUID] | None) -> list[AdAccount]:
        managed = sa.select(PersonalAccountBusinessLink.business_manager_id).where(
            PersonalAccountBusinessLink.workspace_id == self.workspace_id,
            PersonalAccountBusinessLink.personal_account_reference_id == identity_id,
            PersonalAccountBusinessLink.unlinked_at.is_(None),
        )
        stmt = (
            sa.select(AdAccount)
            .where(
                AdAccount.workspace_id == self.workspace_id,
                AdAccount.archived_at.is_(None),
                sa.or_(
                    AdAccount.personal_account_reference_id == identity_id,
                    AdAccount.business_manager_id.in_(managed),
                ),
            )
            .order_by(AdAccount.display_name)
        )
        rows = list(self.session.execute(stmt).scalars())
        if visible_ids is not None:
            rows = [row for row in rows if row.id in visible_ids]
        return rows

    def reader_credentials(self, identity_id: uuid.UUID) -> list[dict[str, Any]]:
        rows = self.session.execute(
            sa.select(MetaReaderCredential).where(
                MetaReaderCredential.workspace_id == self.workspace_id,
                MetaReaderCredential.personal_account_reference_id == identity_id,
                MetaReaderCredential.archived_at.is_(None),
            )
        ).scalars()
        return [{"id": row.id, "label": row.label, "status": row.status} for row in rows]

    def summary(
        self, *, visible_ids: set[uuid.UUID] | None, visible_bm_ids: set[uuid.UUID] | None = None
    ) -> list[dict[str, Any]]:
        """Per active profile: how many Business Managers and ad accounts it reaches. Bounded queries."""
        identities = list(
            self.session.execute(
                sa.select(PersonalAccountReference).where(
                    PersonalAccountReference.workspace_id == self.workspace_id,
                    PersonalAccountReference.archived_at.is_(None),
                )
            ).scalars()
        )
        if not identities:
            return []
        ids = [identity.id for identity in identities]
        links = self.session.execute(
            sa.select(PersonalAccountBusinessLink.personal_account_reference_id, PersonalAccountBusinessLink.business_manager_id)
            .where(
                PersonalAccountBusinessLink.workspace_id == self.workspace_id,
                PersonalAccountBusinessLink.personal_account_reference_id.in_(ids),
                PersonalAccountBusinessLink.unlinked_at.is_(None),
            )
        ).all()
        bms_by_identity: dict[uuid.UUID, set[uuid.UUID]] = {}
        for identity_id, bm_id in links:
            if visible_bm_ids is not None and bm_id not in visible_bm_ids:
                continue
            bms_by_identity.setdefault(identity_id, set()).add(bm_id)
        all_bms = {bm for bms in bms_by_identity.values() for bm in bms}
        accounts = self.session.execute(
            sa.select(AdAccount.id, AdAccount.business_manager_id, AdAccount.personal_account_reference_id).where(
                AdAccount.workspace_id == self.workspace_id,
                AdAccount.archived_at.is_(None),
                sa.or_(
                    AdAccount.business_manager_id.in_(all_bms) if all_bms else sa.false(),
                    AdAccount.personal_account_reference_id.in_(ids),
                ),
            )
        ).all()
        members = self._member_names([i.owner_member_id for i in identities if i.owner_member_id])
        result = []
        for identity in identities:
            bms = bms_by_identity.get(identity.id, set())
            reached = {
                account_id
                for account_id, bm_id, direct_id in accounts
                if (bm_id in bms or direct_id == identity.id)
                and (visible_ids is None or account_id in visible_ids)
            }
            result.append(
                {
                    "id": identity.id,
                    "business_manager_count": len(bms),
                    "ad_account_count": len(reached),
                    "owner_member_name": members.get(identity.owner_member_id),
                }
            )
        return result

    def identities_for_accounts(self, accounts: Iterable[AdAccount]) -> dict[uuid.UUID, list[dict[str, Any]]]:
        """For each ad account, every Facebook account that reaches it — directly or through its
        Business Manager. An empty list is a real answer ("not recorded"), never a guess (rule 4)."""
        accounts = list(accounts)
        result: dict[uuid.UUID, list[dict[str, Any]]] = {account.id: [] for account in accounts}
        if not accounts:
            return result
        bm_ids = {a.business_manager_id for a in accounts if a.business_manager_id}
        direct_ids = {a.personal_account_reference_id for a in accounts if a.personal_account_reference_id}
        links: list[tuple[uuid.UUID, uuid.UUID, IdentityBusinessRole]] = []
        if bm_ids:
            links = [
                tuple(row)
                for row in self.session.execute(
                    sa.select(
                        PersonalAccountBusinessLink.business_manager_id,
                        PersonalAccountBusinessLink.personal_account_reference_id,
                        PersonalAccountBusinessLink.role,
                    ).where(
                        PersonalAccountBusinessLink.workspace_id == self.workspace_id,
                        PersonalAccountBusinessLink.business_manager_id.in_(bm_ids),
                        PersonalAccountBusinessLink.unlinked_at.is_(None),
                    )
                ).all()
            ]
        identity_ids = direct_ids | {identity_id for _, identity_id, _ in links}
        if not identity_ids:
            return result
        identities = {
            row.id: row
            for row in self.session.execute(
                sa.select(PersonalAccountReference).where(
                    PersonalAccountReference.workspace_id == self.workspace_id,
                    PersonalAccountReference.id.in_(identity_ids),
                    PersonalAccountReference.archived_at.is_(None),
                )
            ).scalars()
        }
        members = self._member_names([i.owner_member_id for i in identities.values() if i.owner_member_id])
        for account in accounts:
            seen: dict[uuid.UUID, dict[str, Any]] = {}
            if account.personal_account_reference_id in identities:
                seen[account.personal_account_reference_id] = self._compact(
                    identities[account.personal_account_reference_id], members, via="direct", role=None
                )
            for bm_id, identity_id, role in links:
                if bm_id == account.business_manager_id and identity_id in identities and identity_id not in seen:
                    seen[identity_id] = self._compact(identities[identity_id], members, via="business_manager", role=role)
            result[account.id] = sorted(seen.values(), key=lambda item: item["label"].lower())
        return result

    def identities_for_business_manager_reference(
        self, business_manager_reference: str | None
    ) -> list[dict[str, Any]]:
        """F3. For a Business Manager external reference, return active linked Facebook profiles
        (ordered with ADMIN first, then by label) so BM-level access-drift alerts and Telegram
        notifications name the exact Facebook profile to log in with."""
        ref = (business_manager_reference or "").strip()
        if not ref:
            return []
        bms = list(
            self.session.execute(
                sa.select(BusinessManager.id).where(
                    BusinessManager.workspace_id == self.workspace_id,
                    BusinessManager.external_id == ref,
                    BusinessManager.archived_at.is_(None),
                )
            ).scalars()
        )
        if not bms:
            return []
        links = list(
            self.session.execute(
                sa.select(
                    PersonalAccountBusinessLink.personal_account_reference_id,
                    PersonalAccountBusinessLink.role,
                ).where(
                    PersonalAccountBusinessLink.workspace_id == self.workspace_id,
                    PersonalAccountBusinessLink.business_manager_id.in_(bms),
                    PersonalAccountBusinessLink.unlinked_at.is_(None),
                )
            ).all()
        )
        if not links:
            return []
        identity_ids = {identity_id for identity_id, _ in links}
        identities = {
            row.id: row
            for row in self.session.execute(
                sa.select(PersonalAccountReference).where(
                    PersonalAccountReference.workspace_id == self.workspace_id,
                    PersonalAccountReference.id.in_(identity_ids),
                    PersonalAccountReference.archived_at.is_(None),
                )
            ).scalars()
        }
        members = self._member_names(
            [i.owner_member_id for i in identities.values() if i.owner_member_id]
        )
        seen: dict[uuid.UUID, dict[str, Any]] = {}
        for identity_id, role in links:
            if identity_id in identities and identity_id not in seen:
                seen[identity_id] = self._compact(
                    identities[identity_id], members, via="business_manager", role=role
                )
        return sorted(
            seen.values(),
            key=lambda item: (
                0 if item.get("role") == IdentityBusinessRole.ADMIN else 1,
                str(item["label"]).lower(),
            ),
        )

    # ------------------------------------------------------------------ helpers
    def _member_names(self, member_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
        if not member_ids:
            return {}
        rows = self.session.execute(
            sa.select(WorkspaceMember.id, User.full_name, User.email)
            .join(User, User.id == WorkspaceMember.user_id)
            .where(WorkspaceMember.workspace_id == self.workspace_id, WorkspaceMember.id.in_(member_ids))
        ).all()
        return {member_id: (name or email) for member_id, name, email in rows}

    @staticmethod
    def _compact(
        identity: PersonalAccountReference,
        members: dict[uuid.UUID, str],
        *,
        via: str,
        role: IdentityBusinessRole | None,
    ) -> dict[str, Any]:
        return {
            "id": identity.id,
            "label": identity.label,
            "status": identity.status,
            "two_factor_method": identity.two_factor_method,
            "vault_reference": identity.vault_reference,
            "email_hint": identity.email_hint,
            "owner_member_id": identity.owner_member_id,
            "owner_member_name": members.get(identity.owner_member_id),
            "via": via,
            "role": role,
        }
