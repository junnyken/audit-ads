"""P1 transaction boundary and explicit DTO projections.

Lock order for every P1 operation: workspace -> users (UUID order) -> seats
(UUID order) -> device session -> entry -> PIN's already-held actor user lock.
Workspace serialization prevents P1 reassign/archive/reveal inversions. User/seat
row locks serialize ordinary SQL revocation updates; PG concurrency needs staging
verification (SQLite cannot establish locking/deadlock correctness).
"""

from __future__ import annotations

import contextlib
import re
import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from app.core.enums import WorkspaceMemberStatus, WorkspaceRole
from app.core.errors import (
    AuthenticationError,
    AuthorizationError,
    ConflictError,
    DomainError,
    NotFoundError,
    ValidationError,
)
from app.core.secret_vault import (
    SecretDecryptionError,
    VaultNotConfiguredError,
    contact_index,
    decrypt_contact,
    encrypt_contact,
    mask_email,
)
from app.models.email_registry import EmailRegistryEntry as Entry
from app.models.entities import AuditLog, User, Workspace, WorkspaceMember
from app.models.team import DeviceSession
from app.schemas.common import page_response
from app.schemas.email_registry import Metadata
from app.services.facebook_identities import PinLockedError, PinRejectedError, RevealPinService
from app.services.license_service import require_workspace_writable
from app.services.session_registry import SessionRegistryService

ADMIN = {WorkspaceRole.OWNER, WorkspaceRole.ADMIN}
ALLOWED = ADMIN | {WorkspaceRole.BUYER}
ENTITY = "email_registry_entry"
SAFE = (
    "provider",
    "account_kind",
    "state",
    "responsible_member_id",
    "review_due_at",
    "review_timezone",
    "version",
    "archived_at",
    "archived_by",
    "evidence_source",
    "evidence_observed_at",
    "evidence_recorded_at",
    "evidence_recorded_by",
)
LIST = (
    "id",
    "address_hint",
    "provider",
    "account_kind",
    "responsible_member_id",
    "state",
    "review_due_at",
    "updated_at",
    "version",
    "archived_at",
)
DETAIL = (
    "evidence_source",
    "evidence_observed_at",
    "evidence_recorded_at",
    "evidence_recorded_by",
    "review_timezone",
    "next_action",
    "reason",
    "created_at",
    "created_by",
    "updated_by",
    "archived_by",
)


def aware(v):
    return v.replace(tzinfo=UTC) if isinstance(v, datetime) and v.tzinfo is None else v


def wire(v):
    if isinstance(v, datetime):
        return aware(v).astimezone(UTC).isoformat().replace("+00:00", "Z")
    return str(v) if isinstance(v, uuid.UUID) else v


class ProtectionUnavailable(DomainError):
    status_code = 503
    code = "contact_protection_unavailable"


class AuditUnavailable(DomainError):
    status_code = 503
    code = "audit_persistence_unavailable"


class PreconditionRequired(DomainError):
    status_code = 428
    code = "precondition_required"


