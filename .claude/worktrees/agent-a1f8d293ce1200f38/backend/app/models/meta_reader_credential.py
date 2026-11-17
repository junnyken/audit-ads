"""MINI-SPEC O4 — a Meta reader credential the product obtained through Facebook Login for
Business, kept encrypted.

`encrypted_secret` is **the only column in this schema that carries a credential** (rule 1's
single exception, rule 40). It holds Fernet ciphertext written by `core/secret_vault.py`; the
key lives in server configuration (`CREDENTIAL_VAULT_KEY`), so a copy of the database alone does
not yield a token. It is never serialised, never audited, never logged, and is cleared when the
credential is revoked.

Everything else here is metadata Meta reported through `debug_token` — kind, scopes, expiry,
who granted it — and is the most that may be disclosed about a credential.
"""
from __future__ import annotations

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.core.enums import ReaderCredentialKind, ReaderCredentialStatus
from app.db.base import Archivable, Base, Timestamped, UUIDPrimaryKey
from app.models.entities import _enum


class MetaReaderCredential(UUIDPrimaryKey, Timestamped, Archivable, Base):
    __tablename__ = "meta_reader_credentials"
    __table_args__ = (sa.Index("ix_meta_reader_cred_ws_status", "workspace_id", "status"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    #: The owner's own name for it, set when connecting.
    label: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    #: From `debug_token.type`, never from a person.
    kind: Mapped[ReaderCredentialKind] = mapped_column(
        _enum(ReaderCredentialKind, "reader_credential_kind"), nullable=False
    )
    status: Mapped[ReaderCredentialStatus] = mapped_column(
        _enum(ReaderCredentialStatus, "reader_credential_status"),
        nullable=False,
        default=ReaderCredentialStatus.PENDING_VERIFICATION,
    )
    #: Fernet ciphertext. NULL once revoked — a revoked credential keeps its history, not its key.
    encrypted_secret: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)
    secret_last_rotated_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    #: `debug_token.user_id` — the identity that granted it (for a system-user configuration, the
    #: business-integration system user). A reconnect by a different identity is refused.
    provider_user_external_id: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    #: `me.name` at verification. Shown so an owner can tell four credentials apart.
    provider_user_name: Mapped[str | None] = mapped_column(sa.String(200), nullable=True)
    #: Allowlisted scope names only (`scopes ∪ granular_scopes[].scope`).
    scopes_json: Mapped[list | None] = mapped_column(sa.JSON(), nullable=True)
    issued_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    #: NULL means Meta reported `0`: the token does not expire.
    expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    data_access_expires_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    last_verified_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    #: `valid` or a `MetaFailureCode` value. A code, never Meta's message.
    last_verify_outcome: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    #: Why it is not usable: `expired`, `invalid_token`, `password_changed`, `checkpointed`,
    #: `app_not_installed`, `scope_missing`, `scope_too_broad`, `app_mismatch`,
    #: `business_not_readable`, `businesses_unreadable`, `vault_unavailable`, `revoked_by_owner`.
    reconnect_reason: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    #: `[{external_id, name, permitted_roles}]` — what the credential could see at its last
    #: check: `me/businesses` for a user token, the verified Business Manager for a system user.
    businesses_seen_json: Mapped[list | None] = mapped_column(sa.JSON(), nullable=True)
    connected_by: Mapped[uuid.UUID] = mapped_column(sa.Uuid(), nullable=False)
    connected_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    revoke_reason: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)
