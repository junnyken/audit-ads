"""Standalone contracts: dummy URL, no conftest, provider, network or DB connections."""
import ast
import inspect
import uuid
from contextlib import contextmanager, nullcontext
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace as NS
from unittest.mock import MagicMock, Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError as SchemaError

from app.api.deps import get_context
from app.api.v1.routers import automation_ops as routes
from app.core.enums import WorkspaceRole
from app.core.errors import ValidationError, install_exception_handlers
from app.services import automation_cron as cron


@pytest.fixture
def cycle(monkeypatch):
    from app.api.v1.routers import meta_operations

    session = Mock()
    session.get.return_value = None
    session.begin_nested.side_effect = lambda: nullcontext()
    audit = Mock()
    monkeypatch.setattr(cron, 'AuditLogService', Mock(return_value=audit))
    monkeypatch.setattr(cron, '_cron_lock', lambda session: nullcontext(True))
    monkeypatch.setattr(cron, '_rows', lambda *args: [])
    monkeypatch.setattr(meta_operations, '_collect_workspace_meta_transports', lambda *args: [Mock()])
    forbidden = Mock(side_effect=AssertionError('forbidden outbound action'))
    monkeypatch.setattr(meta_operations, 'run_workspace_quick_sync', forbidden)
    monkeypatch.setattr(meta_operations, '_sync_workspace_pages_from_meta', forbidden)
    return session, audit, meta_operations, forbidden


def run(session, **kwargs):
    return cron.run_workspace_automation_cycle(session, uuid.uuid4(), uuid.uuid4(), **kwargs)


def test_default_off_no_transport_or_actions(cycle, monkeypatch):
    session, audit, meta, forbidden = cycle
    collector = Mock(side_effect=AssertionError('not due'))
    monkeypatch.setattr(meta, '_collect_workspace_meta_transports', collector)
    result = run(session)
    assert result['sync_status'] == 'not_due'
    assert not result['sync_executed']
    audit.record.assert_not_called()
    collector.assert_not_called()
    forbidden.assert_not_called()


@pytest.mark.parametrize('statuses,expected', [
    (['succeeded', 'succeeded'], 'succeeded'),
    (['succeeded', 'error'], 'partial'),
    (['error', 'error'], 'error'),
    (['partial', 'succeeded'], 'partial'),
])
def test_actual_cycle_part_isolation(cycle, monkeypatch, statuses, expected):
    session, audit, _, forbidden = cycle
    def part(*args):
        status = statuses.pop(0)
        if status == 'error':
            raise RuntimeError('sensitive provider body must not be persisted')
        return {'status': status, 'read': 1, 'updated': 1}
    monkeypatch.setattr(cron, '_read_registry_part', part)
    result = run(session, force_sync=True)
    assert result['sync_status'] == expected
    assert session.begin_nested.call_count == 2
    assert result['auto_warmed_count'] == result['outbox_sent'] == result['telegram_ops_sent'] == 0
    session.rollback.assert_not_called()
    session.commit.assert_not_called()
    assert 'sensitive' not in str(audit.record.call_args)
    forbidden.assert_not_called()


@pytest.mark.parametrize('fails', [False, True])
def test_no_token_or_collection_exception(cycle, monkeypatch, fails):
    session, audit, meta, _ = cycle
    collector = Mock(side_effect=RuntimeError('secret')) if fails else Mock(return_value=[])
    monkeypatch.setattr(meta, '_collect_workspace_meta_transports', collector)
    result = run(session, force_sync=True)
    assert result['sync_status'] == ('error' if fails else 'skipped_no_token')
    assert result['parts'] == {}
    assert 'secret' not in str(audit.record.call_args)


def test_true_warmup_rejected_before_lock_or_db():
    session = Mock()
    with pytest.raises(ValidationError):
        run(session, force_warmup=True)
    assert session.mock_calls == []
    with pytest.raises(ValidationError):
        cron.save_workspace_cron_config(session, uuid.uuid4(), Mock(), auto_page_warmup_enabled=True)
    assert session.mock_calls == []


@pytest.mark.parametrize('payload', [
    {'sync_interval_minutes': 14}, {'sync_interval_minutes': 721},
    {'sync_interval_minutes': '60'}, {'sync_interval_minutes': True},
    {'auto_meta_sync_enabled': 'false'}, {'auto_meta_sync_enabled': 1},
    {'unknown': False}, {'access_token': 'not-allowed'},
])
def test_strict_config(payload):
    with pytest.raises((SchemaError, ValidationError)):
        routes.CronConfigPayload(**payload)


@pytest.mark.parametrize('payload', [{'warmup': True}, {'sync': 1}, {'sync': 'true'}, {'token': 'x'}])
def test_strict_run(payload):
    with pytest.raises((SchemaError, ValidationError)):
        routes.CronRunPayload(**payload)


