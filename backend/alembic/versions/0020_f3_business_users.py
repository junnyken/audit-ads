"""f3 business users discovery and identity link confirmation

Revision ID: 0020_f3_business_users
Revises: 0019_f1_facebook_identities
Create Date: 2026-10-28 22:00:00.000000

Additive only:

* `business_manager_discovery_runs` gains `business_user_required_edges_json`,
  `business_user_coverage_json`, and `business_user_coverage_status` (`NOT_ATTEMPTED` default).
* `discovered_business_user_observations` stores allowlisted `business_users` (`id`, `name`, `role`)
  observed in a Business Manager discovery run (never email, token, or password).
* `personal_account_business_links` gains `external_business_user_id` (`String(120)`, nullable)
  for operator-confirmed mapping between an internal Facebook profile (`PersonalAccountReference`)
  and a Meta `business_user` id.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0020_f3_business_users'
down_revision = '0019_f1_facebook_identities'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('business_manager_discovery_runs') as batch:
        batch.add_column(sa.Column('business_user_required_edges_json', sa.JSON(), nullable=True))
        batch.add_column(sa.Column('business_user_coverage_json', sa.JSON(), nullable=True))
        batch.add_column(
            sa.Column(
                'business_user_coverage_status',
                sa.Enum(
                    'COMPLETE',
                    'PARTIAL_PERMISSION',
                    'PARTIAL_PAGINATION',
                    'FAILED',
                    'NOT_ATTEMPTED',
                    name='coverage_status',
                    native_enum=False,
                    length=48,
                ),
                nullable=False,
                server_default='NOT_ATTEMPTED',
            )
        )

    op.create_table(
        'discovered_business_user_observations',
        sa.Column('workspace_id', sa.Uuid(), nullable=False),
        sa.Column('business_manager_discovery_run_id', sa.Uuid(), nullable=False),
        sa.Column('provider_business_manager_id', sa.String(length=120), nullable=False),
        sa.Column('external_user_id', sa.String(length=120), nullable=False),
        sa.Column('display_name', sa.String(length=200), nullable=True),
        sa.Column('role', sa.String(length=80), nullable=True),
        sa.Column('source_edge', sa.String(length=60), nullable=False),
        sa.Column('safe_metadata_json', sa.JSON(), nullable=True),
        sa.Column('observed_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(
            ['business_manager_discovery_run_id'],
            ['business_manager_discovery_runs.id'],
            ondelete='RESTRICT',
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_discovered_business_user_observations_workspace_id',
        'discovered_business_user_observations',
        ['workspace_id'],
    )
    op.create_index(
        'ix_discovered_business_user_observations_run_id',
        'discovered_business_user_observations',
        ['business_manager_discovery_run_id'],
    )
    op.create_index(
        'ix_disc_buser_ws_run_ext',
        'discovered_business_user_observations',
        ['workspace_id', 'business_manager_discovery_run_id', 'external_user_id'],
    )

    with op.batch_alter_table('personal_account_business_links') as batch:
        batch.add_column(sa.Column('external_business_user_id', sa.String(length=120), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('personal_account_business_links') as batch:
        batch.drop_column('external_business_user_id')

    op.drop_index('ix_disc_buser_ws_run_ext', table_name='discovered_business_user_observations')
    op.drop_index(
        'ix_discovered_business_user_observations_run_id',
        table_name='discovered_business_user_observations',
    )
    op.drop_index(
        'ix_discovered_business_user_observations_workspace_id',
        table_name='discovered_business_user_observations',
    )
    op.drop_table('discovered_business_user_observations')

    with op.batch_alter_table('business_manager_discovery_runs') as batch:
        batch.drop_column('business_user_coverage_status')
        batch.drop_column('business_user_coverage_json')
        batch.drop_column('business_user_required_edges_json')
