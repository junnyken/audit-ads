"""Run with --noconftest; no application or database configuration is imported."""

import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic.migration import MigrationContext
from alembic.operations import Operations

SPEC = importlib.util.spec_from_file_location(
    "migration0025",
    Path(__file__).parents[1] / "alembic/versions/0025_commercial_saas_license.py",
)
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


def base(connection):
    metadata = sa.MetaData()
    for name in ("workspaces", "community_invite_codes", "device_sessions", "users"):
        sa.Table(name, metadata, sa.Column("id", sa.Uuid(), primary_key=True))
    metadata.create_all(connection)


@pytest.fixture
def db(monkeypatch):
    with sa.create_engine("sqlite:///:memory:").begin() as connection:
        base(connection)
        monkeypatch.setattr(m, "op", Operations(MigrationContext.configure(connection)))
        yield connection


@pytest.mark.parametrize("existing", [False, True])
def test_clean_and_partial_then_noop(db, existing):
    if existing:
        m.op.add_column("workspaces", sa.Column("plan_expires_at", sa.DateTime(timezone=True)))
    m.upgrade()
    assert m._preflight(db, sa.inspect(db), "main") == []
    statements = []
    sa.event.listen(db, "before_cursor_execute", lambda c, cur, sql, *args: statements.append(sql))
    m.upgrade()
    assert not any(
        s.lstrip().upper().startswith(("CREATE", "ALTER", "INSERT", "UPDATE", "DELETE")) for s in statements
    )


def test_missing_index(db):
    m.upgrade()
    m.op.drop_index("ix_password_reset_tokens_user_id", table_name="password_reset_tokens")
    assert m._preflight(db, sa.inspect(db), "main") == [
        (
            "index",
            "ix_password_reset_tokens_user_id",
            "password_reset_tokens",
            "user_id",
        )
    ]
    m.upgrade()


@pytest.mark.parametrize("kind", ["column", "partial_table", "index_conflict"])
def test_reject_before_first_write(db, kind):
    if kind == "column":
        m.op.add_column("workspaces", sa.Column("max_desktop_devices", sa.BigInteger()))
    elif kind == "partial_table":
        sa.Table("password_reset_tokens", sa.MetaData(), sa.Column("id", sa.Integer())).create(db)
    else:
        m.op.create_index("ix_password_reset_tokens_user_id", "users", ["id"])
    statements = []
    sa.event.listen(db, "before_cursor_execute", lambda c, cur, sql, *args: statements.append(sql))
    with pytest.raises(RuntimeError, match="0025 reconciliation"):
        m.upgrade()
    assert not any(s.lstrip().upper().startswith(("CREATE", "ALTER")) for s in statements)


@pytest.mark.parametrize(
    "typ,expected,valid",
    [
        (pg.TIMESTAMP(timezone=True), sa.DateTime(timezone=True), True),
        (pg.TIMESTAMP(timezone=False), sa.DateTime(timezone=True), False),
        (pg.INTEGER(), sa.Integer(), True),
        (pg.BIGINT(), sa.Integer(), False),
        (pg.SMALLINT(), sa.Integer(), False),
        (pg.VARCHAR(64), sa.String(64), True),
        (pg.TEXT(), sa.String(64), False),
        (pg.VARCHAR(63), sa.String(64), False),
        (pg.UUID(), sa.Uuid(), True),
        (pg.CHAR(32), sa.Uuid(), False),
    ],
)
def test_pg_types(typ, expected, valid):
    actual = {"type": typ, "nullable": True, "default": None}
    column = sa.Column("sample", expected)
    if valid:
        m._check_column("sample", actual, column, True)
    else:
        with pytest.raises(RuntimeError, match="sample.sample.type incompatible"):
            m._check_column("sample", actual, column, True)


@pytest.mark.parametrize(
    "default,valid",
    [
        ("'web'", True),
        ("'web'::character varying", True),
        ("'web'::text", True),
        ("web", False),
        ("'WEB'", False),
        ("lower('WEB')", False),
        (None, False),
    ],
)
def test_default_whitelist(default, valid):
    assert m._default_matches(default, m._columns()["device_sessions"][0]) is valid


def test_offline_rejected(monkeypatch):
    monkeypatch.setattr(m, "op", SimpleNamespace(get_context=lambda: SimpleNamespace(as_sql=True)))
    with pytest.raises(RuntimeError, match="offline mode unsupported"):
        m.upgrade()


def test_catalog_ambiguity():
    connection = Mock()
    connection.execute.return_value.mappings.return_value.all.return_value = [
        {"relname": "workspaces", "nspname": "other"}
    ]
    with pytest.raises(RuntimeError, match="workspaces.schema incompatible"):
        m._catalog(connection, "public", ["workspaces"])


