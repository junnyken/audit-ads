"""A10.2 write readiness — a refusal to attempt is not an ambiguous outcome.

Found while auditing A10.2, in code A10 had already shipped. All three batch engines wrapped the
provider call in a blanket `except Exception` that produced `status="unknown"`. `unknown` is the
one state in this product that means *"this may have succeeded on Meta's side — go and look"*,
and it exists for timeouts, where that is genuinely true.

`MetaWriteNotEnabled` is the opposite: nothing left the process. Reporting it as `unknown` would
send an operator into Business Settings hunting for an ad account that was never requested — and
`MetaWriteNotEnabled`'s own docstring says it is an exception precisely so that cannot happen.
No batch service imported it, so none of them could tell it apart from a genuine crash.

These tests pin the distinction in all three engines.
"""
from __future__ import annotations

import pytest

from app.core.enums import MetaBatchItemStatus, MetaEnvironment
from app.models.meta_operations import MetaConnection
from app.services.audit import AuditLogService
from app.services.meta_access_share import AccessShareBatchService, DraftShareItem
from app.services.meta_account_creation import AccountCreationBatchService, DraftAccountItem
from app.services.meta_pixel_share import DraftPixelShareItem, PixelShareBatchService
from app.services.meta_provider import MetaFailureCode
from app.services.meta_real_provider import RealMetaBusinessProvider


class _NeverCalled:
    """A transport that fails the test if a write ever reaches it."""

    def get(self, path, params=None):  # pragma: no cover - reads are irrelevant here
        raise AssertionError(f"unexpected read of {path}")


@pytest.fixture()
def audit(session, workspace, owner):
    return AuditLogService(session, workspace.id, owner["user"].id)


@pytest.fixture()
def connection(session, workspace, owner):
    row = MetaConnection(
        workspace_id=workspace.id,
        label="Production-shaped",
        environment=MetaEnvironment.FAKE,
        capabilities_json={
            "list_business_managers": True,
            "create_ad_account": True,
            "share_ad_account_access": True,
            "share_pixel_access": True,
        },
        created_by=owner["user"].id,
    )
    session.add(row)
    session.commit()
    return row


@pytest.fixture()
def refusing_provider():
    """The real provider with no write capability — exactly what a `production` connection gets
    today, and what it will keep getting until writes are deliberately enabled."""
    return RealMetaBusinessProvider(transport=_NeverCalled())  # type: ignore[arg-type]


def _run(service, batch):
    preview = service.preview(batch)
    service.confirm(batch, preview_hash=preview["preview_hash"])
    return preview


def test_a_refused_create_is_failed_with_a_reason_not_unknown(
    session, workspace, audit, owner, connection, refusing_provider
):
    service = AccountCreationBatchService(session, workspace.id, audit, owner["user"].id)
    batch = service.create_draft(
        meta_connection_id=connection.id,
        business_manager_external_id="bm_1",
        items=[DraftAccountItem(name="Pilot account", currency="VND", country="VN")],
    )
    _run(service, batch)
    service.run(batch, refusing_provider)

    item = service.list_items(batch)[0]
    assert item.status == MetaBatchItemStatus.FAILED
    assert item.failure_code == MetaFailureCode.NOT_SUPPORTED.value
    # The whole point: not `unknown`, which would mean "it might have happened".
    assert item.status != MetaBatchItemStatus.UNKNOWN


def test_a_refused_access_share_is_failed_not_unknown(
    session, workspace, audit, owner, connection, refusing_provider
):
    service = AccessShareBatchService(session, workspace.id, audit, owner["user"].id)
    batch = service.create_draft(
        meta_connection_id=connection.id,
        items=[
            DraftShareItem(
                source_external_account_id="act_1",
                recipient_reference="person@example.com",
                role="analyst",
            )
        ],
    )
    _run(service, batch)
    service.run(batch, refusing_provider)

    item = service.list_items(batch)[0]
    assert item.status == MetaBatchItemStatus.FAILED
    assert item.failure_code == MetaFailureCode.NOT_SUPPORTED.value


