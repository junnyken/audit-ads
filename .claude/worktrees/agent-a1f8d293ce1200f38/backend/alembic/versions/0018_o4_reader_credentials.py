"""o4 stored meta reader credentials (vault)

Revision ID: 0018_o4_reader_credentials
Revises: 0017_o3_conn_automation
Create Date: 2026-10-27 18:00:00.000000

One additive table, `meta_reader_credentials`, and one nullable column on `meta_connections`,
`reader_credential_id`. `encrypted_secret` is the only column in the schema that carries a
credential — Fernet ciphertext; the key is server configuration (`CREDENTIAL_VAULT_KEY`), never
the database (rule 1's single exception, rule 40).

Every existing connection gets `reader_credential_id = NULL`, which keeps meaning "read with the
server configuration", so nothing reads differently after the upgrade. The other O4 values
(`OperationalRunKind.CREDENTIAL_CHECK`, `AlertSourceType.READER_CREDENTIAL`, `reader_source`
`vault` / `vault_reconnect_required`) land in existing VARCHAR columns and need no schema change.

Downgrade drops the column and the table — and with them every stored credential. That is the
correct direction for a downgrade (a schema that cannot hold ciphertext must not keep it), and
also why rule 30 makes a downgrade a deliberate decision with a person present.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0018_o4_reader_credentials'
down_revision = '0017_o3_conn_automation'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'meta_reader_credentials',
        sa.Column('workspace_id', sa.Uuid(), nullable=False),
        sa.Column('label', sa.String(length=200), nullable=False),
        sa.Column(
            'kind',
            sa.Enum('SYSTEM_USER', 'USER', name='reader_credential_kind', native_enum=False, length=48),
            nullable=False,
        ),
        sa.Column(
            'status',
            sa.Enum(
                'PENDING_VERIFICATION', 'ACTIVE', 'RECONNECT_REQUIRED', 'REVOKED',
                name='reader_credential_status', native_enum=False, length=48,
            ),
            nullable=False,
        ),
        sa.Column('encrypted_secret', sa.Text(), nullable=True),
        sa.Column('secret_last_rotated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('provider_user_external_id', sa.String(length=120), nullable=True),
        sa.Column('provider_user_name', sa.String(length=200), nullable=True),
        sa.Column('scopes_json', sa.JSON(), nullable=True),
        sa.Column('issued_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('data_access_expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_verified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_verify_outcome', sa.String(length=64), nullable=True),
        sa.Column('reconnect_reason', sa.String(length=64), nullable=True),
        sa.Column('businesses_seen_json', sa.JSON(), nullable=True),
        sa.Column('connected_by', sa.Uuid(), nullable=False),
        sa.Column('connected_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('revoked_by', sa.Uuid(), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoke_reason', sa.Text(), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ['workspace_id'], ['workspaces.id'],
            name=op.f('fk_meta_reader_credentials_workspace_id_workspaces'), ondelete='RESTRICT',
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_meta_reader_credentials')),
    )
    op.create_index(
        op.f('ix_meta_reader_credentials_workspace_id'), 'meta_reader_credentials',
        ['workspace_id'], unique=False,
    )
    op.create_index(
        'ix_meta_reader_cred_ws_status', 'meta_reader_credentials',
        ['workspace_id', 'status'], unique=False,
    )
    op.add_column('meta_connections', sa.Column('reader_credential_id', sa.Uuid(), nullable=True))
    op.create_foreign_key(
        'fk_meta_conn_reader_credential',
        'meta_connections', 'meta_reader_credentials',
        ['reader_credential_id'], ['id'], ondelete='RESTRICT',
    )
    op.create_index(
        op.f('ix_meta_connections_reader_credential_id'), 'meta_connections',
        ['reader_credential_id'], unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_meta_connections_reader_credential_id'), table_name='meta_connections')
    op.drop_constraint(
        'fk_meta_conn_reader_credential',
        'meta_connections', type_='foreignkey',
    )
    op.drop_column('meta_connections', 'reader_credential_id')
    op.drop_index('ix_meta_reader_cred_ws_status', table_name='meta_reader_credentials')
    op.drop_index(op.f('ix_meta_reader_credentials_workspace_id'), table_name='meta_reader_credentials')
    op.drop_table('meta_reader_credentials')
