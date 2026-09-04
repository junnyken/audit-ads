"""Operational run records (A4).

Infrastructure history, not tenant data: when the dispatcher last ran, when a backup last
succeeded, which migration release was applied. It carries counters and allowlisted error
codes only — never a path, a connection string, a recipient or a message.

It is deliberately not workspace-scoped. A dispatcher pass covers every workspace, and a
backup covers the whole database; pretending either belongs to one tenant would make the
"stale dispatcher" signal wrong the moment a second workspace exists.
"""
from __future__ import annotations

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.core.enums import OperationalRunKind, OperationalRunStatus
from app.db.base import Base, Timestamped, UUIDPrimaryKey


class OperationalRun(UUIDPrimaryKey, Timestamped, Base):
    """One recorded run of an operational process."""

    __tablename__ = "operational_runs"

    kind: Mapped[OperationalRunKind] = mapped_column(
        sa.Enum(OperationalRunKind, native_enum=False, length=32), nullable=False
    )
    status: Mapped[OperationalRunStatus] = mapped_column(
        sa.Enum(OperationalRunStatus, native_enum=False, length=16), nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    duration_ms: Mapped[int | None] = mapped_column(sa.Integer)
    #: Safe counters only (claimed/sent/failed, bytes, table counts). Never a path or a secret.
    summary_json: Mapped[dict | None] = mapped_column(sa.JSON)
    #: Allowlisted code, never an exception message from a provider or the shell.
    error_code: Mapped[str | None] = mapped_column(sa.String(64))
    error_summary: Mapped[str | None] = mapped_column(sa.String(500))
    #: The release that produced the run, so a status page can say *which* build is stale.
    release_version: Mapped[str | None] = mapped_column(sa.String(64))

    __table_args__ = (
        sa.Index("ix_oprun_kind_started", "kind", "started_at"),
        sa.Index("ix_oprun_kind_status_started", "kind", "status", "started_at"),
    )
