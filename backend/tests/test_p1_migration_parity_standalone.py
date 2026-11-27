"""Offline PostgreSQL DDL parity; no engine, database or destructive fixtures.

Run with --noconftest. This is not a PostgreSQL migration rehearsal.
"""
import re
from importlib.util import module_from_spec, spec_from_file_location
from io import StringIO
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateColumn, CreateTable

from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.models.alerts import AlertPolicy
from app.models.email_registry import EmailRegistryEntry

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"


def revision(name):
    spec = spec_from_file_location(name, VERSIONS / f"{name}.py")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def rendered_upgrade(module):
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output}
    )
    with Operations.context(context):
        module.upgrade()
    return output.getvalue()


def canonical(sql):
    # Ignore formatting only, not case, values or clause order.
    return re.sub(r"\s+", "", sql).rstrip(";")


def test_registry_actual_upgrade_matches_postgres_model_ddl():
    module = revision("0027_p1_email_registry")
    assert module.down_revision == "0026_v52_security_and_verification"
    actual = rendered_upgrade(module)
    expected = str(CreateTable(EmailRegistryEntry.__table__).compile(dialect=postgresql.dialect()))
    assert canonical(actual) == canonical(expected)
    assert "DROP " not in actual.upper()
    assert "INSERT " not in actual.upper()


def test_reminder_actual_upgrade_matches_model_column():
    module = revision("0028_email_registry_reminders")
    assert module.down_revision == "0027_p1_email_registry"
    column = AlertPolicy.__table__.c.email_registry_in_app_reminders_enabled
    assert isinstance(column.type, sa.Boolean)
    assert column.nullable is False
    expected_column = str(CreateColumn(column).compile(dialect=postgresql.dialect()))
    expected = "ALTER TABLE alert_policies ADD COLUMN " + expected_column
    assert canonical(rendered_upgrade(module)) == canonical(expected)


def test_registry_downgrade_refuses_data_loss():
    module = revision("0027_p1_email_registry")
    with pytest.raises(RuntimeError, match="retained"):
        module.downgrade()


def test_reminder_downgrade_cannot_silently_move_revision_without_schema_change():
    module = revision("0028_email_registry_reminders")
    # A no-op downgrade falsely labels the DB as the previous schema. The retained
    # column must instead require deliberate operational recovery, as registry does.
    with pytest.raises(RuntimeError, match="retained"):
        module.downgrade()
