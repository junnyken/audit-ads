"""f1 facebook account profiles

Revision ID: 0019_f1_facebook_identities
Revises: 0018_o4_reader_credentials
Create Date: 2026-10-28 10:00:00.000000

Additive only:

* `personal_account_references` gains the F1 profile columns: who holds the account, how its second
  factor works, where its password is kept (a label or link — never the password), a recovery note, and
  the login email as `email_hint` (masked) plus `email_ciphertext` (Fernet, `CREDENTIAL_VAULT_KEY`).
* `personal_account_business_links`: which Business Managers a Facebook account manages, with history.
* `meta_reader_credentials.personal_account_reference_id`: which Facebook account granted a credential.
* `users` gains the reveal-PIN hash and its lockout counters.

Every existing row keeps its meaning: new columns are nullable or default to "unknown"/empty. Downgrade
drops all of it, including stored email ciphertext and PIN hashes — deliberate (rule 30).
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0019_f1_facebook_identities'
down_revision = '0018_o4_reader_credentials'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('personal_account_references') as batch:
        batch.add_column(sa.Column('owner_member_id', sa.Uuid(), nullable=True))
        batch.add_column(
            sa.Column(
                'two_factor_method',
                sa.Enum(
                    'UNKNOWN', 'APP', 'SMS', 'SECURITY_KEY', 'NONE',
                    name='two_factor_method', native_enum=False, length=48,
                ),
                nullable=False,
                server_default='UNKNOWN',
            )
        )
        batch.add_column(sa.Column('vault_reference', sa.String(length=2048), nullable=False, server_default=''))
        batch.add_column(sa.Column('recovery_note', sa.Text(), nullable=False, server_default=''))
        batch.add_column(sa.Column('email_hint', sa.String(length=320), nullable=True))
        batch.add_column(sa.Column('email_ciphertext', sa.Text(), nullable=True))
        batch.create_foreign_key(
            'fk_personal_account_references_owner_member_id',
            'workspace_members', ['owner_member_id'], ['id'], ondelete='RESTRICT',
        )

    op.create_table(
        'personal_account_business_links',
        sa.Column('workspace_id', sa.Uuid(), nullable=False),
        sa.Column('personal_account_reference_id', sa.Uuid(), nullable=False),
        sa.Column('business_manager_id', sa.Uuid(), nullable=False),
        sa.Column(
            'role',
            sa.Enum('UNKNOWN', 'ADMIN', 'EMPLOYEE', name='identity_business_role', native_enum=False, length=48),
            nullable=False,
        ),
        sa.Column('note', sa.Text(), nullable=False),
        sa.Column('linked_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('linked_by', sa.Uuid(), nullable=True),
        sa.Column('unlinked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('unlinked_by', sa.Uuid(), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(
            ['personal_account_reference_id'], ['personal_account_references.id'], ondelete='RESTRICT'
        ),
        sa.ForeignKeyConstraint(['business_manager_id'], ['business_managers.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_personal_account_business_links_workspace_id', 'personal_account_business_links', ['workspace_id']
    )
    op.create_index(
        'ix_pa_business_links_ws_bm', 'personal_account_business_links', ['workspace_id', 'business_manager_id']
    )
    op.create_index(
        'ix_pa_business_links_ref', 'personal_account_business_links', ['personal_account_reference_id']
    )
    op.create_index(
        'uq_pa_business_links_active',
        'personal_account_business_links',
        ['personal_account_reference_id', 'business_manager_id'],
        unique=True,
        postgresql_where=sa.text('unlinked_at IS NULL'),
        sqlite_where=sa.text('unlinked_at IS NULL'),
    )

    with op.batch_alter_table('meta_reader_credentials') as batch:
        batch.add_column(sa.Column('personal_account_reference_id', sa.Uuid(), nullable=True))
        batch.create_foreign_key(
            'fk_meta_reader_credentials_personal_account_reference_id',
            'personal_account_references', ['personal_account_reference_id'], ['id'], ondelete='RESTRICT',
        )

    with op.batch_alter_table('users') as batch:
        batch.add_column(sa.Column('reveal_pin_hash', sa.String(length=255), nullable=True))
        batch.add_column(sa.Column('reveal_pin_failed_count', sa.Integer(), nullable=False, server_default='0'))
        batch.add_column(sa.Column('reveal_pin_locked_until', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('users') as batch:
        batch.drop_column('reveal_pin_locked_until')
        batch.drop_column('reveal_pin_failed_count')
        batch.drop_column('reveal_pin_hash')

    with op.batch_alter_table('meta_reader_credentials') as batch:
        batch.drop_constraint('fk_meta_reader_credentials_personal_account_reference_id', type_='foreignkey')
        batch.drop_column('personal_account_reference_id')

    op.drop_index('uq_pa_business_links_active', table_name='personal_account_business_links')
    op.drop_index('ix_pa_business_links_ref', table_name='personal_account_business_links')
    op.drop_index('ix_pa_business_links_ws_bm', table_name='personal_account_business_links')
    op.drop_index('ix_personal_account_business_links_workspace_id', table_name='personal_account_business_links')
    op.drop_table('personal_account_business_links')

    with op.batch_alter_table('personal_account_references') as batch:
        batch.drop_constraint('fk_personal_account_references_owner_member_id', type_='foreignkey')
        batch.drop_column('email_ciphertext')
        batch.drop_column('email_hint')
        batch.drop_column('recovery_note')
        batch.drop_column('vault_reference')
        batch.drop_column('two_factor_method')
        batch.drop_column('owner_member_id')
