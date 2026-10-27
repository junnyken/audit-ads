"""MINI-SPEC A7 domain model — BM + Ad Account Creation & Sharing via the official Meta API.

Five additive tables. No A1 table is altered — a successfully created account syncs into
`AdAccount` through the existing registry service, not through a duplicate write path here.

No token is ever a column in any table here. `MetaConnection` records *that* a connection is
configured and what it can do — never the credential itself. Since O4 a credential lives in
server configuration or, encrypted, in `meta_reader_credentials` (rule 40); a connection only
*points at* the latter through `reader_credential_id`.
"""
from __future__ import annotations

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

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
    #: A10.3. Which Business Manager this connection reads. Empty means "whatever the server is
    #: configured with" (`META_BUSINESS_ID`), which is what every connection created before this
    #: column did, so existing rows keep their meaning.
    #:
    #: Not a secret — a BM id is visible in Business Settings — so unlike the token it may appear
    #: in responses and logs. Set at creation and never updated: changing which Business Manager a
    #: connection reads would silently reinterpret every run it already recorded, and those runs
    #: are the evidence behind `missing_from_latest_discovery`.
    business_manager_reference: Mapped[str] = mapped_column(
        sa.String(120), nullable=False, default="", server_default=""
    )
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
    #: O3. The owner allowed the dispatcher to run discovery for this connection on a schedule.
    #: `false` in code and in the database: nothing drifts into automatic. Only
    #: `PATCH /meta-connections/{id}/automation` changes it, and a `fake`/`sandbox` connection
    #: can never turn it on — automatic discovery of fake data would be fabricated evidence.
    auto_discovery_enabled: Mapped[bool] = mapped_column(
        sa.Boolean(), nullable=False, default=False, server_default=sa.false()
    )
    #: O3. A scheduled run may also import the ad accounts it returned that the registry does
    #: not hold. Meaningless — and refused — without `auto_discovery_enabled`.
    auto_import_enabled: Mapped[bool] = mapped_column(
        sa.Boolean(), nullable=False, default=False, server_default=sa.false()
    )
    #: Who last left automation on, and when. NULL while both switches are off; the full history
    #: is in the `meta_connection.automation_changed` audit rows.
    automation_enabled_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)
    automation_enabled_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    #: O4. The vault credential this connection reads with, chosen once (on connect, or by the
    #: owner through `POST /meta-connections/{id}/reader-credential`) and never switched by the
    #: system. While it points at a credential that is not `active`, the connection reads
    #: nothing — it never falls back to a server token (rule 40). Kept after a revoke so the
    #: history of what was read, and with which credential, stays continuous.
    reader_credential_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(),
        # Named explicitly: the convention's name is 64 characters, one over PostgreSQL's limit.
        sa.ForeignKey(
            "meta_reader_credentials.id", ondelete="RESTRICT", name="fk_meta_conn_reader_credential"
        ),
        nullable=True,
        index=True,
    )
    reader_credential = relationship("MetaReaderCredential", lazy="joined")


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
