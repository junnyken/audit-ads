"""A5: extension installations and event source context.

Additive only: one new table and one nullable column. No A1–A4 table is altered in a way an
older release would notice, so a rollback of this release needs no schema downgrade.

Revision ID: 0005_a5_extension
Revises: 0004_a4_operational_runs
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005_a5_extension"
down_revision = "0004_a4_operational_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "extension_installations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("extension_instance_id", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("extension_version", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_reason", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.id"], name=op.f("fk_extinst_workspace_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_extinst_user_id"), ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_extension_installations")),
    )
    op.create_index("ix_extinst_ws_user", "extension_installations", ["workspace_id", "user_id"])
    op.create_index(
        "ix_extinst_instance", "extension_installations", ["workspace_id", "extension_instance_id"]
    )
    op.create_index(
        op.f("ix_extension_installations_workspace_id"),
        "extension_installations",
        ["workspace_id"],
    )
    op.create_index(
        op.f("ix_extension_installations_user_id"), "extension_installations", ["user_id"]
    )

    # Nullable, so every existing event keeps its meaning: "no recorded source context" rather
    # than an invented one.
    op.add_column("account_events", sa.Column("source_context_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("account_events", "source_context_json")
    op.drop_index(op.f("ix_extension_installations_user_id"), table_name="extension_installations")
    op.drop_index(
        op.f("ix_extension_installations_workspace_id"), table_name="extension_installations"
    )
    op.drop_index("ix_extinst_instance", table_name="extension_installations")
    op.drop_index("ix_extinst_ws_user", table_name="extension_installations")
    op.drop_table("extension_installations")