@pytest.mark.parametrize("property_name", ["nullable", "default", "computed", "identity"])
def test_column_properties(property_name):
    actual = {"type": pg.INTEGER(), "nullable": True, "default": None}
    actual[property_name] = False if property_name == "nullable" else "unexpected"
    with pytest.raises(RuntimeError, match="incompatible"):
        m._check_column("workspaces", actual, sa.Column("max_desktop_devices", sa.Integer()), True)


@pytest.mark.parametrize("fault", ["primary_key", "unique", "foreign_key", "index"])
def test_fake_metadata_rejects_before_write(db, monkeypatch, fault):
    m.upgrade()
    inspector = sa.inspect(db)
    if fault == "primary_key":
        monkeypatch.setattr(
            inspector,
            "get_pk_constraint",
            lambda *a, **k: {"constrained_columns": ["user_id"]},
        )
    elif fault == "unique":
        monkeypatch.setattr(
            inspector,
            "get_unique_constraints",
            lambda *a, **k: [{"name": "wrong", "column_names": ["user_id"]}],
        )
    elif fault == "foreign_key":
        monkeypatch.setattr(inspector, "get_foreign_keys", lambda *a, **k: [])
    else:
        original = inspector.get_indexes

        def indexes(table, **kwargs):
            result = original(table, **kwargs)
            for idx in result:
                idx["unique"] = True
            return result

        monkeypatch.setattr(inspector, "get_indexes", indexes)
    writes = Mock()
    monkeypatch.setattr(m.op, "add_column", writes)
    monkeypatch.setattr(m.op, "create_table", writes)
    monkeypatch.setattr(m.op, "create_index", writes)
    original_inspect = sa.inspect
    monkeypatch.setattr(m.sa, "inspect", lambda connection: inspector)
    with pytest.raises(RuntimeError, match="incompatible"):
        m.upgrade()
    writes.assert_not_called()
    monkeypatch.setattr(m.sa, "inspect", original_inspect)


@pytest.mark.parametrize(
    "fault",
    [
        "indisvalid",
        "indisready",
        "indislive",
        "plain_predicate",
        "plain_expression",
        "no_include",
        "amname",
        "table_name",
        "relkind",
    ],
)
def test_pg_catalog_index_state(db, monkeypatch, fault):
    m.upgrade()
    inspector = sa.inspect(db)
    connection = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"), execute=Mock())
    connection.execute.return_value.mappings.return_value.all.return_value = [{"condeferrable": False, "condeferred": False}]
    row = {
        "relkind": "i",
        "table_name": "device_sessions",
        "amname": "btree",
        "indisvalid": True,
        "indisready": True,
        "indislive": True,
        "plain_predicate": True,
        "plain_expression": True,
        "no_include": True,
    }
    row[fault] = "wrong" if fault in {"amname", "table_name", "relkind"} else False
    monkeypatch.setattr(m, "_catalog", lambda *a: {"ix_device_sessions_installation_hash": row})
    # Columns are separately covered using real PostgreSQL dialect types above.
    monkeypatch.setattr(m, "_check_column", lambda *a: None)
    with pytest.raises(RuntimeError, match="ix_device_sessions_installation_hash.catalog incompatible"):
        m._preflight(connection, inspector, "main")


def test_equivalent_unique_name_is_accepted_without_ddl(db, monkeypatch):
    m.upgrade()
    inspector = sa.inspect(db)
    original = inspector.get_unique_constraints
    def renamed(table, **kwargs):
        result = original(table, **kwargs)
        result[0]["name"] = "legacy_generated_name"
        return result
    monkeypatch.setattr(inspector, "get_unique_constraints", renamed)
    assert m._preflight(db, inspector, "main") == []


@pytest.mark.parametrize("length,changed", [(32, True), (64, True), (128, False), (None, False)])
def test_pg_version_capacity_widens_only_small_varchar(monkeypatch, length, changed):
    connection = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))
    inspector = Mock()
    inspector.get_columns.return_value = [{"name": "version_num", "type": pg.VARCHAR(length), "nullable": False}]
    alter = Mock()
    monkeypatch.setattr(m.op, "alter_column", alter)
    m._ensure_version_capacity(connection, inspector, "public")
    assert alter.called is changed
    if changed:
        assert alter.call_args.kwargs["type_"].length == 128
        assert alter.call_args.args == ("alembic_version", "version_num")


def test_pg_version_capacity_rejects_unexpected_definition(monkeypatch):
    connection = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))
    inspector = Mock()
    inspector.get_columns.return_value = [{"name": "version_num", "type": pg.INTEGER(), "nullable": False}]
    alter = Mock()
    monkeypatch.setattr(m.op, "alter_column", alter)
    with pytest.raises(RuntimeError, match="definition incompatible"):
        m._ensure_version_capacity(connection, inspector, "public")
    alter.assert_not_called()
