"""A4: operational run history for deployment observability.

One additive table. No A1/A2/A3 table is touched, so the downgrade is a clean drop and a
rollback of this release never risks product data.

Revision ID: 0004_a4_operational_runs
Revises: 0003_a3_alerts
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0004_a4_operational_runs"
down_revision = "0003_a3_alerts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "operational_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.Enum(
            "DISPATCH", "RECOVERY_SWEEP", "BACKUP", "RESTORE_DRILL", "MIGRATION_RELEASE",
            "TEST_SEND", name="operationalrunkind", native_enum=False, length=32,
        ), nullable=False),
        sa.Column("status", sa.Enum(
            "SUCCEEDED", "PARTIAL", "FAILED",
            name="operationalrunstatus", native_enum=False, length=16,
        ), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("summary_json", sa.JSON(), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_summary", sa.String(length=500), nullable=True),
        sa.Column("release_version", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_operational_runs")),
    )
    op.create_index("ix_oprun_kind_started", "operational_runs", ["kind", "started_at"])
    op.create_index(
        "ix_oprun_kind_status_started", "operational_runs", ["kind", "status", "started_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_oprun_kind_status_started", table_name="operational_runs")
    op.drop_index("ix_oprun_kind_started", table_name="operational_runs")
    op.drop_table("operational_runs")
