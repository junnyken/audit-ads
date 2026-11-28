"""Run the actual O4 inventory assertion over model metadata, without connecting a DB.
Migration/physical-schema parity remains a PostgreSQL CI responsibility.
"""
from types import SimpleNamespace

import pytest

from app.models.entities import AuditLog
from tests import test_o4_migration as inventory


@pytest.mark.parametrize('extra', [None, ('users', 'access_token'), ('users', 'unknown_token_hash')])
def test_actual_o4_inventory_accepts_documented_metadata_only(monkeypatch, extra):
    tables = AuditLog.metadata.tables

    def columns(table):
        result = [{'name': c.name, 'nullable': c.nullable} for c in tables[table].columns]
        if extra and extra[0] == table:
            result.append({'name': extra[1], 'nullable': True})
        return result

    inspector = SimpleNamespace(get_table_names=lambda: list(tables), get_columns=columns)
    head = inventory.ScriptDirectory.from_config(inventory._config()).get_current_head()
    monkeypatch.setattr(inventory, '_revision', lambda: head)
    monkeypatch.setattr(inventory.sa, 'inspect', lambda engine: inspector)
    if extra:
        with pytest.raises(AssertionError, match=extra[1]):
            inventory.test_head_includes_0019_and_only_one_column_carries_a_credential(None)
    else:
        inventory.test_head_includes_0019_and_only_one_column_carries_a_credential(None)