class EmailRegistryService:
    def __init__(self, ctx, settings):
        self.ctx, self.settings, self.session = ctx, settings, ctx.session

    def lock(self, *, write=False, admin=False, target=None, entry_id=None):
        s, c = self.session, self.ctx

        def locked(model, where):
            return (
                s.execute(
                    sa.select(model)
                    .where(where)
                    .with_for_update(of=model)
                    .execution_options(populate_existing=True)
                )
                .scalars()
                .all()
            )

        ws = locked(Workspace, Workspace.id == c.workspace_id)
        if not ws or ws[0].archived_at or ws[0].community_status == "suspended":
            raise AuthorizationError("Workspace unavailable.")
        if entry_id is not None:
            target = s.scalar(
                sa.select(Entry.responsible_member_id).where(
                    Entry.id == entry_id, Entry.workspace_id == c.workspace_id
                )
            )
        # Read target user id before taking locks; re-read seat under lock below.
        target_user = (
            s.scalar(
                sa.select(WorkspaceMember.user_id).where(
                    WorkspaceMember.id == target, WorkspaceMember.workspace_id == c.workspace_id
                )
            )
            if target
            else None
        )
        ids = sorted({c.actor_id} | ({target_user} if target_user else set()), key=str)
        users = {u.id: u for uid in ids for u in locked(User, User.id == uid)}
        if c.actor_id not in users or not users[c.actor_id].is_active:
            raise AuthenticationError("Account inactive.")
        seats = {
            m.id: m
            for mid in sorted({c.membership.id} | ({target} if target else set()), key=str)
            for m in locked(WorkspaceMember, WorkspaceMember.id == mid)
        }
        actor = seats.get(c.membership.id)
        if not self.valid_seat(actor, users.get(c.actor_id), c.workspace_id) or actor.user_id != c.actor_id:
            raise AuthorizationError("Membership unavailable.")
        if actor.role not in ALLOWED or (admin and actor.role not in ADMIN):
            raise AuthorizationError("Registry action is not permitted.")
        c.user, c.membership, c.workspace = users[c.actor_id], actor, ws[0]
        if c.device_session_id:
            devices = locked(DeviceSession, DeviceSession.id == c.device_session_id)
            if (
                not devices
                or devices[0].user_id != c.actor_id
                or devices[0].workspace_id != c.workspace_id
                or not devices[0].is_active
            ):
                raise AuthenticationError("Session ended.")
            SessionRegistryService(s, c.workspace_id, c.audit).touch(devices[0])
        if write:
            require_workspace_writable(c.workspace)
        self.target_valid = True
        if target:
            seat = seats.get(target)
            if (
                not self.valid_seat(seat, users.get(target_user), c.workspace_id)
                or seat.user_id != target_user
                or seat.role not in ALLOWED
            ):
                self.target_valid = False

    def require_target(self):
        if not self.target_valid:
            raise ValidationError("Responsible member is not eligible.")

    @staticmethod
    def valid_seat(seat, user, ws):
        return (
            seat is not None
            and user is not None
            and user.is_active
            and seat.workspace_id == ws
            and seat.archived_at is None
            and seat.status == WorkspaceMemberStatus.ACTIVE
        )

    def entry(self, entry_id, *, active=False):
        query = sa.select(Entry).where(Entry.id == entry_id, Entry.workspace_id == self.ctx.workspace_id)
        if self.ctx.membership.role not in ADMIN:
            query = query.where(Entry.responsible_member_id == self.ctx.membership.id)
        row = self.session.scalar(query.with_for_update().execution_options(populate_existing=True))
        if row is None:
            raise NotFoundError("Entry not found.")
        if active and row.archived_at:
            raise ConflictError("Entry is archived.")
        return row

    def dto(self, row, *, detail=True, now=None):
        out = {k: wire(getattr(row, k)) for k in LIST + (DETAIL if detail else ())}
        out["overdue"] = (
            row.review_due_at is not None
            and aware(row.review_due_at) < (now if now is not None else datetime.now(UTC))
            and row.archived_at is None
        )
        if detail:
            out["can_reveal_address"] = row.archived_at is None
        return out

    @staticmethod
    def history_snapshot(data):
        enums = {
            "provider": {"gmail", "microsoft"},
            "account_kind": {"personal", "managed", "unknown"},
            "state": {"unknown", "pending", "recorded", "blocked"},
            "evidence_source": {"manual_attestation"},
        }
        out = {}
        for k, v in data.items():
            if k not in SAFE:
                continue
            if v is None:
                out[k] = None
            elif k in enums:
                if isinstance(v, str) and v in enums[k]:
                    out[k] = v
            elif k == "version":
                if type(v) is int and v > 0:
                    out[k] = v
            elif k in {"responsible_member_id", "archived_by", "evidence_recorded_by"}:
                with contextlib.suppress(ValueError):
                    out[k] = str(uuid.UUID(v)) if isinstance(v, str) else None
            elif k == "review_timezone":
                from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

                try:
                    if isinstance(v, str) and len(v) <= 64:
                        ZoneInfo(v)
                        out[k] = v
                except (ValueError, ZoneInfoNotFoundError):
                    pass
            elif isinstance(v, str) and re.fullmatch(
                r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)", v
            ):
                out[k] = v
        return out

    def snapshot(self, row):
        return {k: wire(getattr(row, k)) for k in SAFE}

    def audit(self, action, row=None, before=None, changed=None, metadata=None):
        meta = dict(metadata or {})
        if row:
            meta["version"] = row.version
        if changed:
            meta["changed_fields"] = sorted(changed)
            for k in ("reason", "next_action"):
                if k in changed:
                    meta[k + "_present"] = getattr(row, k) is not None
        try:
            self.ctx.audit.record(
                action="email_registry." + action,
                entity_type=ENTITY,
                entity_id=row.id if row else "collection",
                before=before,
                after=self.snapshot(row)
                if row and action in {"created", "updated", "reassigned", "archived"}
                else None,
                metadata=meta or None,
            )
        except Exception:
            self.session.rollback()
            raise AuditUnavailable("Audit could not be persisted.") from None

    def commit(self):
        try:
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise AuditUnavailable("Audit could not be persisted.") from None

    def create(self, payload):
        self.lock(write=True, admin=True, target=payload.responsible_member_id)
        self.require_target()
        try:
            index, version = contact_index(self.settings, self.ctx.workspace_id, payload.contact_address)
            # Refuse mixed index versions until an externally coordinated reindex completes.
            if self.session.scalar(
                sa.select(Entry.id)
                .where(Entry.workspace_id == self.ctx.workspace_id, Entry.index_key_version != version)
                .limit(1)
            ):
                raise VaultNotConfiguredError()
            ciphertext = encrypt_contact(self.settings, payload.contact_address)
        except (VaultNotConfiguredError, ValueError):
            raise ProtectionUnavailable("Contact protection is unavailable.") from None
        row = Entry(
            workspace_id=self.ctx.workspace_id,
            provider=payload.provider,
            account_kind=payload.account_kind,
            address_ciphertext=ciphertext,
            address_hint=mask_email(payload.contact_address),
            address_index=index,
            index_key_version=version,
            responsible_member_id=payload.responsible_member_id,
            review_due_at=payload.review_due_at.astimezone(UTC) if payload.review_due_at else None,
            review_timezone=payload.review_timezone,
            next_action=payload.next_action,
            created_by=self.ctx.actor_id,
            updated_by=self.ctx.actor_id,
        )
        self.session.add(row)
        try:
            self.session.flush()
        except IntegrityError:
            self.session.rollback()
            raise ConflictError("Entry could not be created.") from None
        self.audit("created", row)
        result = self.dto(row)
        self.commit()
        return result

    def check_version(self, row, version):
        if version is None:
            raise PreconditionRequired("If-Match is required.")
        if row.version != version:
            raise ConflictError("Entry changed; reload.")

    def mutate(self, entry_id, payload, version, *, action="updated"):
        target = payload.responsible_member_id if action == "reassigned" else None
        self.lock(
            write=True,
            admin=action != "updated",
            target=target,
            entry_id=entry_id if action == "updated" else None,
        )
        row = self.entry(entry_id, active=True)
        self.check_version(row, version)
        if action == "reassigned":
            self.require_target()
        before = self.snapshot(row)
        data = payload.model_dump(exclude_unset=True)
        if action == "updated":
            data = self.validate_patch(row, data)
        elif action == "archived":
            data = {"archived_at": datetime.now(UTC), "archived_by": self.ctx.actor_id}
        # No-op mutations do not manufacture a revision/event.
        if all(aware(getattr(row, k)) == aware(v) for k, v in data.items()):
            raise ValidationError("No changes supplied.")
        old = row.version
        data.update(version=old + 1, updated_at=datetime.now(UTC), updated_by=self.ctx.actor_id)
        result = self.session.execute(
            sa.update(Entry)
            .where(
                Entry.id == row.id,
                Entry.workspace_id == self.ctx.workspace_id,
                Entry.version == old,
                Entry.archived_at.is_(None),
            )
            .values(**data)
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            raise ConflictError("Entry changed; reload.")
        self.session.refresh(row)
        self.audit(action, row, before, set(data) - {"updated_at", "updated_by", "version"})
        dto = self.dto(row)
        self.commit()
        return dto

    def validate_patch(self, row, data):
        state = data.get("state", row.state)
        kind = data.get("account_kind", row.account_kind)
        reason = data.get("reason", row.reason)
        next_action = data.get("next_action", row.next_action)
        observation = data.get("evidence_observed_at")
        if row.provider == "gmail" and kind != "personal":
            raise ValidationError("Gmail kind must be personal.")
        kind_change = kind != row.account_kind
        if kind_change and kind != "managed" and not data.get("reason"):
            raise ValidationError("A reason is required for kind changes.")
        if state == "unknown":
            if observation or (kind_change and kind == "managed"):
                raise ValidationError("Unknown state cannot carry attestation.")
            if "state" in data:
                if not data.get("reason"):
                    raise ValidationError("A reason is required.")
                data.update(
                    evidence_source=None,
                    evidence_observed_at=None,
                    evidence_recorded_at=None,
                    evidence_recorded_by=None,
                )
        elif "state" in data or observation or (kind_change and kind == "managed"):
            if observation is None or observation > datetime.now(UTC):
                raise ValidationError("A nonfuture observation is required.")
            # Workspace lock excludes concurrent P1 reassignment; seat and user locks also
            # exclude direct seat/user revocations while this attestation is accepted.
            self.require_target()
            if row.responsible_member_id is None:
                raise ValidationError("An active responsible member is required.")
            data.update(
                evidence_source="manual_attestation",
                evidence_recorded_at=datetime.now(UTC),
                evidence_recorded_by=self.ctx.actor_id,
            )
        if state == "blocked" and (not reason or not next_action):
            raise ValidationError("Blocked state requires reason and next action.")
        due = data.get("review_due_at", row.review_due_at)
        zone = data.get("review_timezone", row.review_timezone)
        if (due is None) != (zone is None):
            raise ValidationError("Review date and timezone must be supplied together.")
        try:
            # A changed zone must be validated against the submitted instant's offset;
            # stored UTC due is converted to that zone when only text metadata changes.
            from zoneinfo import ZoneInfo

            check_due = (
                due if "review_due_at" in data else aware(due).astimezone(ZoneInfo(zone)) if due else None
            )
            Metadata(review_due_at=check_due.isoformat() if check_due else None, review_timezone=zone)
        except ValueError:
            raise ValidationError("Invalid review time or timezone.") from None
        if data.get("review_due_at") is not None:
            data["review_due_at"] = data["review_due_at"].astimezone(UTC)
        return data

    def eligible_members(self):
        """Minimal registry-only projection; never opens generic team administration."""
        self.lock(admin=True)
        rows = self.session.execute(
            sa.select(WorkspaceMember.id, User.full_name)
            .join(User, User.id == WorkspaceMember.user_id)
            .where(
                WorkspaceMember.workspace_id == self.ctx.workspace_id,
                WorkspaceMember.archived_at.is_(None),
                WorkspaceMember.status == WorkspaceMemberStatus.ACTIVE,
                WorkspaceMember.role.in_(ALLOWED),
                User.is_active.is_(True),
            )
            .order_by(WorkspaceMember.id)
            .limit(1001)
        ).all()
        if len(rows) > 1000:
            raise ValidationError("Too many eligible members; use a scoped picker in a later release.")
        result = [{"id": str(r.id), "full_name": r.full_name} for r in rows]
        self.audit("eligible_members_read", metadata={"returned_count": len(result)})
        self.commit()
        return result

    def detail(self, entry_id):
        self.lock()
        row = self.entry(entry_id)
        result = self.dto(row)
        self.audit("detail_read", row)
        self.commit()
        return result

    def reminder_policy(self, payload=None):
        from app.services.alert_service import AlertPolicyService

        self.lock(admin=True, write=payload is not None)
        policies = AlertPolicyService(self.session, self.ctx.workspace_id, self.ctx.audit)
        field = "email_registry_in_app_reminders_enabled"
        try:
            policy = policies.get()
            if policy is not None and policy.archived_at is not None:
                raise AuthorizationError("Policy unavailable.")
            before = bool(getattr(policy, field, False))
            if payload is not None:
                policy = policies.get_or_create()
                setattr(policy, field, getattr(payload, field))
                policy.updated_by = self.ctx.actor_id
                self.session.flush()
            enabled = bool(getattr(policy, field, False))
            self.audit(
                "reminder_policy_updated" if payload is not None else "reminder_policy_read",
                metadata={"before_enabled": before, "enabled": enabled},
            )
            self.commit()
        except Exception:
            self.session.rollback()
            raise
        return {field: enabled}

    def listing(self, filters):
        self.lock()
        now = datetime.now(UTC)
        q = sa.select(Entry).where(Entry.workspace_id == self.ctx.workspace_id)
        if self.ctx.membership.role not in ADMIN:
            q = q.where(Entry.responsible_member_id == self.ctx.membership.id)
        archived = filters.get("archived", "exclude")
        if archived != "all":
            q = q.where(
                Entry.archived_at.is_(None) if archived == "exclude" else Entry.archived_at.is_not(None)
            )
        for k in ("provider", "account_kind", "state", "responsible_member_id"):
            if filters.get(k) is not None:
                q = q.where(getattr(Entry, k) == filters[k])
        if filters.get("overdue") is not None:
            pred = sa.and_(Entry.review_due_at < now, Entry.archived_at.is_(None))
            q = q.where(pred if filters["overdue"] else sa.or_(Entry.review_due_at.is_(None), sa.not_(pred)))
        if filters.get("attention"):
            from app.services.alert_service import AlertPolicyService

            policy = AlertPolicyService(self.session, self.ctx.workspace_id, self.ctx.audit).get()
            enabled = (
                policy is not None
                and policy.archived_at is None
                and policy.email_registry_in_app_reminders_enabled
            )
            q = q.where(Entry.archived_at.is_(None), Entry.review_due_at < now)
            if not enabled:
                q = q.where(sa.false())
        total = self.session.scalar(sa.select(sa.func.count()).select_from(q.subquery()))
        page, size = filters.get("page", 1), filters.get("page_size", 25)
        rows = self.session.scalars(
            q.order_by(
                *(
                    (Entry.review_due_at.asc(), Entry.id.asc())
                    if filters.get("attention")
                    else (Entry.created_at.desc(), Entry.id.desc())
                )
            )
            .offset((page - 1) * size)
            .limit(size)
        ).all()
        result = page_response(
            [self.dto(r, detail=False, now=now) for r in rows], page=page, page_size=size, total=total
        )
        self.audit(
            "list_read",
            metadata={
                "returned_count": len(rows),
                "filters": {
                    k: wire(v)
                    for k, v in filters.items()
                    if k
                    in {
                        "provider",
                        "account_kind",
                        "state",
                        "responsible_member_id",
                        "archived",
                        "overdue",
                        "attention",
                    }
                    and v is not None
                },
            },
        )
        self.commit()
        return result

    def history(self, entry_id, page=1, page_size=25):
        self.lock()
        row = self.entry(entry_id)
        q = sa.select(AuditLog).where(
            AuditLog.workspace_id == self.ctx.workspace_id,
            AuditLog.entity_type == ENTITY,
            AuditLog.entity_id == str(row.id),
            AuditLog.action.in_(
                [
                    "email_registry." + a
                    for a in (
                        "created",
                        "updated",
                        "reassigned",
                        "archived",
                        "address_revealed",
                        "detail_read",
                        "history_read",
                    )
                ]
            ),
        )
        total = self.session.scalar(sa.select(sa.func.count()).select_from(q.subquery()))
        events = self.session.scalars(
            q.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
        items = []
        for e in events:
            items.append(
                {
                    "id": str(e.id),
                    "action": e.action,
                    "entity_id": e.entity_id,
                    "actor_id": wire(e.actor_id),
                    "created_at": wire(e.created_at),
                    "request_id": e.request_id,
                    "before": self.history_snapshot(e.before_json or {}),
                    "after": self.history_snapshot(e.after_json or {}),
                    "metadata": self.history_metadata(e.metadata_json or {}),
                }
            )
        result = page_response(items, page=page, page_size=page_size, total=total)
        self.audit("history_read", row, metadata={"returned_count": len(items)})
        self.commit()
        return result

    @staticmethod
    def history_metadata(meta):
        result = {k: v for k, v in meta.items() if k in {"version", "returned_count"} and type(v) is int}
        for k in ("reason_present", "next_action_present"):
            if type(meta.get(k)) is bool:
                result[k] = meta[k]
        if isinstance(meta.get("changed_fields"), list):
            result["changed_fields"] = [
                k for k in meta["changed_fields"] if k in SAFE or k in {"reason", "next_action"}
            ]
        return result

    def reveal(self, entry_id, pin):
        self.lock()
        row = self.entry(entry_id, active=True)
        try:
            RevealPinService(self.session, self.ctx.audit).verify(self.ctx.user, pin)
        except (PinRejectedError, PinLockedError):
            self.commit()
            raise
        try:
            address = decrypt_contact(self.settings, row.address_ciphertext)
        except (VaultNotConfiguredError, SecretDecryptionError):
            self.session.rollback()
            raise ProtectionUnavailable("Contact protection is unavailable.") from None
        self.audit("address_revealed", row)
        self.commit()
        return {"address": address}
