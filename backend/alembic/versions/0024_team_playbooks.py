"""Team Automation Playbooks Marketplace & Star Ratings (v2.6.0).

Revision ID: 0024_team_playbooks
Revises: 0023_community_quotas
Create Date: 2026-11-16 14:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0024_team_playbooks"
down_revision = "0023_community_quotas"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "automation_playbooks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("platform", sa.String(length=32), nullable=False, server_default="meta"),
        sa.Column("category", sa.String(length=64), nullable=False, server_default="warmup"),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("version_tag", sa.String(length=32), nullable=False, server_default="1.0.0"),
        sa.Column("changelog", sa.Text(), nullable=False, server_default=""),
        sa.Column("steps_json", sa.JSON(), nullable=False),
        sa.Column("default_stagger_sec", sa.Integer(), nullable=False, server_default="55"),
        sa.Column("jitter_pct", sa.Integer(), nullable=False, server_default="35"),
        sa.Column("is_builtin", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "author_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("rating_sum", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rating_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("run_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "slug", name="uq_automation_playbooks_ws_slug"),
    )
    op.create_index(
        "ix_automation_playbooks_ws_archived",
        "automation_playbooks",
        ["workspace_id", "archived_at"],
    )

    op.create_table(
        "automation_playbook_ratings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "playbook_id",
            sa.Uuid(),
            sa.ForeignKey("automation_playbooks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("stars", sa.Integer(), nullable=False),
        sa.Column("comment", sa.String(length=400), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("playbook_id", "user_id", name="uq_playbook_rating_user"),
    )
    op.create_index(
        "ix_playbook_ratings_playbook_id",
        "automation_playbook_ratings",
        ["playbook_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_playbook_ratings_playbook_id", table_name="automation_playbook_ratings")
    op.drop_table("automation_playbook_ratings")
    op.drop_index("ix_automation_playbooks_ws_archived", table_name="automation_playbooks")
    op.drop_table("automation_playbooks")
