"""P1 additive independent email registry. No F1 import; retained on rollback."""

from alembic import op

revision = "0027_p1_email_registry"
down_revision = "0026_v52_security_and_verification"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
CREATE TABLE email_registry_entries (
	workspace_id UUID NOT NULL,
	responsible_member_id UUID,
	evidence_recorded_by UUID,
	created_by UUID NOT NULL,
	updated_by UUID NOT NULL,
	archived_by UUID,
	provider VARCHAR(16) NOT NULL,
	account_kind VARCHAR(16) NOT NULL,
	address_ciphertext TEXT NOT NULL,
	address_hint VARCHAR(320) NOT NULL,
	address_index BYTEA NOT NULL,
	index_key_version SMALLINT NOT NULL,
	state VARCHAR(16) DEFAULT 'unknown' NOT NULL,
	evidence_source VARCHAR(24),
	review_timezone VARCHAR(64),
	next_action VARCHAR(240),
	reason VARCHAR(500),
	version BIGINT DEFAULT '1' NOT NULL,
	evidence_observed_at TIMESTAMP WITH TIME ZONE,
	evidence_recorded_at TIMESTAMP WITH TIME ZONE,
	review_due_at TIMESTAMP WITH TIME ZONE,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	archived_at TIMESTAMP WITH TIME ZONE,
	CONSTRAINT pk_email_registry_entries PRIMARY KEY (id),
	CONSTRAINT uq_email_registry_entries_workspace_id_address_index UNIQUE (workspace_id, address_index),
	CONSTRAINT ck_email_registry_entries_ciphertext_length CHECK (length(address_ciphertext) <= 2048),
	CONSTRAINT ck_email_registry_entries_index_length CHECK (length(address_index) = 32),
	CONSTRAINT ck_email_registry_entries_evidence_source CHECK (evidence_source IS NULL OR evidence_source = 'manual_attestation'),
	CONSTRAINT ck_email_registry_entries_gmail_kind CHECK (provider != 'gmail' OR account_kind = 'personal'),
	CONSTRAINT ck_email_registry_entries_positive_version CHECK (version > 0),
	CONSTRAINT ck_email_registry_entries_positive_index_version CHECK (index_key_version > 0),
	CONSTRAINT ck_email_registry_entries_provider CHECK (provider IN ('gmail','microsoft')),
	CONSTRAINT ck_email_registry_entries_kind CHECK (account_kind IN ('personal','managed','unknown')),
	CONSTRAINT ck_email_registry_entries_state CHECK (state IN ('unknown','pending','recorded','blocked')),
	CONSTRAINT ck_email_registry_entries_due_pair CHECK ((review_due_at IS NULL) = (review_timezone IS NULL)),
	CONSTRAINT fk_email_registry_entries_workspace_id_workspaces FOREIGN KEY(workspace_id) REFERENCES workspaces (id) ON DELETE RESTRICT,
	CONSTRAINT fk_email_registry_entries_responsible_member_id_workspa_6036 FOREIGN KEY(responsible_member_id) REFERENCES workspace_members (id) ON DELETE RESTRICT,
	CONSTRAINT fk_email_registry_entries_evidence_recorded_by_users FOREIGN KEY(evidence_recorded_by) REFERENCES users (id) ON DELETE RESTRICT,
	CONSTRAINT fk_email_registry_entries_created_by_users FOREIGN KEY(created_by) REFERENCES users (id) ON DELETE RESTRICT,
	CONSTRAINT fk_email_registry_entries_updated_by_users FOREIGN KEY(updated_by) REFERENCES users (id) ON DELETE RESTRICT,
	CONSTRAINT fk_email_registry_entries_archived_by_users FOREIGN KEY(archived_by) REFERENCES users (id) ON DELETE RESTRICT
)

""")


def downgrade():
    # Domain data/history must survive application rollback. No automatic hard delete.
    raise RuntimeError("P1 schema is retained; use reviewed operational recovery.")
