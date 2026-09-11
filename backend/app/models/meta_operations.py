"""MINI-SPEC A7 domain model — BM + Ad Account Creation & Sharing via the official Meta API.

Five additive tables. No A1 table is altered — a successfully created account syncs into
`AdAccount` through the existing registry service, not through a duplicate write path here.

No token is ever a column in any table here. `MetaConnection` records *that* a connection is
configured and what it can do — never the credential itself, which lives only in server
configuration (CLAUDE.md rule 18's boundary, extended to Meta).
"""
from __future__ import annotations

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.core.enums import MetaBatchItemStatus, MetaEnvironment, ReferenceStatus
from app.db.base import Archivable, Base, Timestamped, UUIDPrimaryKey
from app.models.entities import _enum


class MetaConnection(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """One configured target environment. `capabilities_json` and `business_managers_json` are
    a cache of the provider's own last answer — never invented, always timestamped so staleness
    is visible rather than assumed away (mirrors A2's evidence-first freshness convention)."""

    __tablename__ = "meta_connections"
    __table_args__ = (sa.Index("ix_meta_conn_ws_status", "workspace_id", "status"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    environment: Mapped[MetaEnvironment] = mapped_column(
        _enum(MetaEnvironment, "meta_environment"), nullable=False, default=MetaEnvironment.FAKE
    )
    status: Mapped[ReferenceStatus] = mapped_column(
        _enum(ReferenceStatus, "reference_status"), nullable=False, default=ReferenceStatus.UNKNOWN
    )
    #: Serialized `CapabilityCheck` from the provider's last check — booleans plus an optional
    #: safe reason code. Never a raw provider response body.
    capabilities_json: Mapped[dict | None] = mapped_column(sa.JSON(), nullable=True)
    last_capability_check_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    #: `[{"external_id": ..., "name": ...}]` — the provider's own last answer, cached.
    business_managers_json: Mapped[list | None] = mapped_column(sa.JSON(), nullable=True)
    notes: Mapped[str] = mapped_column(sa.Text(), nullable=False, default="")
    created_by: Mapped[uuid.UUID] = mapped_column(sa.Uuid(), nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)


class AccountCreationBatch(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """One confirmed (or not-yet-confirmed) batch of `create_ad_account` calls against one BM.

    `preview_hash` is the guardrail against a UI/request mismatch: it is computed over the
    batch's item content at preview time, stored on confirm, and re-checked before the queue is
    allowed to run — mini-spec A7's "batch thay đổi ... sau confirm → confirmation bị invalid".
    """

    __tablename__ = "meta_account_creation_batches"
    __table_args__ = (sa.Index("ix_macb_ws_confirmed", "workspace_id", "confirmed_at"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    meta_connection_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("meta_connections.id", ondelete="RESTRICT"), nullable=False
    )
    business_manager_external_id: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    preview_hash: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(sa.Uuid(), nullable=False)


class AccountCreationBatchItem(UUIDPrimaryKey, Timestamped, Archivable, Base):
    __tablename__ = "meta_account_creation_batch_items"
    __table_args__ = (
        sa.UniqueConstraint("workspace_id", "idempotency_key"),
        sa.Index("ix_macbi_batch_status", "batch_id", "status"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    batch_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(),
        sa.ForeignKey("meta_account_creation_batches.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    currency: Mapped[str] = mapped_column(sa.String(3), nullable=False)
    country: Mapped[str | None] = mapped_column(sa.String(2), nullable=True)
    #: A10.2. `timezone` is a free-text operator note; `timezone_id` is the integer identifier
    #: Meta's create endpoint actually takes. They are kept apart because one is for people to
    #: read and the other is sent to a real API — conflating them is how a permanent artifact
    #: ends up stamped with a guessed value.
    timezone: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    timezone_id: Mapped[int | None] = mapped_column(sa.Integer(), nullable=True)
    idempotency_key: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    status: Mapped[MetaBatchItemStatus] = mapped_column(
        _enum(MetaBatchItemStatus, "meta_batch_item_status"),
        nullable=False,
        default=MetaBatchItemStatus.QUEUED,
    )
    external_account_id: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    #: Set once the successful result has been synced into the A1 registry — never re-synced.
    synced_ad_account_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(), sa.ForeignKey("ad_accounts.id", ondelete="SET NULL"), nullable=True
    )
    failure_code: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    failure_summary: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)
    retry_count: Mapped[int] = mapped_column(sa.Integer(), nullable=False, default=0)
    last_attempted_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)


class AccessShareBatch(UUIDPrimaryKey, Timestamped, Archivable, Base):
    __tablename__ = "meta_access_share_batches"
    __table_args__ = (sa.Index("ix_masb_ws_confirmed", "workspace_id", "confirmed_at"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    meta_connection_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("meta_connections.id", ondelete="RESTRICT"), nullable=False
    )
    preview_hash: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(sa.Uuid(), nullable=False)


class AccessShareBatchItem(UUIDPrimaryKey, Timestamped, Archivable, Base):
    __tablename__ = "meta_access_share_batch_items"
    __table_args__ = (
        sa.UniqueConstraint("workspace_id", "idempotency_key"),
        sa.Index("ix_masbi_batch_status", "batch_id", "status"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    batch_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(),
        sa.ForeignKey("meta_access_share_batches.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    #: The linked local account when the source is already in our registry — nullable because a
    #: source can be an external_account_id the operator typed that is not registered locally.
    source_ad_account_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(), sa.ForeignKey("ad_accounts.id", ondelete="SET NULL"), nullable=True
    )
    source_external_account_id: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    recipient_reference: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    role: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    status: Mapped[MetaBatchItemStatus] = mapped_column(
        _enum(MetaBatchItemStatus, "meta_batch_item_status"),
        nullable=False,
        default=MetaBatchItemStatus.QUEUED,
    )
    access_grant_reference: Mapped[str | None] = mapped_column(sa.String(200), nullable=True)
    failure_code: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    failure_summary: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)
    retry_count: Mapped[int] = mapped_column(sa.Integer(), nullable=False, default=0)
    last_attempted_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)


class PixelShareBatch(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """A8: reuses A7's exact batch shape — one `share_pixel_access` call per item, gated on its
    own capability, with the same preview_hash/confirm/idempotency/retry engine."""

    __tablename__ = "meta_pixel_share_batches"
    __table_args__ = (sa.Index("ix_mpsb_ws_confirmed", "workspace_id", "confirmed_at"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    meta_connection_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("meta_connections.id", ondelete="RESTRICT"), nullable=False
    )
    preview_hash: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(sa.Uuid(), nullable=False)


class PixelShareBatchItem(UUIDPrimaryKey, Timestamped, Archivable, Base):
    __tablename__ = "meta_pixel_share_batch_items"
    __table_args__ = (
        sa.UniqueConstraint("workspace_id", "idempotency_key"),
        sa.Index("ix_mpsbi_batch_status", "batch_id", "status"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    batch_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(),
        sa.ForeignKey("meta_pixel_share_batches.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    #: The linked local Pixel when it is already in our registry — nullable for the same reason
    #: `AccessShareBatchItem.source_ad_account_id` is: an operator-typed id may not be local yet.
    source_pixel_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(), sa.ForeignKey("pixels.id", ondelete="SET NULL"), nullable=True
    )
    source_external_pixel_id: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    #: The linked local account when the target is already registered — nullable for the same
    #: reason as above.
    target_ad_account_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(), sa.ForeignKey("ad_accounts.id", ondelete="SET NULL"), nullable=True
    )
    target_ad_account_external_id: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    status: Mapped[MetaBatchItemStatus] = mapped_column(
        _enum(MetaBatchItemStatus, "meta_batch_item_status"),
        nullable=False,
        default=MetaBatchItemStatus.QUEUED,
    )
    access_grant_reference: Mapped[str | None] = mapped_column(sa.String(200), nullable=True)
    failure_code: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    failure_summary: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)
    retry_count: Mapped[int] = mapped_column(sa.Integer(), nullable=False, default=0)
    last_attempted_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
