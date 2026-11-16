"""Community Governance & Workspace Quotas (v2.5.0).

Revision ID: 0023_community_quotas
Revises: 0022_f1_5_login_environment
Create Date: 2026-11-16 11:30:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0023_community_quotas"
down_revision = "0022_f1_5_login_environment"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_platform_admin", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "workspaces",
        sa.Column("plan_tier", sa.String(length=32), nullable=False, server_default="agency"),
    )
    op.add_column(
        "workspaces",
        sa.Column("max_vias", sa.Integer(), nullable=False, server_default="500"),
    )
    op.add_column(
        "workspaces",
        sa.Column("max_ad_accounts", sa.Integer(), nullable=False, server_default="500"),
    )
    op.add_column(
        "workspaces",
        sa.Column("max_members", sa.Integer(), nullable=False, server_default="25"),
    )
    op.add_column(
        "workspaces",
        sa.Column("community_status", sa.String(length=32), nullable=False, server_default="active"),
    )
    op.add_column(
        "workspaces",
        sa.Column("invited_by_code", sa.String(length=64), nullable=True),
    )

    op.create_table(
        "community_invite_codes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=160), nullable=False, server_default=""),
        sa.Column("plan_tier", sa.String(length=32), nullable=False, server_default="community_free"),
        sa.Column("max_vias", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("max_ad_accounts", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("max_members", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("max_uses", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("used_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_community_invite_codes_code", "community_invite_codes", ["code"])

    # Backfill earliest owner as platform admin cleanly (idempotent & non-destructive)
    op.execute(
        """
        UPDATE users
        SET is_platform_admin = TRUE
        WHERE id = (
            SELECT id FROM users WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1
        )
        """
    )


def downgrade() -> None:
    op.drop_index("ix_community_invite_codes_code", table_name="community_invite_codes")
    op.drop_table("community_invite_codes")
    op.drop_column("workspaces", "invited_by_code")
    op.drop_column("workspaces", "community_status")
    op.drop_column("workspaces", "max_members")
    op.drop_column("workspaces", "max_ad_accounts")
    op.drop_column("workspaces", "max_vias")
    op.drop_column("workspaces", "plan_tier")
    op.drop_column("users", "is_platform_admin")
