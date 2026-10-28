"""C1: client_name, planned_daily_budget_raw, and planned_monthly_budget_raw on ad_accounts.

Revision ID: 0021_c1_client_budget_and_pacing
Revises: 0020_f3_business_users
Create Date: 2026-10-28
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0021_c1_client_budget_and_pacing"
down_revision = "0020_f3_business_users"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ad_accounts",
        sa.Column("client_name", sa.String(length=200), nullable=False, server_default=""),
    )
    op.add_column(
        "ad_accounts",
        sa.Column("planned_daily_budget_raw", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "ad_accounts",
        sa.Column("planned_monthly_budget_raw", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ad_accounts", "planned_monthly_budget_raw")
    op.drop_column("ad_accounts", "planned_daily_budget_raw")
    op.drop_column("ad_accounts", "client_name")
