"""Add opt-in in-app registry attention; retain column on rollback."""

import sqlalchemy as sa

from alembic import op

revision = "0028_email_registry_reminders"
down_revision = "0027_p1_email_registry"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "alert_policies",
        sa.Column(
            "email_registry_in_app_reminders_enabled", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )


def downgrade():
    # Keep schema and revision aligned; application rollback does not downgrade DB.
    raise RuntimeError("Reminder schema is retained; use reviewed operational recovery.")
