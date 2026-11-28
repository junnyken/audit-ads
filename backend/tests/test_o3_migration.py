"""Legacy feature schema at actual Alembic head; additive registry rollback must retain it.
DB-backed checks run only on the CI test database, never the developer database.
"""
from __future__ import annotations

import os

import pytest
import sqlalchemy as sa

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from app.db.session import engine

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COLUMNS = {"auto_discovery_enabled", "auto_import_enabled", "automation_enabled_by", "automation_enabled_at"}


def _config() -> Config:
    config = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))
    return config


def _columns() -> dict[str, dict]:
    return {column["name"]: column for column in sa.inspect(engine).get_columns("meta_connections")}


def _revision() -> str:
    with engine.connect() as connection:
        return connection.execute(sa.text("SELECT version_num FROM alembic_version")).scalar_one()


def test_the_test_database_is_not_the_dev_database():
    assert engine.url.database == "adsops_test"


def test_head_includes_0017_with_four_columns_defaulting_off(migrated_database):
    # O4 put 0018 on top; 0017's columns are what this test is about.
    assert _revision() == ScriptDirectory.from_config(_config()).get_current_head()
    columns = _columns()
    assert set(columns) >= COLUMNS
    assert columns["auto_discovery_enabled"]["nullable"] is False
    assert columns["auto_import_enabled"]["nullable"] is False
    assert "false" in str(columns["auto_discovery_enabled"]["default"]).lower()
    assert "false" in str(columns["auto_import_enabled"]["default"]).lower()
    # Rule 1 / 40: no column could ever carry a credential.
    assert not any(word in name for name in columns for word in ("token", "secret", "password"))


def test_refused_downgrade_preserves_o3_schema_and_head(migrated_database):
    # 0027/0028 deliberately retain domain data during application rollback.
    tables_before = set(sa.inspect(engine).get_table_names())
    columns_before = {table: {c["name"] for c in sa.inspect(engine).get_columns(table)}
                      for table in tables_before}
    head = ScriptDirectory.from_config(_config()).get_current_head()
    assert _revision() == head
    with pytest.raises(RuntimeError, match="Reminder schema is retained"):
        command.downgrade(_config(), "0027_p1_email_registry")
    assert _revision() == head
    assert set(sa.inspect(engine).get_table_names()) == tables_before
    assert {table: {c["name"] for c in sa.inspect(engine).get_columns(table)}
            for table in tables_before} == columns_before


def test_an_existing_connection_keeps_meaning_manual_after_the_upgrade(migrated_database, db_session):
    """Rows written before 0017 come out with both switches off — server default, not backfill."""
    with engine.begin() as connection:
        workspace_id = connection.execute(
            sa.text(
                "INSERT INTO workspaces (id, name, slug, created_at, updated_at) "
                "VALUES (gen_random_uuid(), 'M', 'm-0017', now(), now()) RETURNING id"
            )
        ).scalar_one()
        connection.execute(
            sa.text(
                "INSERT INTO meta_connections (id, workspace_id, label, environment, status, notes, "
                "created_by, business_manager_reference, created_at, updated_at) VALUES "
                "(gen_random_uuid(), :ws, 'Old', 'PRODUCTION', 'UNKNOWN', '', gen_random_uuid(), '1', now(), now())"
            ),
            {"ws": workspace_id},
        )
        row = connection.execute(
            sa.text("SELECT auto_discovery_enabled, auto_import_enabled FROM meta_connections")
        ).one()
    assert tuple(row) == (False, False)
