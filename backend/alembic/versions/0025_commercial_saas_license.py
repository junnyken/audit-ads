"""Commercial SaaS Password Reset, License Expiry & Desktop Device Channel (v4.4.0).

Revision ID: 0025_commercial_saas_license
Revises: 0024_team_playbooks
Create Date: 2026-11-23 11:15:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0025_commercial_saas_license"
down_revision = "0024_team_playbooks"
branch_labels = None
depends_on = None


def _fail(obj: str, prop: str) -> None:
    raise RuntimeError(f"0025 reconciliation: {obj}.{prop} incompatible")


def _columns() -> dict[str, list[sa.Column]]:
    return {
        "workspaces": [
            sa.Column("plan_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("max_desktop_devices", sa.Integer(), nullable=True),
        ],
        "community_invite_codes": [sa.Column("duration_days", sa.Integer(), nullable=True)],
        "device_sessions": [
            sa.Column("client_channel", sa.String(20), nullable=False, server_default="web"),
            sa.Column("installation_hash", sa.String(64), nullable=True),
        ],
        "password_reset_tokens": [
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("token_hash", sa.String(64), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("requested_ip_hash", sa.String(64), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        ],
    }


_INDEXES = {
    "ix_device_sessions_installation_hash": ("device_sessions", "installation_hash"),
    "ix_password_reset_tokens_user_id": ("password_reset_tokens", "user_id"),
}
_TOKEN = "password_reset_tokens"


def _default_matches(actual: str | None, column: sa.Column) -> bool:
    if column.server_default is None:
        return actual is None
    if actual is None:
        return False
    value = actual.strip()
    if column.name == "client_channel":
        return value in {"'web'", "'web'::character varying", "'web'::text"}
    return value.lower() in {"now()", "current_timestamp"}


def _check_column(table: str, actual: dict, expected: sa.Column, pg: bool) -> None:
    obj = f"{table}.{expected.name}"
    typ, want = actual["type"], expected.type
    if isinstance(want, sa.Uuid):
        valid = isinstance(typ, sa.Uuid) if pg else isinstance(typ, sa.CHAR) and typ.length == 32
    elif isinstance(want, sa.DateTime):
        valid = isinstance(typ, sa.DateTime) and (not pg or typ.timezone is True)
    elif isinstance(want, sa.Integer):
        valid = type(typ) in (sa.Integer, sa.INTEGER)
    else:
        valid = isinstance(typ, sa.VARCHAR) and typ.length == want.length
    if not valid:
        _fail(obj, "type")
    if actual["nullable"] != expected.nullable:
        _fail(obj, "nullable")
    if not _default_matches(actual.get("default"), expected):
        _fail(obj, "default")
    if actual.get("computed") or actual.get("identity"):
        _fail(obj, "generated")


def _catalog(connection, schema: str, names: list[str]) -> dict:
    # Bound parameters only: identifiers are catalog values, never SQL fragments.
    rows = (
        connection.execute(
            sa.text("""
        SELECT c.relname, c.relkind, n.nspname,
               i.indisvalid, i.indisready, i.indislive,
               i.indpred IS NULL AS plain_predicate,
               i.indexprs IS NULL AS plain_expression,
               i.indnkeyatts = i.indnatts AS no_include,
               am.amname, t.relname AS table_name
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_catalog.pg_index i ON i.indexrelid = c.oid
        LEFT JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
        LEFT JOIN pg_catalog.pg_am am ON am.oid = c.relam
        WHERE c.relname IN :names
          AND (n.nspname = :schema OR n.nspname = ANY(current_schemas(false)))
    """).bindparams(sa.bindparam("names", expanding=True)),
            {"names": names, "schema": schema},
        )
        .mappings()
        .all()
    )
    result = {}
    for row in rows:
        name = row["relname"]
        if name in result or row["nspname"] != schema:
            _fail(name, "schema")
        result[name] = row
    return result


def _preflight(connection, inspector, schema: str, require_complete: bool = False) -> list[tuple]:
    specs = _columns()
    pg = connection.dialect.name == "postgresql"
    catalog = _catalog(connection, schema, [*specs, *_INDEXES, "uq_password_reset_tokens_hash"]) if pg else {}
    tables = set(inspector.get_table_names(schema=schema))
    views = set(inspector.get_view_names(schema=schema))
    planned = []
    unique_name = None
    for table, columns in specs.items():
        if table in views or (pg and table in catalog and catalog[table]["relkind"] != "r"):
            _fail(table, "relation")
        if table not in tables:
            if table != _TOKEN or require_complete:
                _fail(table, "missing")
            planned.append(("table", table))
            continue
        actual = {c["name"]: c for c in inspector.get_columns(table, schema=schema)}
        if table == _TOKEN and set(actual) != {c.name for c in columns}:
            _fail(table, "columns")
        for column in columns:
            if column.name in actual:
                _check_column(table, actual[column.name], column, pg)
            elif require_complete:
                _fail(f"{table}.{column.name}", "missing")
            else:
                planned.append(("column", table, column))
        if table == _TOKEN:
            if inspector.get_pk_constraint(table, schema=schema).get("constrained_columns") != ["id"]:
                _fail(table, "primary_key")
            unique = inspector.get_unique_constraints(table, schema=schema)
            if len(unique) != 1 or unique[0].get("column_names") != ["token_hash"]:
                _fail(table, "unique_columns")
            unique_name = unique[0].get("name")
            if pg:
                if not unique_name:
                    _fail(table, "unique_identity")
                # Names are catalog values bound as parameters, never SQL identifiers.
                catalog.update(_catalog(connection, schema, [unique_name]))
                flags = connection.execute(sa.text(
                    "SELECT condeferrable, condeferred FROM pg_catalog.pg_constraint "
                    "WHERE conrelid = to_regclass(:relation) AND conname = :name AND contype = 'u'"
                ), {"relation": f'"{schema}"."{_TOKEN}"', "name": unique_name}).mappings().all()
                if len(flags) != 1 or flags[0]["condeferrable"] or flags[0]["condeferred"]:
                    _fail(table, "unique_timing")
            fks = inspector.get_foreign_keys(table, schema=schema)
            if len(fks) != 1:
                _fail(table, "foreign_key")
            fk = fks[0]
            if (
                fk.get("constrained_columns") != ["user_id"]
                or fk.get("referred_table") != "users"
                or fk.get("referred_columns") != ["id"]
                or fk.get("referred_schema") not in (None, schema)
                or fk.get("options", {}).get("ondelete") != "CASCADE"
                or fk.get("options", {}).get("deferrable")
                or fk.get("options", {}).get("onupdate") not in (None, "NO ACTION")
            ):
                _fail(table, "foreign_key")
    for name, (table, column) in _INDEXES.items():
        indexes = inspector.get_indexes(table, schema=schema) if table in tables else []
        matches = [idx for idx in indexes if idx["name"] == name]
        row = catalog.get(name)
        if pg and row is not None:
            if (
                row["relkind"] != "i"
                or row["table_name"] != table
                or not all(
                    row[k]
                    for k in (
                        "indisvalid",
                        "indisready",
                        "indislive",
                        "plain_predicate",
                        "plain_expression",
                        "no_include",
                    )
                )
                or row["amname"] != "btree"
            ):
                _fail(name, "catalog")
            if not matches:
                _fail(name, "reflection")
        if matches:
            idx = matches[0]
            if (
                idx.get("column_names") != [column]
                or idx.get("unique")
                or idx.get("expressions") not in (None, [column])
                or any(idx.get("dialect_options", {}).values())
                or idx.get("column_sorting")
            ):
                _fail(name, "definition")
        elif require_complete:
            _fail(name, "missing")
        else:
            # SQLite also has a schema-wide namespace for index names.
            if not pg:
                for other in tables - {table}:
                    if any(i["name"] == name for i in inspector.get_indexes(other, schema=schema)):
                        _fail(name, "relation")
                if name in tables or name in views:
                    _fail(name, "relation")
            planned.append(("index", name, table, column))
    unique_row = catalog.get(unique_name) if unique_name else None
    if pg and unique_name and unique_row is None:
        _fail(_TOKEN, "unique_backing_index")
    if unique_row is not None and (
        unique_row["relkind"] != "i"
        or unique_row["table_name"] != _TOKEN
        or not all(
            unique_row[k]
            for k in (
                "indisvalid",
                "indisready",
                "indislive",
                "plain_predicate",
                "plain_expression",
                "no_include",
            )
        )
        or unique_row["amname"] != "btree"
    ):
        _fail("uq_password_reset_tokens_hash", "catalog")
    return planned


def _ensure_version_capacity(connection, inspector, schema: str) -> None:
    """Alembic's default VARCHAR(32) cannot hold revision 0026 (34 chars)."""
    if connection.dialect.name != "postgresql":
        return
    columns = inspector.get_columns("alembic_version", schema=schema)
    if len(columns) != 1 or columns[0]["name"] != "version_num":
        _fail("alembic_version", "columns")
    column = columns[0]
    typ = column["type"]
    if not isinstance(typ, sa.VARCHAR) or column["nullable"] or column.get("computed") or column.get("identity"):
        _fail("alembic_version.version_num", "definition")
    if typ.length is not None and typ.length < 128:
        # Widen only migration bookkeeping, never truncate/stamp business data.
        op.alter_column("alembic_version", "version_num", schema=schema,
                        existing_type=typ, type_=sa.String(128), existing_nullable=False)


