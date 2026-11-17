"""a10_3 business manager per meta connection

Revision ID: 0015_a10_3_conn_bm
Revises: 0014_a10_3_authority
Create Date: 2026-09-12 09:10:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0015_a10_3_conn_bm'
down_revision = '0014_a10_3_authority'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Empty, not backfilled with META_BUSINESS_ID. Empty means "use whatever the server is
    # configured with", which is exactly what every existing connection already did — writing the
    # current server value into the rows would freeze today's configuration into history and claim
    # those runs had been pinned to a Business Manager when they never were.
    op.add_column(
        'meta_connections',
        sa.Column('business_manager_reference', sa.String(length=120), nullable=False, server_default=''),
    )


def downgrade() -> None:
    op.drop_column('meta_connections', 'business_manager_reference')