def test_legacy_false_supported():
    assert routes.CronConfigPayload(auto_page_warmup_enabled=False).auto_page_warmup_enabled is False
    assert routes.CronRunPayload(warmup=False).warmup is False


def test_stored_choice_and_warmup_ignored(monkeypatch):
    row = NS(metadata_json={'auto_meta_sync_enabled': True, 'auto_page_warmup_enabled': True}, created_at=None)
    monkeypatch.setattr(cron, '_rows', lambda *args: [row])
    config = cron.get_workspace_cron_config(Mock(), uuid.uuid4())
    assert config['auto_meta_sync_enabled'] is True
    assert config['auto_page_warmup_enabled'] is False
    assert config['warmup_supported'] is False


def test_status_attempt_success_and_redaction(monkeypatch):
    now = datetime.now(UTC)
    good = {'sync_executed': True, 'sync_status': 'succeeded',
            'parts': {name: {'status': 'succeeded', 'read': 1, 'updated': 0} for name in ('pages', 'accounts')}}
    rows = [NS(created_at=now, metadata_json={'sync_executed': True, 'sync_status': 'skipped_no_token',
                                           'access_token': 'secret', 'error': 'raw provider body'}),
            NS(created_at=now-timedelta(hours=1), metadata_json=good)]
    monkeypatch.setattr(cron, '_rows', lambda *args: rows if args[2] == 'workspace_automation_run' else [])
    session = Mock()
    status = cron.get_workspace_cron_status(session, uuid.uuid4())
    assert status['last_attempt_at'] == now.isoformat()
    assert status['last_success_at'] == rows[1].created_at.isoformat()
    assert status['last_sync_at'] == status['last_success_at']
    assert 'secret' not in str(status) and 'raw provider' not in str(status)
    assert session.mock_calls == []
    assert cron._run_times([NS(created_at=now, metadata_json={'sync_executed': True, 'sync_status': 'ok:pages'})])[1] is None


def test_router_buyer_denied_before_actions(monkeypatch):
    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(routes.router)
    ctx = NS(membership=NS(role=WorkspaceRole.BUYER), session=Mock(), audit=Mock())
    app.dependency_overrides[get_context] = lambda: ctx
    action = Mock(side_effect=AssertionError('must not run'))
    monkeypatch.setattr(routes, 'run_workspace_automation_cycle', action)
    with TestClient(app) as client:
        assert client.post('/automation-cron/run-now', json={}).status_code == 403
        assert client.post('/automation-cron/config', json={}).status_code == 403
    action.assert_not_called()
    assert ctx.session.mock_calls == []


def test_official_get_only_bounded_registry_refresh():
    row = NS(external_page_id='1', name='old')
    session = Mock()
    session.execute.return_value.scalars.return_value.all.return_value = [row]
    transport = Mock()
    transport.get.return_value = NS(ok=True, payload={'data': [{'id': '1', 'name': 'new'}],
                                                     'paging': {'next': 'https://untrusted'}})
    result = cron._read_registry_part(session, uuid.uuid4(), [transport], 'pages')
    assert result == {'status': 'partial', 'read': 1, 'updated': 1}
    assert row.name == 'new'
    transport.get.assert_called_once_with('me/accounts', {'fields': 'id,name', 'limit': '100'})
    transport.post.assert_not_called()
    session.commit.assert_not_called()


def test_forbidden_calls_absent_from_service():
    source = inspect.getsource(cron)
    tree = ast.parse(source)
    forbidden = {'publish_page_feed_post', 'dispatch_due', 'dispatch_operational_telegram_alerts',
                 '_spin_via_page_copy', '_resolve_page_access_token_via_transports',
                 'run_workspace_quick_sync', '_sync_workspace_pages_from_meta', 'post', 'delete'}
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, 'id', '')
            assert name not in forbidden


def test_lock_same_key_release_and_invalidate_on_failure():
    session = MagicMock()
    connection = session.get_bind.return_value.connect.return_value.__enter__.return_value
    connection.execute.return_value.scalar.return_value = True
    with cron._cron_lock(session) as locked:
        assert locked
    assert connection.execute.call_args_list[0].args[1] == {'k': cron.CRON_ADVISORY_LOCK_KEY}
    assert 'pg_advisory_unlock' in str(connection.execute.call_args_list[1].args[0])
    connection.execute.side_effect = [NS(scalar=lambda: True), RuntimeError('lost connection')]
    with pytest.raises(RuntimeError), cron._cron_lock(session):
        pass
    connection.invalidate.assert_called_once()


