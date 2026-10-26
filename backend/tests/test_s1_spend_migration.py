"""S1 — migration `0016_s1_spend_observations`: down to 0015 and back up to head, on the test
database the session fixture just built from an empty schema (which is itself the clean-database
upgrade check)."""
from __future__ import annotations

import os

import sqlalchemy as sa

from alembic import command
from alembic.config import Config
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


def test_head_is_0016_and_the_table_has_the_planned_shape(migrated_database):
    assert _revision() == "0016_s1_spend_observations"
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


def test_downgrade_removes_only_the_new_table_and_upgrade_restores_it(migrated_database):
    before = _tables()
    try:
        command.downgrade(_config(), "0015_a10_3_conn_bm")
        after_down = _tables()
        assert TABLE not in after_down
        assert before - after_down == {TABLE}
        assert _revision() == "0015_a10_3_conn_bm"
    finally:
        command.upgrade(_config(), "head")
    assert _tables() == before
    assert _revision() == "0016_s1_spend_observations"
