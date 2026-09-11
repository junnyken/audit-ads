"""A8 — Bulk Pixel Share via the official Meta API. Reuses A7's exact engine, so this file
mirrors A7's own test shape (provider, service, API) rather than re-deriving new patterns."""
from __future__ import annotations

import pytest

from app.core.enums import MetaBatchItemStatus, MetaEnvironment
from app.core.errors import ConflictError
from app.models.meta_operations import MetaConnection
from app.services.audit import AuditLogService
from app.services.meta_pixel_share import DraftPixelShareItem, PixelShareBatchService
from app.services.meta_provider import (
    CapabilityCheck,
    FakeMetaBusinessProvider,
    MetaFailureCode,
    SharePixelRequest,
    SharePixelResult,
)


def _pixel_request(key: str = "key-1") -> SharePixelRequest:
    return SharePixelRequest(
        source_external_pixel_id="pixel_1",
        target_ad_account_external_id="act_1",
        idempotency_key=key,
    )


# ------------------------------------------------------------------------ provider


def test_capability_defaults_include_pixel_access():
    provider = FakeMetaBusinessProvider()
    assert provider.check_capability().share_pixel_access is True


def test_pixel_share_succeeds_by_default_and_returns_a_grant_reference():
    provider = FakeMetaBusinessProvider()
    result = provider.share_pixel_access(_pixel_request())
    assert result.status == "succeeded"
    assert result.access_grant_reference is not None


def test_pixel_share_permission_missing_is_not_retryable():
    provider = FakeMetaBusinessProvider()
    provider.queue_pixel_share_result(
        SharePixelResult(status="failed", failure_code=MetaFailureCode.PERMISSION_MISSING)
    )
    result = provider.share_pixel_access(_pixel_request())
    assert result.status == "failed"
    assert result.retryable is False


def test_pixel_share_rate_limited_retries_to_success():
    provider = FakeMetaBusinessProvider()
    provider.queue_pixel_share_result(
        SharePixelResult(status="failed", failure_code=MetaFailureCode.RATE_LIMITED)
    )
    first = provider.share_pixel_access(_pixel_request("attempt-1"))
    assert first.retryable is True
    second = provider.share_pixel_access(_pixel_request("attempt-2"))
    assert second.status == "succeeded"


def test_pixel_share_idempotency_key_replay_returns_the_same_result():
    provider = FakeMetaBusinessProvider()
    first = provider.share_pixel_access(_pixel_request("same-key"))
    second = provider.share_pixel_access(_pixel_request("same-key"))
    assert first == second
    assert len(provider.pixels_shared) == 1


# ------------------------------------------------------------------------ batch engine


@pytest.fixture()
def audit(session, workspace, owner):
    return AuditLogService(session, workspace.id, owner["user"].id)


@pytest.fixture()
def connection(session, workspace, owner):
    row = MetaConnection(
        workspace_id=workspace.id,
        label="Fake connection",
        environment=MetaEnvironment.FAKE,
        capabilities_json={"share_pixel_access": True},
        created_by=owner["user"].id,
    )
    session.add(row)
    session.commit()
    return row


@pytest.fixture()
def pixel_share_service(session, workspace, owner, audit):
    return PixelShareBatchService(session, workspace.id, audit, owner["user"].id)


@pytest.fixture()
def provider():
    return FakeMetaBusinessProvider()


def test_capability_unavailable_blocks_drafting(session, workspace, owner, pixel_share_service):
    blocked = MetaConnection(
        workspace_id=workspace.id,
        label="No pixel-share permission",
        environment=MetaEnvironment.FAKE,
        capabilities_json={"share_pixel_access": False, "reason": "permission_missing"},
        created_by=owner["user"].id,
    )
    session.add(blocked)
    session.commit()

    with pytest.raises(ConflictError):
        pixel_share_service.create_draft(
            meta_connection_id=blocked.id,
            items=[DraftPixelShareItem(source_external_pixel_id="pixel_1", target_ad_account_external_id="act_1")],
        )


def test_full_flow_success(pixel_share_service, connection, provider):
    batch = pixel_share_service.create_draft(
        meta_connection_id=connection.id,
        items=[DraftPixelShareItem(source_external_pixel_id="pixel_1", target_ad_account_external_id="act_1")],
    )
    preview = pixel_share_service.preview(batch)
    pixel_share_service.confirm(batch, preview_hash=preview["preview_hash"])
    pixel_share_service.run(batch, provider)

    item = pixel_share_service.list_items(batch)[0]
    assert item.status == MetaBatchItemStatus.SUCCEEDED
    assert item.access_grant_reference is not None


