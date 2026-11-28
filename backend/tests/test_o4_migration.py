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


def _config() -> Config:
    config = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))
    return config


def _revision() -> str:
    with engine.connect() as connection:
        return connection.execute(sa.text("SELECT version_num FROM alembic_version")).scalar_one()


def test_the_test_database_is_not_the_dev_database():
    assert engine.url.database == "adsops_test"


def test_head_includes_0019_and_only_one_column_carries_a_credential(migrated_database):
    assert _revision() == ScriptDirectory.from_config(_config()).get_current_head()
    inspector = sa.inspect(engine)
    columns = {c["name"]: c for c in inspector.get_columns("meta_reader_credentials")}
    assert columns["encrypted_secret"]["nullable"] is True
    connection_columns = {c["name"]: c for c in inspector.get_columns("meta_connections")}
    assert connection_columns["reader_credential_id"]["nullable"] is True
    # Rule 1's single exception: across the whole schema, the only column holding a usable credential is
    # `encrypted_secret`, and it holds ciphertext; the others are hashes or timestamps.
    carrying = [
        f"{table}.{column['name']}"
        for table in inspector.get_table_names()
        for column in inspector.get_columns(table)
        if any(word in column["name"] for word in ("secret", "token", "password"))
    ]
    allowed = {
        "meta_reader_credentials.encrypted_secret",
        "meta_reader_credentials.secret_last_rotated_at",
        # Hashes and a last-four hint, never the value (A1 / A9).
        "users.password_hash",
        "workspace_invitations.token_hash",
        "workspace_invitations.token_last_four",
        "password_reset_tokens.token_hash",
    }
    assert set(carrying) - allowed == set(), carrying


def test_refused_downgrade_preserves_o4_schema_and_head(migrated_database):
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
