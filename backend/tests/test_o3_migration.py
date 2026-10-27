"""O3 — migration `0017_o3_conn_automation`: down to 0016 and back up, on the **test** database
the session fixture just built from an empty schema (itself the clean-database upgrade check).
Never run against the dev database."""
from __future__ import annotations

import os

import sqlalchemy as sa

from alembic import command
from alembic.config import Config
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
    assert _revision() in ("0017_o3_conn_automation", "0018_o4_reader_credentials")
    columns = _columns()
    assert set(columns) >= COLUMNS
    assert columns["auto_discovery_enabled"]["nullable"] is False
    assert columns["auto_import_enabled"]["nullable"] is False
    assert "false" in str(columns["auto_discovery_enabled"]["default"]).lower()
    assert "false" in str(columns["auto_import_enabled"]["default"]).lower()
    # Rule 1 / 40: no column could ever carry a credential.
    assert not any(word in name for name in columns for word in ("token", "secret", "password"))


def test_downgrade_removes_only_the_four_columns_and_upgrade_restores_them(migrated_database):
    try:
        # Step below O4 first, so this test still measures exactly what 0017 adds.
        command.downgrade(_config(), "0017_o3_conn_automation")
        tables_before = set(sa.inspect(engine).get_table_names())
        columns_before = set(_columns())
        command.downgrade(_config(), "0016_s1_spend_observations")
        assert _revision() == "0016_s1_spend_observations"
        assert columns_before - set(_columns()) == COLUMNS
        assert set(sa.inspect(engine).get_table_names()) == tables_before
        command.upgrade(_config(), "0017_o3_conn_automation")
        assert set(_columns()) == columns_before
        assert _revision() == "0017_o3_conn_automation"
    finally:
        command.upgrade(_config(), "head")


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
