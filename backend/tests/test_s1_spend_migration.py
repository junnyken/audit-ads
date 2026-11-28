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
TABLE = "ad_account_spend_observations"


def _config() -> Config:
    config = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))
    return config


def _tables() -> set[str]:
    return set(sa.inspect(engine).get_table_names())


def _revision() -> str:
    with engine.connect() as connection:
        return connection.execute(sa.text("SELECT version_num FROM alembic_version")).scalar_one()


def _head() -> str:
    """O3 added `0017` on top, so "at head" is read from the scripts rather than pinned here."""
    return ScriptDirectory.from_config(_config()).get_current_head()


def test_0016_is_applied_and_the_table_has_the_planned_shape(migrated_database):
    assert _revision() == _head()
    assert ScriptDirectory.from_config(_config()).get_revision("0016_s1_spend_observations") is not None
    columns = {column["name"] for column in sa.inspect(engine).get_columns(TABLE)}
    assert {
        "workspace_id", "ad_account_id", "meta_connection_id", "reader_source", "observed_at",
        "status", "failure_code", "observed_currency", "observed_timezone_name",
        "observed_account_status", "observed_disable_reason", "amount_spent_raw", "spend_cap_raw",
        "balance_raw", "daily_json", "window_since", "window_until", "archived_at",
    } <= columns
    # Rule 1 / 40: no column could ever carry a credential or payment details.
    assert not any(word in name for name in columns for word in ("token", "secret", "funding", "password"))
    indexes = {index["name"] for index in sa.inspect(engine).get_indexes(TABLE)}
    assert {"ix_spend_obs_ws_account_observed", "ix_spend_obs_ws_status_observed"} <= indexes


def test_refused_downgrade_preserves_spend_schema_and_head(migrated_database):
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


@pytest.mark.parametrize("revision,message", [
    ("0027_p1_email_registry", "P1 schema is retained"),
    ("0028_email_registry_reminders", "Reminder schema is retained"),
])
def test_additive_registry_migrations_refuse_automatic_downgrade(revision, message):
    script = ScriptDirectory.from_config(_config()).get_revision(revision)
    with pytest.raises(RuntimeError, match=message):
        script.module.downgrade()
