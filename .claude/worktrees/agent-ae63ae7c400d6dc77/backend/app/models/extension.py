"""Extension installations (A5).

One row per browser profile that has exchanged a dashboard session for an extension session.
It exists so an operator can see which browsers are connected and cut one off immediately —
revocation is a row, not a claim, so it takes effect on the next request instead of whenever a
token happens to expire.

What it deliberately does not store: no browser fingerprint, no user agent string, no browsing
history, no page telemetry, no Meta identifier of any kind. An installation is a name, a
version and a timestamp.
"""
from __future__ import annotations

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamped, UUIDPrimaryKey


class ExtensionInstallation(UUIDPrimaryKey, Timestamped, Base):
    __tablename__ = "extension_installations"
    __table_args__ = (
        # One live installation per browser profile per user, enforced by the service rather
        # than a constraint: a revoked row must be allowed to coexist with its replacement.
        sa.Index("ix_extinst_ws_user", "workspace_id", "user_id"),
        sa.Index("ix_extinst_instance", "workspace_id", "extension_instance_id"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    #: A random id the extension generates once and keeps in local storage. It identifies a
    #: browser profile to this product and means nothing anywhere else.
    extension_instance_id: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    #: Operator-facing label, e.g. "Chrome — BM USA profile". Free text, never a hostname.
    label: Mapped[str] = mapped_column(sa.String(120), nullable=False, default="")
    extension_version: Mapped[str] = mapped_column(sa.String(32), nullable=False, default="")
    last_seen_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    revoked_reason: Mapped[str | None] = mapped_column(sa.String(200))

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None
