"""A1 domain model (MINI-SPEC A1 §A).

Every workspace-scoped table carries `workspace_id` so authorization is enforceable with a
database predicate rather than trust in the caller. Every domain table is archivable; no A1
entity is ever hard-deleted. `audit_logs` is the single exception: it is append-only and has
no `archived_at`, because an immutable record that can be archived is not immutable.
"""
from __future__ import annotations

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import (
    AccountStatus,
    AccountType,
    AssetType,
    ChecklistCategory,
    ChecklistReviewStatus,
    EventSeverity,
    EventStatus,
    EvidenceStatus,
    ReadinessStatus,
    ReferenceStatus,
    WorkspaceRole,
)
from app.db.base import Archivable, Base, Timestamped, UUIDPrimaryKey


def _enum(python_enum: type, name: str) -> sa.Enum:
    """VARCHAR + CHECK constraint. Portable across PostgreSQL and SQLite, and a value can be
    added later with a constraint change instead of an ALTER TYPE."""
    return sa.Enum(python_enum, name=name, native_enum=False, length=48, validate_strings=True)


def _ws_fk() -> Mapped[uuid.UUID]:
    return mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )


class User(UUIDPrimaryKey, Timestamped, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(sa.String(320), nullable=False, unique=True)
    full_name: Mapped[str] = mapped_column(sa.String(200), nullable=False, default="")
    password_hash: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(sa.Boolean(), nullable=False, default=True)


class Workspace(UUIDPrimaryKey, Timestamped, Archivable, Base):
    __tablename__ = "workspaces"

    name: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    slug: Mapped[str] = mapped_column(sa.String(120), nullable=False, unique=True)


class WorkspaceMember(UUIDPrimaryKey, Timestamped, Archivable, Base):
    __tablename__ = "workspace_members"
    __table_args__ = (sa.UniqueConstraint("workspace_id", "user_id"),)

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    role: Mapped[WorkspaceRole] = mapped_column(
        _enum(WorkspaceRole, "workspace_role"), nullable=False, default=WorkspaceRole.OWNER
    )

    user: Mapped[User] = relationship(lazy="joined")


class BusinessManager(UUIDPrimaryKey, Timestamped, Archivable, Base):
    __tablename__ = "business_managers"
    __table_args__ = (
        sa.UniqueConstraint("workspace_id", "external_id"),
        sa.Index("ix_business_managers_workspace_id_archived_at", "workspace_id", "archived_at"),
    )

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    external_id: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    name: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    status: Mapped[ReferenceStatus] = mapped_column(
        _enum(ReferenceStatus, "reference_status"), nullable=False, default=ReferenceStatus.UNKNOWN
    )
    country: Mapped[str | None] = mapped_column(sa.String(2), nullable=True)
    currency: Mapped[str | None] = mapped_column(sa.String(3), nullable=True)
    notes: Mapped[str] = mapped_column(sa.Text(), nullable=False, default="")


class PersonalAccountReference(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """Metadata and ownership context only. Never an authentication container (A1 §A)."""

    __tablename__ = "personal_account_references"
    __table_args__ = (
        sa.UniqueConstraint("workspace_id", "external_reference_id"),
        sa.Index(
            "ix_personal_account_references_workspace_id_archived_at", "workspace_id", "archived_at"
        ),
    )

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    external_reference_id: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    label: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    display_name: Mapped[str] = mapped_column(sa.String(200), nullable=False, default="")
    status: Mapped[ReferenceStatus] = mapped_column(
        _enum(ReferenceStatus, "reference_status"), nullable=False, default=ReferenceStatus.UNKNOWN
    )
    country: Mapped[str | None] = mapped_column(sa.String(2), nullable=True)
    timezone: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    notes: Mapped[str] = mapped_column(sa.Text(), nullable=False, default="")


class AdAccount(UUIDPrimaryKey, Timestamped, Archivable, Base):
    __tablename__ = "ad_accounts"
    __table_args__ = (
        sa.UniqueConstraint("workspace_id", "external_account_id"),
        sa.Index("ix_ad_accounts_workspace_id_archived_at", "workspace_id", "archived_at"),
        sa.Index("ix_ad_accounts_workspace_id_status", "workspace_id", "status"),
        sa.Index("ix_ad_accounts_workspace_id_readiness_status", "workspace_id", "readiness_status"),
        sa.Index("ix_ad_accounts_workspace_id_updated_at", "workspace_id", "updated_at"),
        sa.Index(
            "ix_ad_accounts_workspace_id_last_manual_review_at",
            "workspace_id",
            "last_manual_review_at",
        ),
    )

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    external_account_id: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    display_name: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    account_type: Mapped[AccountType] = mapped_column(
        _enum(AccountType, "account_type"), nullable=False, default=AccountType.UNKNOWN
    )
    business_manager_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(), sa.ForeignKey("business_managers.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    personal_account_reference_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(),
        sa.ForeignKey("personal_account_references.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    owner_label: Mapped[str] = mapped_column(sa.String(200), nullable=False, default="")
    country: Mapped[str | None] = mapped_column(sa.String(2), nullable=True)
    currency: Mapped[str | None] = mapped_column(sa.String(3), nullable=True)
    timezone: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    status: Mapped[AccountStatus] = mapped_column(
        _enum(AccountStatus, "account_status"), nullable=False, default=AccountStatus.UNKNOWN
    )
    readiness_status: Mapped[ReadinessStatus] = mapped_column(
        _enum(ReadinessStatus, "readiness_status"), nullable=False, default=ReadinessStatus.UNKNOWN
    )
    readiness_evaluated_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    last_manual_review_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    last_activity_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)

    # Explicit operating-workflow requirements. A1 §C marks page/pixel/landing-page items as
    # "conditional"; making the condition an operator-set flag keeps the readiness engine
    # explainable instead of inferring intent from unrelated metadata (Guardrail 6).
    requires_page: Mapped[bool] = mapped_column(sa.Boolean(), nullable=False, default=False)
    requires_pixel: Mapped[bool] = mapped_column(sa.Boolean(), nullable=False, default=False)
    landing_page_url: Mapped[str | None] = mapped_column(sa.String(2048), nullable=True)

    tags: Mapped[list] = mapped_column(sa.JSON(), nullable=False, default=list)
    notes: Mapped[str] = mapped_column(sa.Text(), nullable=False, default="")

    business_manager: Mapped[BusinessManager | None] = relationship(lazy="joined")
    personal_account_reference: Mapped[PersonalAccountReference | None] = relationship(lazy="joined")


class Page(UUIDPrimaryKey, Timestamped, Archivable, Base):
    __tablename__ = "pages"
    __table_args__ = (
        sa.UniqueConstraint("workspace_id", "external_page_id"),
        sa.Index("ix_pages_workspace_id_archived_at", "workspace_id", "archived_at"),
    )

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    external_page_id: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    name: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    url: Mapped[str | None] = mapped_column(sa.String(2048), nullable=True)
    category: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    status: Mapped[ReferenceStatus] = mapped_column(
        _enum(ReferenceStatus, "reference_status"), nullable=False, default=ReferenceStatus.UNKNOWN
    )
    notes: Mapped[str] = mapped_column(sa.Text(), nullable=False, default="")


class Pixel(UUIDPrimaryKey, Timestamped, Archivable, Base):
    __tablename__ = "pixels"
    __table_args__ = (
        sa.UniqueConstraint("workspace_id", "external_pixel_id"),
        sa.Index("ix_pixels_workspace_id_archived_at", "workspace_id", "archived_at"),
    )

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    external_pixel_id: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    name: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    status: Mapped[ReferenceStatus] = mapped_column(
        _enum(ReferenceStatus, "reference_status"), nullable=False, default=ReferenceStatus.UNKNOWN
    )
    notes: Mapped[str] = mapped_column(sa.Text(), nullable=False, default="")


class PaymentProfileReference(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """A pointer to a payment arrangement the operator manages elsewhere.

    `reference_code` is an operator label (e.g. "MB-VISA-01"). No PAN, no CVV, no billing
    credential is accepted here — A1 excludes payment changes and credential storage entirely.
    """

    __tablename__ = "payment_profile_references"
    __table_args__ = (
        sa.UniqueConstraint("workspace_id", "reference_code"),
        sa.Index(
            "ix_payment_profile_references_workspace_id_archived_at", "workspace_id", "archived_at"
        ),
    )

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    reference_code: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    label: Mapped[str] = mapped_column(sa.String(200), nullable=False, default="")
    provider: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    billing_country: Mapped[str | None] = mapped_column(sa.String(2), nullable=True)
    currency: Mapped[str | None] = mapped_column(sa.String(3), nullable=True)
    status: Mapped[ReferenceStatus] = mapped_column(
        _enum(ReferenceStatus, "reference_status"), nullable=False, default=ReferenceStatus.UNKNOWN
    )
    notes: Mapped[str] = mapped_column(sa.Text(), nullable=False, default="")


class BrowserProfileReference(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """`profile_reference` is a local application label, never a cookie path or profile export."""

    __tablename__ = "browser_profile_references"
    __table_args__ = (
        sa.UniqueConstraint("workspace_id", "provider", "profile_reference"),
        sa.Index(
            "ix_browser_profile_references_workspace_id_archived_at", "workspace_id", "archived_at"
        ),
    )

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    provider: Mapped[str] = mapped_column(sa.String(120), nullable=False, default="chrome")
    profile_reference: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    label: Mapped[str] = mapped_column(sa.String(200), nullable=False, default="")
    local_or_remote: Mapped[str] = mapped_column(sa.String(16), nullable=False, default="local")
    status: Mapped[ReferenceStatus] = mapped_column(
        _enum(ReferenceStatus, "reference_status"), nullable=False, default=ReferenceStatus.UNKNOWN
    )
    last_used_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    notes: Mapped[str] = mapped_column(sa.Text(), nullable=False, default="")


class ProxyReference(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """`proxy_reference` is an opaque operator label. Hostnames, usernames, passwords and full
    connection strings are rejected at the schema layer — A1 forbids introducing a secret vault."""

    __tablename__ = "proxy_references"
    __table_args__ = (
        sa.UniqueConstraint("workspace_id", "provider", "proxy_reference"),
        sa.Index("ix_proxy_references_workspace_id_archived_at", "workspace_id", "archived_at"),
    )

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    provider: Mapped[str] = mapped_column(sa.String(120), nullable=False, default="")
    proxy_reference: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    label: Mapped[str] = mapped_column(sa.String(200), nullable=False, default="")
    country: Mapped[str | None] = mapped_column(sa.String(2), nullable=True)
    region: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    protocol: Mapped[str | None] = mapped_column(sa.String(16), nullable=True)
    status: Mapped[ReferenceStatus] = mapped_column(
        _enum(ReferenceStatus, "reference_status"), nullable=False, default=ReferenceStatus.UNKNOWN
    )
    notes: Mapped[str] = mapped_column(sa.Text(), nullable=False, default="")


class AccountAssetLink(UUIDPrimaryKey, Timestamped, Base):
    """Time-bounded assignment of an asset to an ad account.

    Unlinking sets `unlinked_at`; the row survives so the historical mapping stays auditable
    (A1 §A: "non-destructive historical tracking").
    """

    __tablename__ = "account_asset_links"
    __table_args__ = (
        sa.Index("ix_account_asset_links_ad_account_id_asset_type", "ad_account_id", "asset_type"),
        sa.Index("ix_account_asset_links_workspace_id_asset_id", "workspace_id", "asset_id"),
    )

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    ad_account_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("ad_accounts.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    asset_type: Mapped[AssetType] = mapped_column(_enum(AssetType, "asset_type"), nullable=False)
    asset_id: Mapped[uuid.UUID] = mapped_column(sa.Uuid(), nullable=False)
    linked_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    linked_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)
    unlinked_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    unlinked_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)
    note: Mapped[str] = mapped_column(sa.Text(), nullable=False, default="")

    @property
    def is_active(self) -> bool:
        return self.unlinked_at is None


class ReadinessChecklistItem(UUIDPrimaryKey, Timestamped, Archivable, Base):
    __tablename__ = "readiness_checklist_items"
    __table_args__ = (
        sa.UniqueConstraint("ad_account_id", "item_key"),
        sa.Index("ix_readiness_checklist_items_workspace_id_item_key", "workspace_id", "item_key"),
    )

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    ad_account_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("ad_accounts.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    item_key: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    label: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    category: Mapped[ChecklistCategory] = mapped_column(
        _enum(ChecklistCategory, "checklist_category"), nullable=False
    )
    is_mandatory: Mapped[bool] = mapped_column(sa.Boolean(), nullable=False, default=False)
    evidence_status: Mapped[EvidenceStatus] = mapped_column(
        _enum(EvidenceStatus, "evidence_status"), nullable=False, default=EvidenceStatus.MISSING
    )
    review_status: Mapped[ChecklistReviewStatus] = mapped_column(
        _enum(ChecklistReviewStatus, "checklist_review_status"),
        nullable=False,
        default=ChecklistReviewStatus.NOT_REVIEWED,
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    waiver_reason: Mapped[str] = mapped_column(sa.Text(), nullable=False, default="")
    notes: Mapped[str] = mapped_column(sa.Text(), nullable=False, default="")


class ReadinessEvidence(UUIDPrimaryKey, Timestamped, Archivable, Base):
    __tablename__ = "readiness_evidence"
    __table_args__ = (
        sa.Index("ix_readiness_evidence_workspace_id_archived_at", "workspace_id", "archived_at"),
    )

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    checklist_item_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(),
        sa.ForeignKey("readiness_checklist_items.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    evidence_type: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    storage_reference: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)
    external_url: Mapped[str | None] = mapped_column(sa.String(2048), nullable=True)
    summary: Mapped[str] = mapped_column(sa.Text(), nullable=False, default="")
    provided_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    provided_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    verified_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    status: Mapped[EvidenceStatus] = mapped_column(
        _enum(EvidenceStatus, "evidence_status"), nullable=False, default=EvidenceStatus.PROVIDED
    )


class AccountEvent(UUIDPrimaryKey, Timestamped, Archivable, Base):
    __tablename__ = "account_events"
    __table_args__ = (
        sa.Index("ix_account_events_ad_account_id_status", "ad_account_id", "status"),
        sa.Index("ix_account_events_workspace_id_severity", "workspace_id", "severity"),
    )

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    ad_account_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("ad_accounts.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    severity: Mapped[EventSeverity] = mapped_column(
        _enum(EventSeverity, "event_severity"), nullable=False, default=EventSeverity.INFO
    )
    source: Mapped[str] = mapped_column(sa.String(80), nullable=False, default="manual")
    occurred_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    summary: Mapped[str] = mapped_column(sa.Text(), nullable=False, default="")
    evidence_reference: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)
    status: Mapped[EventStatus] = mapped_column(
        _enum(EventStatus, "event_status"), nullable=False, default=EventStatus.OPEN
    )
    resolved_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)
    resolution_note: Mapped[str] = mapped_column(sa.Text(), nullable=False, default="")

    @property
    def is_unresolved(self) -> bool:
        return self.archived_at is None and self.status != EventStatus.RESOLVED


class AuditLog(UUIDPrimaryKey, Base):
    """Append-only. No update path, no archive column, no delete endpoint (A1 Guardrail 3/8)."""

    __tablename__ = "audit_logs"
    __table_args__ = (
        sa.Index("ix_audit_logs_workspace_id_created_at", "workspace_id", "created_at"),
        sa.Index("ix_audit_logs_entity_type_entity_id", "entity_type", "entity_id"),
    )

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    actor_id: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True, index=True)
    action: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    entity_type: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    entity_id: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    before_json: Mapped[dict | None] = mapped_column(sa.JSON(), nullable=True)
    after_json: Mapped[dict | None] = mapped_column(sa.JSON(), nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(sa.JSON(), nullable=True)
    request_id: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
