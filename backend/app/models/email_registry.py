"""Independent P1 contact metadata; never included in generic asset exports."""

from __future__ import annotations

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Archivable, Base, Timestamped, UUIDPrimaryKey


class EmailRegistryEntry(UUIDPrimaryKey, Timestamped, Archivable, Base):
    __tablename__ = "email_registry_entries"
    __table_args__ = (
        sa.UniqueConstraint("workspace_id", "address_index"),
        sa.CheckConstraint("length(address_ciphertext) <= 2048", name="ciphertext_length"),
        sa.CheckConstraint("length(address_index) = 32", name="index_length"),
        sa.CheckConstraint(
            "evidence_source IS NULL OR evidence_source = 'manual_attestation'", name="evidence_source"
        ),
        sa.CheckConstraint("provider != 'gmail' OR account_kind = 'personal'", name="gmail_kind"),
        sa.CheckConstraint("version > 0", name="positive_version"),
        sa.CheckConstraint("index_key_version > 0", name="positive_index_version"),
        sa.CheckConstraint("provider IN ('gmail','microsoft')", name="provider"),
        sa.CheckConstraint("account_kind IN ('personal','managed','unknown')", name="kind"),
        sa.CheckConstraint("state IN ('unknown','pending','recorded','blocked')", name="state"),
        sa.CheckConstraint("(review_due_at IS NULL) = (review_timezone IS NULL)", name="due_pair"),
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False
    )
    responsible_member_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspace_members.id", ondelete="RESTRICT"), nullable=True
    )
    evidence_recorded_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    updated_by: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    archived_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    provider: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    account_kind: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    address_ciphertext: Mapped[str] = mapped_column(sa.Text(), nullable=False)
    address_hint: Mapped[str] = mapped_column(sa.String(320), nullable=False)
    address_index: Mapped[bytes] = mapped_column(sa.LargeBinary(32), nullable=False)
    index_key_version: Mapped[int] = mapped_column(sa.SmallInteger(), nullable=False)
    state: Mapped[str] = mapped_column(
        sa.String(16), nullable=False, default="unknown", server_default="unknown"
    )
    evidence_source: Mapped[str | None] = mapped_column(sa.String(24), nullable=True)
    review_timezone: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    next_action: Mapped[str | None] = mapped_column(sa.String(240), nullable=True)
    reason: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)
    version: Mapped[int] = mapped_column(sa.BigInteger(), nullable=False, default=1, server_default="1")
    evidence_observed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    evidence_recorded_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    review_due_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
