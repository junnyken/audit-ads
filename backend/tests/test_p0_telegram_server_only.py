"""Offline regression: server-only Telegram credentials and immutable legacy audits."""
import uuid
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.api.v1.routers import automation_ops as router
from app.core.errors import ValidationError
from app.models.entities import AuditLog, Workspace
from app.services import telegram_bot_helper as helper
from app.services.audit import AuditLogService


@pytest.fixture(autouse=True)
def no_http(monkeypatch):
    monkeypatch.setattr(helper.urllib.request, 'urlopen', Mock(side_effect=AssertionError('HTTP forbidden')))
    monkeypatch.setattr(router.TelegramTransport, 'send', Mock(side_effect=AssertionError('send forbidden')))


@pytest.mark.parametrize('endpoint', [router.save_telegram_bot_settings, router.detect_telegram_chats, router.send_telegram_test_message])
@pytest.mark.parametrize('field', ['bot_token', 'clear_bot_token', 'telegram_bot_envelope', 'telegram_bot_token', 'token'])
@pytest.mark.parametrize('value', ['', None, 'synthetic-secret'])
def test_reject_before_any_side_effect(endpoint, field, value, monkeypatch):
    monkeypatch.setattr(router, 'get_settings', Mock(side_effect=AssertionError('settings touched')))
    endpoint_ctx = Mock()
    with pytest.raises(ValidationError) as exc:
        endpoint(endpoint_ctx, {field: value})
    assert 'synthetic-secret' not in str(exc.value)
    assert not endpoint_ctx.mock_calls


@pytest.mark.parametrize('configured', [True, False])
def test_server_resolver_never_reads_database(configured):
    settings = SimpleNamespace(telegram_transport_configured=configured, telegram_bot_token='server-only')
    db = Mock()
    assert helper.resolve_workspace_bot_token(db, uuid.uuid4(), settings) == ('server-only' if configured else None)
    assert not db.mock_calls


def test_legacy_audit_preserved_without_copying_credentials():
    engine = sa.create_engine('sqlite+pysqlite:///:memory:')
    AuditLog.metadata.create_all(engine)
    settings = SimpleNamespace(telegram_transport_configured=False)
    with Session(engine) as db:
        ws = Workspace(name='Synthetic Telegram', slug='telegram-test')
        db.add(ws)
        db.flush()
        audit = AuditLogService(db, ws.id, None)
        audit.record(action='workspace_telegram_config.updated', entity_type='workspace_telegram_config', entity_id=str(ws.id), metadata={'telegram_bot_envelope': 'legacy-envelope', 'telegram_bot_mask': 'legacy-mask', 'chat_id': '-100123', 'notify_billing_failed': False})
        db.flush()
        legacy = db.scalars(sa.select(AuditLog)).one()
        original = dict(legacy.metadata_json)
        result = helper.save_workspace_telegram_config(db, ws.id, audit, settings, enabled=False)
        db.flush()
        rows = db.scalars(sa.select(AuditLog)).all()
        fresh = [row for row in rows if row.id != legacy.id and row.action == 'workspace_telegram_config.updated']
        assert len(fresh) == 1
        assert legacy.metadata_json == original
        assert 'telegram_bot_envelope' not in fresh[0].metadata_json
        assert 'telegram_bot_mask' not in fresh[0].metadata_json
        assert fresh[0].metadata_json['chat_id'] == '-100123'
        assert fresh[0].metadata_json['notify_billing_failed'] is False
        assert result['bot_configured'] is False
        assert result['bot_source'] == 'none'
        assert result['bot_mask'] == ''
        assert 'legacy-' not in str(result)
    engine.dispose()


def test_helper_rejects_token_before_database():
    db = Mock()
    with pytest.raises(ValidationError):
        helper.save_workspace_telegram_config(db, uuid.uuid4(), Mock(), Mock(), bot_token='synthetic-secret')
    assert not db.mock_calls


def test_workspace_transport_uses_server_token_and_respects_enabled(monkeypatch):
    monkeypatch.setattr(helper, 'get_workspace_telegram_record', lambda *args: {'enabled': True})
    transport = Mock()
    monkeypatch.setattr(helper, 'TelegramTransport', transport)
    settings = SimpleNamespace(notification_transport='telegram', telegram_transport_configured=True, telegram_bot_token='server-only')
    helper.resolve_workspace_telegram_transport(Mock(), uuid.uuid4(), settings)
    assert transport.call_args.kwargs['bot_token'] == 'server-only'
    transport.reset_mock()
    monkeypatch.setattr(helper, 'get_workspace_telegram_record', lambda *args: {'enabled': False})
    assert helper.resolve_workspace_telegram_transport(Mock(), uuid.uuid4(), settings) is None
    transport.assert_not_called()
