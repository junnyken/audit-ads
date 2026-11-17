"""a10_3 business authority on a discovery run

Revision ID: 0014_a10_3_authority
Revises: 0013_a10_2_actor
Create Date: 2026-09-11 16:20:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0014_a10_3_authority'
down_revision = '0013_a10_2_actor'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Not nullable, with a server default of NOT_CHECKED: every run recorded before this column
    # existed genuinely did not ask the question, and that is exactly what NOT_CHECKED says.
    # Backfilling anything else would invent evidence for runs that never gathered any.
    #
    # `sa.Enum(..., native_enum=False)` matches the project's `_enum()` helper — a VARCHAR with a
    # CHECK constraint, storing the member NAME, not a Postgres ENUM type.
    op.add_column(
        'business_manager_discovery_runs',
        sa.Column(
            'business_authority',
            sa.Enum(
                'NOT_CHECKED',
                'ESTABLISHED',
                'NOT_ESTABLISHED',
                name='business_authority',
                native_enum=False,
                length=48,
            ),
            nullable=False,
            server_default='NOT_CHECKED',
        ),
    )


def downgrade() -> None:
    op.drop_column('business_manager_discovery_runs', 'business_authority')