def test_run_before_confirm_is_refused(pixel_share_service, connection, provider):
    batch = pixel_share_service.create_draft(
        meta_connection_id=connection.id,
        items=[DraftPixelShareItem(source_external_pixel_id="pixel_1", target_ad_account_external_id="act_1")],
    )
    with pytest.raises(ConflictError):
        pixel_share_service.run(batch, provider)


def test_confirm_with_stale_preview_hash_is_refused(pixel_share_service, connection):
    batch = pixel_share_service.create_draft(
        meta_connection_id=connection.id,
        items=[DraftPixelShareItem(source_external_pixel_id="pixel_1", target_ad_account_external_id="act_1")],
    )
    with pytest.raises(ConflictError):
        pixel_share_service.confirm(batch, preview_hash="wrong")


def test_rate_limited_requeues_and_second_run_succeeds(pixel_share_service, connection, provider):
    batch = pixel_share_service.create_draft(
        meta_connection_id=connection.id,
        items=[DraftPixelShareItem(source_external_pixel_id="pixel_1", target_ad_account_external_id="act_1")],
    )
    preview = pixel_share_service.preview(batch)
    pixel_share_service.confirm(batch, preview_hash=preview["preview_hash"])
    provider.queue_pixel_share_result(
        SharePixelResult(status="failed", failure_code=MetaFailureCode.RATE_LIMITED)
    )

    pixel_share_service.run(batch, provider)
    after_first = pixel_share_service.list_items(batch)[0]
    assert after_first.status == MetaBatchItemStatus.QUEUED
    assert after_first.retry_count == 1

    pixel_share_service.run(batch, provider)
    after_second = pixel_share_service.list_items(batch)[0]
    assert after_second.status == MetaBatchItemStatus.SUCCEEDED


# ------------------------------------------------------------------------ API


def make_connection(api, **overrides):
    payload = {"label": "Test connection", "environment": "fake"}
    payload.update(overrides)
    return api.post("/api/v1/meta-connections", json=payload).json()


def test_api_full_flow_success(api, meta_provider):
    connection = make_connection(api)
    api.post(f"/api/v1/meta-connections/{connection['id']}/check-capability")

    draft = api.post(
        "/api/v1/pixel-share-batches",
        json={
            "meta_connection_id": connection["id"],
            "items": [{"source_external_pixel_id": "pixel_1", "target_ad_account_external_id": "act_1"}],
        },
    ).json()
    api.post(
        f"/api/v1/pixel-share-batches/{draft['batch']['id']}/confirm",
        json={"preview_hash": draft["current_preview_hash"]},
    )
    ran = api.post(f"/api/v1/pixel-share-batches/{draft['batch']['id']}/run").json()
    assert ran["items"][0]["status"] == "succeeded"
    assert ran["items"][0]["access_grant_reference"] is not None


def test_api_blocked_when_capability_says_no(api, meta_provider):
    connection = make_connection(api)
    meta_provider.capability = CapabilityCheck(
        list_business_managers=True,
        create_ad_account=True,
        share_ad_account_access=True,
        share_pixel_access=False,
        reason=MetaFailureCode.PERMISSION_MISSING,
    )
    api.post(f"/api/v1/meta-connections/{connection['id']}/check-capability")

    response = api.post(
        "/api/v1/pixel-share-batches",
        json={
            "meta_connection_id": connection["id"],
            "items": [{"source_external_pixel_id": "pixel_1", "target_ad_account_external_id": "act_1"}],
        },
    )
    assert response.status_code == 409


def test_api_cross_workspace_batch_access_is_non_disclosing(api, other_auth, client, meta_provider):
    connection = make_connection(api)
    api.post(f"/api/v1/meta-connections/{connection['id']}/check-capability")
    draft = api.post(
        "/api/v1/pixel-share-batches",
        json={
            "meta_connection_id": connection["id"],
            "items": [{"source_external_pixel_id": "pixel_1", "target_ad_account_external_id": "act_1"}],
        },
    ).json()

    response = client.get(f"/api/v1/pixel-share-batches/{draft['batch']['id']}", headers=other_auth)
    assert response.status_code == 404