def upgrade() -> None:
    if op.get_context().as_sql:
        raise RuntimeError("0025 reconciliation: offline mode unsupported")
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    schema = inspector.default_schema_name
    planned = _preflight(connection, inspector, schema)
    _ensure_version_capacity(connection, inspector, schema)
    for action in planned:
        if action[0] == "column":
            op.add_column(action[1], action[2], schema=schema)
        elif action[0] == "table":
            op.create_table(
                _TOKEN,
                *_columns()[_TOKEN],
                sa.PrimaryKeyConstraint("id"),
                sa.UniqueConstraint("token_hash", name="uq_password_reset_tokens_hash"),
                sa.ForeignKeyConstraint(["user_id"], [f"{schema}.users.id"], ondelete="CASCADE"),
                schema=schema,
            )
        else:
            op.create_index(action[1], action[2], [action[3]], unique=False, schema=schema)
    _preflight(connection, sa.inspect(connection), schema, require_complete=True)


def downgrade() -> None:
    op.drop_index("ix_password_reset_tokens_user_id", table_name="password_reset_tokens")
    op.drop_table("password_reset_tokens")
    op.drop_index("ix_device_sessions_installation_hash", table_name="device_sessions")
    op.drop_column("device_sessions", "installation_hash")
    op.drop_column("device_sessions", "client_channel")
    op.drop_column("community_invite_codes", "duration_days")
    op.drop_column("workspaces", "max_desktop_devices")
    op.drop_column("workspaces", "plan_expires_at")
