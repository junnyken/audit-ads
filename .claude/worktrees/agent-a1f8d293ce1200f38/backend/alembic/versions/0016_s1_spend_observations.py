"""s1 spend observations (Meta, read-only)

Revision ID: 0016_s1_spend_observations
Revises: 0015_a10_3_conn_bm
Create Date: 2026-10-26 10:00:00.000000

One additive table. No existing table is altered; every new enum value S1 adds
(`HealthCategory.SPEND`, `HealthSourceType.PROVIDER_OBSERVATION`,
`EvaluationTrigger.SPEND_OBSERVATION`, `OperationalRunKind.SPEND_SWEEP`) lands in an existing
non-native enum column that compiles to a plain VARCHAR with no CHECK constraint, so none of them
needs a schema change.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0016_s1_spend_observations'
down_revision = '0015_a10_3_conn_bm'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'ad_account_spend_observations',
        sa.Column('workspace_id', sa.Uuid(), nullable=False),
        sa.Column('ad_account_id', sa.Uuid(), nullable=False),
        sa.Column('meta_connection_id', sa.Uuid(), nullable=False),
        sa.Column('external_account_id', sa.String(length=120), nullable=False),
        sa.Column('reader_source', sa.String(length=32), nullable=False),
        sa.Column('provider_actor_external_id', sa.String(length=120), nullable=True),
        sa.Column('provider_actor_name', sa.String(length=200), nullable=True),
        sa.Column(
            'trigger',
            sa.Enum('SCHEDULED_SWEEP', 'MANUAL_REFRESH', name='spend_observation_trigger', native_enum=False, length=48),
            nullable=False,
        ),
        sa.Column('observed_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            'status',
            sa.Enum('SUCCEEDED', 'FAILED', name='spend_observation_status', native_enum=False, length=48),
            nullable=False,
        ),
        sa.Column('failure_code', sa.String(length=64), nullable=True),
        sa.Column('failure_summary', sa.String(length=500), nullable=True),
        sa.Column('observed_currency', sa.String(length=3), nullable=True),
        sa.Column('observed_timezone_name', sa.String(length=64), nullable=True),
        sa.Column('observed_account_status', sa.String(length=16), nullable=True),
        sa.Column('observed_disable_reason', sa.String(length=16), nullable=True),
        sa.Column('amount_spent_raw', sa.String(length=32), nullable=True),
        sa.Column('spend_cap_raw', sa.String(length=32), nullable=True),
        sa.Column('balance_raw', sa.String(length=32), nullable=True),
        sa.Column('daily_json', sa.JSON(), nullable=True),
        sa.Column('window_since', sa.Date(), nullable=True),
        sa.Column('window_until', sa.Date(), nullable=True),
        sa.Column('safe_metadata_json', sa.JSON(), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ['ad_account_id'], ['ad_accounts.id'],
            name=op.f('fk_ad_account_spend_observations_ad_account_id_ad_accounts'), ondelete='RESTRICT',
        ),
        sa.ForeignKeyConstraint(
            ['meta_connection_id'], ['meta_connections.id'],
            name=op.f('fk_ad_account_spend_observations_meta_connection_id_meta_connections'), ondelete='RESTRICT',
        ),
        sa.ForeignKeyConstraint(
            ['workspace_id'], ['workspaces.id'],
            name=op.f('fk_ad_account_spend_observations_workspace_id_workspaces'), ondelete='RESTRICT',
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_ad_account_spend_observations')),
    )
    op.create_index(
        'ix_spend_obs_ws_account_observed', 'ad_account_spend_observations',
        ['workspace_id', 'ad_account_id', 'observed_at'], unique=False,
    )
    op.create_index(
        'ix_spend_obs_ws_status_observed', 'ad_account_spend_observations',
        ['workspace_id', 'status', 'observed_at'], unique=False,
    )
    op.create_index(
        op.f('ix_ad_account_spend_observations_workspace_id'), 'ad_account_spend_observations',
        ['workspace_id'], unique=False,
    )
    op.create_index(
        op.f('ix_ad_account_spend_observations_ad_account_id'), 'ad_account_spend_observations',
        ['ad_account_id'], unique=False,
    )
    op.create_index(
        op.f('ix_ad_account_spend_observations_meta_connection_id'), 'ad_account_spend_observations',
        ['meta_connection_id'], unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_ad_account_spend_observations_meta_connection_id'), table_name='ad_account_spend_observations')
    op.drop_index(op.f('ix_ad_account_spend_observations_ad_account_id'), table_name='ad_account_spend_observations')
    op.drop_index(op.f('ix_ad_account_spend_observations_workspace_id'), table_name='ad_account_spend_observations')
    op.drop_index('ix_spend_obs_ws_status_observed', table_name='ad_account_spend_observations')
    op.drop_index('ix_spend_obs_ws_account_observed', table_name='ad_account_spend_observations')
    op.drop_table('ad_account_spend_observations')