def test_lock_contention_no_cycle(monkeypatch):
    monkeypatch.setattr(cron, '_cron_lock', lambda s: nullcontext(False))
    session = Mock()
    from app.core.errors import ConflictError
    with pytest.raises(ConflictError):
        run(session, force_sync=True)
    assert session.mock_calls == []


def test_manual_commit_failure_propagates_with_lock_held(cycle, monkeypatch):
    session, _, _, _ = cycle
    state = []

    @contextmanager
    def lock(_):
        state.append('held')
        try:
            yield True
        finally:
            state.append('released')

    def commit():
        assert state == ['held']
        raise RuntimeError('local commit failed')

    monkeypatch.setattr(cron, '_cron_lock', lock)
    monkeypatch.setattr(cron, '_read_registry_part', lambda *args: {'status': 'succeeded', 'read': 0, 'updated': 0})
    session.commit.side_effect = commit
    with pytest.raises(RuntimeError, match='local commit failed'):
        run(session, force_sync=True, commit=True)
    assert state == ['held', 'released']


def test_invalid_owner_route_payloads_never_invoke_cycle(monkeypatch):
    from app.api.deps import get_owner_context
    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(routes.router)
    app.dependency_overrides[get_owner_context] = lambda: NS(session=Mock())
    action = Mock(side_effect=AssertionError('must not run'))
    monkeypatch.setattr(routes, 'run_workspace_automation_cycle', action)
    with TestClient(app) as client:
        for body in ({'warmup': True}, {'sync': 'true'}, {'credential': 'x'}, {'extra': False}):
            assert client.post('/automation-cron/run-now', json=body).status_code == 422
        for body in ({'auto_page_warmup_enabled': True}, {'sync_interval_minutes': 14},
                     {'sync_interval_minutes': 15.0}, {'auto_meta_sync_enabled': 'false'}):
            assert client.post('/automation-cron/config', json=body).status_code == 422
    action.assert_not_called()


def test_part_savepoint_rolls_back_only_failed_part(cycle, monkeypatch):
    session, audit, _, _ = cycle
    registry = {'user_change': 'keep'}

    @contextmanager
    def savepoint():
        before = registry.copy()
        try:
            yield
        except Exception:
            registry.clear()
            registry.update(before)
            raise

    def part(_session, _workspace, _transports, name):
        registry[name] = 'updated'
        if name == 'accounts':
            raise RuntimeError('failed flush')
        return {'status': 'succeeded', 'read': 1, 'updated': 1}

    session.begin_nested.side_effect = savepoint
    monkeypatch.setattr(cron, '_read_registry_part', part)
    result = run(session, force_sync=True)
    assert result['sync_status'] == 'partial'
    assert registry == {'user_change': 'keep', 'pages': 'updated'}
    assert result['parts']['accounts']['updated'] == 0
    session.rollback.assert_not_called()
    assert audit.record.call_args.kwargs['metadata'] == result


@pytest.mark.parametrize("stored,provider", [("act_123", "123"), ("123", "act_123")])
def test_account_id_prefix_matches_exact_existing_row(stored, provider):
    row = NS(external_account_id=stored, display_name="old")
    session = Mock()
    session.execute.return_value.scalars.return_value.all.return_value = [row]
    transport = Mock()
    transport.get.return_value = NS(ok=True, payload={"data": [{"id": provider, "name": "real name"}]})
    result = cron._read_registry_part(session, uuid.uuid4(), [transport], "accounts")
    assert result == {"status": "succeeded", "read": 1, "updated": 1}
    assert row.display_name == "real name"
    transport.post.assert_not_called()


def test_ambiguous_canonical_account_ids_do_not_choose_a_row():
    session = Mock()
    rows = [NS(external_account_id=i, display_name="old") for i in ["123", "act_123"]]
    session.execute.return_value.scalars.return_value.all.return_value = rows
    transport = Mock()
    transport.get.return_value = NS(ok=True, payload={"data": [{"id": "123", "name": "new"}]})
    with pytest.raises(ValidationError, match="Ambiguous"):
        cron._read_registry_part(session, uuid.uuid4(), [transport], "accounts")
    assert all(r.display_name == "old" for r in rows)


def test_malformed_provider_item_is_validated_before_any_name_update():
    row = NS(external_page_id="1", name="old")
    session = Mock()
    session.execute.return_value.scalars.return_value.all.return_value = [row]
    transport = Mock()
    transport.get.return_value = NS(ok=True, payload={"data": [{"id": "1", "name": "new"}, {"id": 2, "name": "invalid"}]})
    with pytest.raises(ValidationError):
        cron._read_registry_part(session, uuid.uuid4(), [transport], "pages")
    assert row.name == "old"
    session.execute.assert_not_called()