def test_a_refused_pixel_share_is_failed_not_unknown(
    session, workspace, audit, owner, connection, refusing_provider
):
    service = PixelShareBatchService(session, workspace.id, audit, owner["user"].id)
    batch = service.create_draft(
        meta_connection_id=connection.id,
        items=[
            DraftPixelShareItem(
                source_external_pixel_id="pix_1", target_ad_account_external_id="act_1"
            )
        ],
    )
    _run(service, batch)
    service.run(batch, refusing_provider)

    item = service.list_items(batch)[0]
    assert item.status == MetaBatchItemStatus.FAILED
    assert item.failure_code == MetaFailureCode.NOT_SUPPORTED.value


def test_a_live_batch_larger_than_the_pilot_limit_is_refused_whole(
    session, workspace, audit, owner, connection, refusing_provider
):
    """The first real write is a pilot of exactly one, and the limit binds *before* any item
    runs — a batch that created three accounts and then stopped would be the worst outcome,
    because those three cannot be un-created."""
    from app.core.errors import ConflictError

    service = AccountCreationBatchService(session, workspace.id, audit, owner["user"].id)
    batch = service.create_draft(
        meta_connection_id=connection.id,
        business_manager_external_id="bm_1",
        items=[DraftAccountItem(name=f"Account {n}", currency="VND") for n in range(3)],
    )
    _run(service, batch)

    with pytest.raises(ConflictError):
        service.run(batch, refusing_provider)

    # Nothing was attempted: every item is still queued, not half-processed.
    assert {item.status for item in service.list_items(batch)} == {MetaBatchItemStatus.QUEUED}


def test_the_pilot_limit_does_not_bind_the_fake_provider(
    session, workspace, audit, owner, connection
):
    """A fake write costs nothing and repeats freely, so capping it would only make the safe
    environment harder to use than the dangerous one."""
    from app.services.meta_provider import reset_fake_provider

    service = AccountCreationBatchService(session, workspace.id, audit, owner["user"].id)
    batch = service.create_draft(
        meta_connection_id=connection.id,
        business_manager_external_id="bm_1",
        items=[DraftAccountItem(name=f"Account {n}", currency="VND") for n in range(3)],
    )
    _run(service, batch)
    service.run(batch, reset_fake_provider())

    assert {item.status for item in service.list_items(batch)} == {MetaBatchItemStatus.SUCCEEDED}


def test_a_refusal_is_not_retryable(
    session, workspace, audit, owner, connection, refusing_provider
):
    """`not_supported` is outside `RETRYABLE_FAILURE_CODES`, so the engine will not keep asking a
    provider that has already said it will not attempt."""
    from app.services.meta_provider import RETRYABLE_FAILURE_CODES

    assert MetaFailureCode.NOT_SUPPORTED not in RETRYABLE_FAILURE_CODES


def test_an_unexpected_crash_is_still_unknown(
    session, workspace, audit, owner, connection
):
    """The blanket handler stays, and must: a provider that dies mid-call genuinely may have
    reached Meta, so `unknown` remains the honest answer there."""

    class _Exploding(RealMetaBusinessProvider):
        def create_ad_account(self, request):
            raise RuntimeError("connection reset")

    service = AccountCreationBatchService(session, workspace.id, audit, owner["user"].id)
    batch = service.create_draft(
        meta_connection_id=connection.id,
        business_manager_external_id="bm_1",
        items=[DraftAccountItem(name="Ambiguous", currency="VND")],
    )
    _run(service, batch)
    service.run(batch, _Exploding(transport=_NeverCalled()))  # type: ignore[arg-type]

    item = service.list_items(batch)[0]
    assert item.status == MetaBatchItemStatus.UNKNOWN
