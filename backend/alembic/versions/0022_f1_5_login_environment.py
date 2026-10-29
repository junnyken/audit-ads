"""F1.5: add ownership_type, client_name, device_label, browser_profile_label, network_label to personal_account_references

Revision ID: 0022_f1_5_login_environment
Revises: 0021_c1_client_budget_and_pacing
Create Date: 2026-10-29 00:15:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0022_f1_5_login_environment"
down_revision = "0021_c1_client_budget_and_pacing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "personal_account_references",
        sa.Column(
            "ownership_type",
            sa.String(length=32),
            nullable=False,
            server_default="AGENCY_OWNED",
        ),
    )
    op.add_column(
        "personal_account_references",
        sa.Column("client_name", sa.String(length=200), nullable=False, server_default=""),
    )
    op.add_column(
        "personal_account_references",
        sa.Column("device_label", sa.String(length=160), nullable=False, server_default=""),
    )
    op.add_column(
        "personal_account_references",
        sa.Column("browser_profile_label", sa.String(length=160), nullable=False, server_default=""),
    )
    op.add_column(
        "personal_account_references",
        sa.Column("network_label", sa.String(length=160), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("personal_account_references", "network_label")
    op.drop_column("personal_account_references", "browser_profile_label")
    op.drop_column("personal_account_references", "device_label")
    op.drop_column("personal_account_references", "client_name")
    op.drop_column("personal_account_references", "ownership_type")
