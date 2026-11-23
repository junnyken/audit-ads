"""Commercial SaaS Password Reset, License Expiry & Desktop Device Channel (v4.4.0).

Revision ID: 0025_commercial_saas_license
Revises: 0024_team_playbooks
Create Date: 2026-11-23 11:15:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0025_commercial_saas_license"
down_revision = "0024_team_playbooks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspaces",
        sa.Column("plan_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "workspaces",
        sa.Column("max_desktop_devices", sa.Integer(), nullable=True),
    )
    op.add_column(
        "community_invite_codes",
        sa.Column("duration_days", sa.Integer(), nullable=True),
    )
    op.add_column(
        "device_sessions",
        sa.Column("client_channel", sa.String(length=20), nullable=False, server_default="web"),
    )
    op.add_column(
        "device_sessions",
        sa.Column("installation_hash", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_device_sessions_installation_hash",
        "device_sessions",
        ["installation_hash"],
    )

    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("requested_ip_hash", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_password_reset_tokens_hash"),
    )
    op.create_index(
        "ix_password_reset_tokens_user_id",
        "password_reset_tokens",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_password_reset_tokens_user_id", table_name="password_reset_tokens")
    op.drop_table("password_reset_tokens")
    op.drop_index("ix_device_sessions_installation_hash", table_name="device_sessions")
    op.drop_column("device_sessions", "installation_hash")
    op.drop_column("device_sessions", "client_channel")
    op.drop_column("community_invite_codes", "duration_days")
    op.drop_column("workspaces", "max_desktop_devices")
    op.drop_column("workspaces", "plan_expires_at")
