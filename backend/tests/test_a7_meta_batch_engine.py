"""A7 batch engine — service-level tests against a real PostgreSQL session, covering every
required pilot scenario from mini-spec A7 §"Meta API chưa sẵn sàng vẫn build được"."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.core.enums import MetaBatchItemStatus, MetaEnvironment
from app.core.errors import ConflictError
from app.models.meta_operations import MetaConnection
from app.services.audit import AuditLogService
from app.services.meta_access_share import AccessShareBatchService, DraftShareItem
from app.services.meta_account_creation import AccountCreationBatchService, DraftAccountItem
from app.services.meta_provider import (
    CreateAccountResult,
    FakeMetaBusinessProvider,
    MetaFailureCode,
    ShareAccessResult,
)


@pytest.fixture()
def audit(session, workspace, owner):
    return AuditLogService(session, workspace.id, owner["user"].id)


@pytest.fixture()
def connection(session, workspace, owner):
    row = MetaConnection(
        workspace_id=workspace.id,
        label="Fake connection",
        environment=MetaEnvironment.FAKE,
        capabilities_json={"list_business_managers": True, "create_ad_account": True, "share_ad_account_access": True},
        created_by=owner["user"].id,
    )
    session.add(row)
    session.commit()
    return row


@pytest.fixture()
def creation_service(session, workspace, owner, audit):
    return AccountCreationBatchService(session, workspace.id, audit, owner["user"].id)


@pytest.fixture()
def share_service(session, workspace, owner, audit):
    return AccessShareBatchService(session, workspace.id, audit, owner["user"].id)


@pytest.fixture()
def provider():
    return FakeMetaBusinessProvider()


# ------------------------------------------------------------------------ capability


def test_capability_unavailable_blocks_drafting_a_creation_batch(session, workspace, owner, audit, creation_service):
    blocked = MetaConnection(
        workspace_id=workspace.id,
        label="No create permission",
        environment=MetaEnvironment.FAKE,
        capabilities_json={"create_ad_account": False, "reason": "permission_missing"},
        created_by=owner["user"].id,
    )
    session.add(blocked)
    session.commit()

    with pytest.raises(ConflictError):
        creation_service.create_draft(
            meta_connection_id=blocked.id,
            business_manager_external_id="bm_1",
            items=[DraftAccountItem(name="A", currency="VND")],
        )


# ------------------------------------------------------------------------ create: success


def test_create_batch_success_syncs_account_with_unknown_readiness_and_health(
    creation_service, connection, provider
):
    batch = creation_service.create_draft(
        meta_connection_id=connection.id,
        business_manager_external_id="bm_1",
        items=[DraftAccountItem(name="New TKQC", currency="VND", country="VN")],
    )
    preview = creation_service.preview(batch)
    creation_service.confirm(batch, preview_hash=preview["preview_hash"])
    creation_service.run(batch, provider)

    items = creation_service.list_items(batch)
    assert items[0].status == MetaBatchItemStatus.SUCCEEDED
    assert items[0].external_account_id is not None
    assert items[0].synced_ad_account_id is not None


def test_run_before_confirm_is_refused(creation_service, connection, provider):
    batch = creation_service.create_draft(
        meta_connection_id=connection.id,
        business_manager_external_id="bm_1",
        items=[DraftAccountItem(name="A", currency="VND")],
    )
    with pytest.raises(ConflictError):
        creation_service.run(batch, provider)


# ------------------------------------------------------------------------ create: permission/billing (not retryable)


def test_create_permission_missing_leaves_item_failed_not_retried(creation_service, connection, provider):
    batch = creation_service.create_draft(
        meta_connection_id=connection.id,
        business_manager_external_id="bm_1",
        items=[DraftAccountItem(name="A", currency="VND")],
    )
    preview = creation_service.preview(batch)
    creation_service.confirm(batch, preview_hash=preview["preview_hash"])
    provider.queue_create_result(
        CreateAccountResult(status="failed", failure_code=MetaFailureCode.PERMISSION_MISSING)
    )
    creation_service.run(batch, provider)

    item = creation_service.list_items(batch)[0]
    assert item.status == MetaBatchItemStatus.FAILED
    assert item.retry_count == 0


def test_create_billing_required_leaves_item_failed_not_retried(creation_service, connection, provider):
    batch = creation_service.create_draft(
        meta_connection_id=connection.id,
        business_manager_external_id="bm_1",
        items=[DraftAccountItem(name="A", currency="VND")],
    )
    preview = creation_service.preview(batch)
    creation_service.confirm(batch, preview_hash=preview["preview_hash"])
    provider.queue_create_result(
        CreateAccountResult(status="failed", failure_code=MetaFailureCode.BILLING_REQUIRED)
    )
    creation_service.run(batch, provider)

    item = creation_service.list_items(batch)[0]
    assert item.status == MetaBatchItemStatus.FAILED


# ------------------------------------------------------------------------ create: rate-limit → retry → success


def test_create_rate_limited_requeues_and_a_second_run_succeeds(creation_service, connection, provider):
    batch = creation_service.create_draft(
        meta_connection_id=connection.id,
        business_manager_external_id="bm_1",
        items=[DraftAccountItem(name="A", currency="VND")],
    )
    preview = creation_service.preview(batch)
    creation_service.confirm(batch, preview_hash=preview["preview_hash"])
    provider.queue_create_result(CreateAccountResult(status="failed", failure_code=MetaFailureCode.RATE_LIMITED))

    creation_service.run(batch, provider)
    after_first = creation_service.list_items(batch)[0]
    assert after_first.status == MetaBatchItemStatus.QUEUED
    assert after_first.retry_count == 1

    creation_service.run(batch, provider)
    after_second = creation_service.list_items(batch)[0]
    assert after_second.status == MetaBatchItemStatus.SUCCEEDED


# ------------------------------------------------------------------------ create: timeout → unknown


def test_create_timeout_is_unknown_and_run_again_does_not_touch_it(creation_service, connection, provider):
    batch = creation_service.create_draft(
        meta_connection_id=connection.id,
        business_manager_external_id="bm_1",
        items=[DraftAccountItem(name="A", currency="VND")],
    )
    preview = creation_service.preview(batch)
    creation_service.confirm(batch, preview_hash=preview["preview_hash"])
    provider.queue_create_result(CreateAccountResult(status="unknown", failure_code=MetaFailureCode.TIMEOUT))

    creation_service.run(batch, provider)
    item = creation_service.list_items(batch)[0]
    assert item.status == MetaBatchItemStatus.UNKNOWN

    # A second `run()` must not touch an unknown item — only reconcile() may.
    creation_service.run(batch, provider)
    still = creation_service.list_items(batch)[0]
    assert still.status == MetaBatchItemStatus.UNKNOWN


def test_reconcile_resolves_an_unknown_item_once_the_provider_can_answer(creation_service, connection, provider):
    batch = creation_service.create_draft(
        meta_connection_id=connection.id,
        business_manager_external_id="bm_1",
        items=[DraftAccountItem(name="A", currency="VND")],
    )
    preview = creation_service.preview(batch)
    creation_service.confirm(batch, preview_hash=preview["preview_hash"])
    provider.queue_create_result(CreateAccountResult(status="unknown", failure_code=MetaFailureCode.TIMEOUT))
    creation_service.run(batch, provider)
    item = creation_service.list_items(batch)[0]

    provider.stage_reconcile_result(
        item.idempotency_key, CreateAccountResult(status="succeeded", external_account_id="fake_act_reconciled")
    )
    creation_service.reconcile(item, provider)

    resolved = creation_service.get_item(item.id)
    assert resolved.status == MetaBatchItemStatus.SUCCEEDED
    assert resolved.external_account_id == "fake_act_reconciled"


def test_reconcile_with_no_provider_answer_stays_unknown_for_manual_check(creation_service, connection, provider):
    batch = creation_service.create_draft(
        meta_connection_id=connection.id,
        business_manager_external_id="bm_1",
        items=[DraftAccountItem(name="A", currency="VND")],
    )
    preview = creation_service.preview(batch)
    creation_service.confirm(batch, preview_hash=preview["preview_hash"])
    provider.queue_create_result(CreateAccountResult(status="unknown", failure_code=MetaFailureCode.TIMEOUT))
    creation_service.run(batch, provider)
    item = creation_service.list_items(batch)[0]

    provider.stage_reconcile_result(item.idempotency_key, None)
    creation_service.reconcile(item, provider)

    still = creation_service.get_item(item.id)
    assert still.status == MetaBatchItemStatus.UNKNOWN  # never guessed into succeeded/failed


# ------------------------------------------------------------------------ preview mismatch → 409


def test_confirm_with_a_stale_preview_hash_is_refused(creation_service, connection, provider):
    batch = creation_service.create_draft(
        meta_connection_id=connection.id,
        business_manager_external_id="bm_1",
        items=[DraftAccountItem(name="A", currency="VND")],
    )
    with pytest.raises(ConflictError):
        creation_service.confirm(batch, preview_hash="not-the-real-hash")


def test_confirm_twice_is_refused(creation_service, connection, provider):
    batch = creation_service.create_draft(
        meta_connection_id=connection.id,
        business_manager_external_id="bm_1",
        items=[DraftAccountItem(name="A", currency="VND")],
    )
    preview = creation_service.preview(batch)
    creation_service.confirm(batch, preview_hash=preview["preview_hash"])
    with pytest.raises(ConflictError):
        creation_service.confirm(batch, preview_hash=preview["preview_hash"])


# ------------------------------------------------------------------------ queue crash → lease recovery


def test_a_stuck_running_item_past_the_lease_window_is_reclaimed_and_retried(
    session, creation_service, connection, provider
):
    batch = creation_service.create_draft(
        meta_connection_id=connection.id,
        business_manager_external_id="bm_1",
        items=[DraftAccountItem(name="A", currency="VND")],
    )
    preview = creation_service.preview(batch)
    creation_service.confirm(batch, preview_hash=preview["preview_hash"])

    item = creation_service.list_items(batch)[0]
    item.status = MetaBatchItemStatus.RUNNING
    item.last_attempted_at = datetime.now(UTC) - timedelta(minutes=10)
    session.commit()

    creation_service.run(batch, provider)
    recovered = creation_service.get_item(item.id)
    assert recovered.status == MetaBatchItemStatus.SUCCEEDED  # reclaimed, requeued, then ran to completion
    assert recovered.retry_count == 1


# ------------------------------------------------------------------------ share: success + unsupported role


def test_share_success(share_service, connection, provider):
    batch = share_service.create_draft(
        meta_connection_id=connection.id,
        items=[DraftShareItem(source_external_account_id="act_1", recipient_reference="system_user:1", role="advertiser")],
    )
    preview = share_service.preview(batch)
    share_service.confirm(batch, preview_hash=preview["preview_hash"])
    share_service.run(batch, provider)

    item = share_service.list_items(batch)[0]
    assert item.status == MetaBatchItemStatus.SUCCEEDED
    assert item.access_grant_reference is not None


def test_share_unsupported_role_is_failed_not_retried(share_service, connection, provider):
    batch = share_service.create_draft(
        meta_connection_id=connection.id,
        items=[DraftShareItem(source_external_account_id="act_1", recipient_reference="system_user:1", role="owner")],
    )
    preview = share_service.preview(batch)
    share_service.confirm(batch, preview_hash=preview["preview_hash"])
    provider.queue_share_result(ShareAccessResult(status="failed", failure_code=MetaFailureCode.UNSUPPORTED_ROLE))
    share_service.run(batch, provider)

    item = share_service.list_items(batch)[0]
    assert item.status == MetaBatchItemStatus.FAILED
    assert item.retry_count == 0


def test_share_capability_unavailable_blocks_drafting(session, workspace, owner, share_service):
    blocked = MetaConnection(
        workspace_id=workspace.id,
        label="No share permission",
        environment=MetaEnvironment.FAKE,
        capabilities_json={"share_ad_account_access": False, "reason": "permission_missing"},
        created_by=owner["user"].id,
    )
    session.add(blocked)
    session.commit()

    with pytest.raises(ConflictError):
        share_service.create_draft(
            meta_connection_id=blocked.id,
            items=[DraftShareItem(source_external_account_id="act_1", recipient_reference="x", role="advertiser")],
        )
