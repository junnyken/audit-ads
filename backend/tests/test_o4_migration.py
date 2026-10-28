"""O4 — migration `0018_o4_reader_credentials`: down to 0017 and back up on the **test** database
the session fixture just built from an empty schema (itself the clean-database upgrade check)."""
from __future__ import annotations

import os

import sqlalchemy as sa

from alembic import command
from alembic.config import Config
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
    assert _revision() in ("0019_f1_facebook_identities", "0020_f3_business_users")
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
    }
    assert set(carrying) - allowed == set(), carrying


def test_downgrade_removes_the_table_and_column_and_upgrade_restores_them(migrated_database):
    tables_before = set(sa.inspect(engine).get_table_names())
    try:
        command.downgrade(_config(), "0017_o3_conn_automation")
        assert _revision() == "0017_o3_conn_automation"
        inspector = sa.inspect(engine)
        assert {"meta_reader_credentials", "personal_account_business_links"} <= (tables_before - set(inspector.get_table_names()))
        assert "reader_credential_id" not in {c["name"] for c in inspector.get_columns("meta_connections")}
    finally:
        command.upgrade(_config(), "head")
    assert set(sa.inspect(engine).get_table_names()) == tables_before
    assert _revision() in ("0019_f1_facebook_identities", "0020_f3_business_users")
