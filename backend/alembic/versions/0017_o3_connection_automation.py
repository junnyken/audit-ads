"""o3 connection automation switches

Revision ID: 0017_o3_conn_automation
Revises: 0016_s1_spend_observations
Create Date: 2026-10-27 10:00:00.000000

Four additive columns on `meta_connections`, nothing else. Both switches default to false in
the database as well as in code, so every existing connection keeps meaning "a person starts
discovery and import". Every other value O3 adds (`DiscoveryTrigger.SCHEDULED_SWEEP`,
`OperationalRunKind.DISCOVERY_SWEEP`, `AlertSourceType.DISCOVERY_SWEEP`,
`DeliverySkipReason.AUTO_IMPORT_GRACE`, `EvaluationTrigger.DISCOVERY_SWEEP`) lands in an existing
non-native enum column — a plain VARCHAR with no CHECK constraint — so none needs a schema change.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0017_o3_conn_automation'
down_revision = '0016_s1_spend_observations'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'meta_connections',
        sa.Column('auto_discovery_enabled', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        'meta_connections',
        sa.Column('auto_import_enabled', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column('meta_connections', sa.Column('automation_enabled_by', sa.Uuid(), nullable=True))
    op.add_column(
        'meta_connections',
        sa.Column('automation_enabled_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('meta_connections', 'automation_enabled_at')
    op.drop_column('meta_connections', 'automation_enabled_by')
    op.drop_column('meta_connections', 'auto_import_enabled')
    op.drop_column('meta_connections', 'auto_discovery_enabled')
