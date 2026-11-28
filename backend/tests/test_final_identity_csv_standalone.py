"""Actual Page sync path, session double only; run with --noconftest."""
import uuid
from contextlib import nullcontext
from datetime import UTC, datetime
from types import SimpleNamespace as NS
from unittest.mock import Mock

import pytest

from app.api.v1.routers import meta_operations as routes
from app.core.enums import AccountStatus, ReferenceStatus
from app.models.entities import AccountAssetLink, BusinessManager, Page


class SessionDouble:
    def __init__(self, workspace, pages, accounts=(), bms=(), audits=()):
        self.workspace = workspace
        self.pages = pages
        self.added = []
        self.queries = []
        self.results = iter([[], pages, bms, [], [], accounts, [], audits])

    def execute(self, stmt):
        # Assert every production query carries the actual authorized workspace.
        self.queries.append(stmt)
        compiled = stmt.compile()
        assert self.workspace in compiled.params.values()
        assert 'workspace_id =' in str(compiled)
        return NS(scalars=lambda: NS(all=lambda: next(self.results)))

    def begin_nested(self):
        return nullcontext()

    def add(self, row):
        if row.id is None:
            row.id = uuid.uuid4()
        self.added.append(row)

    def flush(self):
        pass


def page(workspace, ext, archived=None):
    return Page(id=uuid.uuid4(), workspace_id=workspace, name='Identical name',
                external_page_id=ext, archived_at=archived, status=ReferenceStatus.UNKNOWN)


def sync(monkeypatch, pages, payloads, *, workspace, accounts=(), bms=(), audits=()):
    session = SessionDouble(workspace, pages, accounts, bms, audits)
    transport = Mock()
    transport.get.side_effect = lambda path, params: NS(ok=True, payload=payloads.get(path, {}))
    monkeypatch.setattr(routes, 'get_settings', lambda: NS(meta_access_token='test-only', meta_business_id='configured-bm'))
    monkeypatch.setattr(routes, 'is_bootstrap_owner_workspace', lambda *args: True)
    monkeypatch.setattr(routes, 'build_real_provider', lambda *args, **kwargs: NS(transport=transport))
    audit = Mock()
    result = routes._sync_workspace_pages_from_meta(session, workspace, audit)
    assert 'me/accounts' in [call.args[0] for call in transport.get.call_args_list]
    return result, session, audit, transport


def test_same_name_draft_never_attached_and_distinct_ids_stay_distinct(monkeypatch):
    ws = uuid.uuid4()
    draft = page(ws, None)
    result, session, audit, _ = sync(monkeypatch, [draft], {
        'me/accounts': {'data': [{'id': '100', 'name': draft.name}, {'id': '200', 'name': draft.name}]},
    }, workspace=ws)
    created = [row for row in session.added if isinstance(row, Page)]
    assert draft.external_page_id is None
    assert draft.status == ReferenceStatus.UNKNOWN
    assert {row.external_page_id for row in created} == {'100', '200'}
    assert all(row.workspace_id == ws and row.id != draft.id for row in created)
    assert result == {'synced_count': 2, 'new_count': 2, 'linked_account_count': 0, 'bm_claimed_count': 0}
    assert audit.record.call_count == 2


@pytest.mark.parametrize('edge', ['me/accounts', 'bm/owned_pages', 'bm/client_pages', 'act_123/promote_pages'])
def test_archived_exact_id_never_restored_duplicated_written_linked_or_claimed(monkeypatch, edge):
    ws = uuid.uuid4()
    archived_at = datetime.now(UTC)
    archived = page(ws, '100', archived_at)
    bm = BusinessManager(id=uuid.uuid4(), workspace_id=ws, external_id='bm', name='BM')
    account = NS(id=uuid.uuid4(), external_account_id='act_123', business_manager=bm,
                 business_manager_id=bm.id, personal_account_reference_id=None, status=AccountStatus.ACTIVE)
    prior = NS(entity_id=str(archived.id), metadata_json={'owner_bm_external_id': 'bm'}, after_json=None)
    result, session, audit, transport = sync(monkeypatch, [archived], {
        edge: {'data': [{'id': '100', 'name': 'Should not change', 'business': {'id': 'new-bm'}}]},
        '100': {'id': '100', 'name': 'Node must not refresh'},
    }, workspace=ws, accounts=[account], bms=[bm], audits=[prior])
    assert archived.archived_at == archived_at
    assert archived.name == 'Identical name'
    assert archived.status == ReferenceStatus.UNKNOWN
    assert archived.notes is None and archived.url is None
    assert session.added == []  # Also forbids BusinessManager side effects before tombstone guard.
    audit.record.assert_not_called()
    transport._claim_page_to_bm.assert_not_called()
    assert '100' not in [call.args[0] for call in transport.get.call_args_list]
    assert result == {'synced_count': 0, 'new_count': 0, 'linked_account_count': 0, 'bm_claimed_count': 0}


def test_active_exact_id_updates_without_name_matching(monkeypatch):
    ws = uuid.uuid4()
    active = page(ws, '100')
    other = page(ws, None)
    result, session, audit, _ = sync(monkeypatch, [active, other], {
        'me/accounts': {'data': [{'id': '100', 'name': other.name, 'category': 'Updated', 'is_published': False}]},
    }, workspace=ws)
    assert active.category == 'Updated' and active.status == ReferenceStatus.INACTIVE
    assert active.archived_at is None
    assert other.external_page_id is None and other.status == ReferenceStatus.UNKNOWN
    assert not any(isinstance(row, Page | AccountAssetLink) for row in session.added)
    assert result == {'synced_count': 1, 'new_count': 0, 'linked_account_count': 0, 'bm_claimed_count': 0}
    assert audit.record.call_args.kwargs['entity_id'] == active.id


def test_same_external_id_in_another_workspace_does_not_attach(monkeypatch):
    ws = uuid.uuid4()
    foreign = page(uuid.uuid4(), '100')
    # The query boundary supplies no foreign rows, as a real scoped SELECT must.
    result, session, _, _ = sync(monkeypatch, [], {
        'me/accounts': {'data': [{'id': foreign.external_page_id, 'name': foreign.name}]},
    }, workspace=ws)
    assert result['new_count'] == 1
    assert session.added[0].workspace_id == ws
    assert session.added[0].id != foreign.id
    assert foreign.status == ReferenceStatus.UNKNOWN


def test_active_promote_page_still_links_to_exact_workspace_account(monkeypatch):
    ws = uuid.uuid4()
    active = page(ws, '100')
    draft = page(ws, None)
    account = NS(id=uuid.uuid4(), external_account_id='act_123', business_manager=None,
                 business_manager_id=None, personal_account_reference_id=None, status=AccountStatus.ACTIVE)
    result, session, _, _ = sync(monkeypatch, [active, draft], {
        'act_123/promote_pages': {'data': [{'id': '100', 'name': draft.name}]},
    }, workspace=ws, accounts=[account])
    links = [row for row in session.added if isinstance(row, AccountAssetLink)]
    assert len(links) == 1
    assert (links[0].workspace_id, links[0].asset_id, links[0].ad_account_id) == (ws, active.id, account.id)
    assert draft.external_page_id is None
    assert result == {'synced_count': 1, 'new_count': 0, 'linked_account_count': 1, 'bm_claimed_count': 0}
