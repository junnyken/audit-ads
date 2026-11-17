"""A7 API integration tests against a real PostgreSQL database."""
from __future__ import annotations

from app.services.meta_provider import CapabilityCheck, MetaFailureCode


def make_connection(api, **overrides):
    payload = {"label": "Test connection", "environment": "fake"}
    payload.update(overrides)
    return api.post("/api/v1/meta-connections", json=payload).json()


# ------------------------------------------------------------------------ Meta connection


def test_create_connection_never_exposes_a_token_field(api):
    connection = make_connection(api)
    # Only the boolean `token_configured` may mention "token" — never a raw credential field.
    token_like_keys = {k for k in connection if "token" in k.lower()}
    assert token_like_keys == {"token_configured"}
    assert connection["token_configured"] is True  # fake environment needs no real credential


def test_check_capability_updates_the_connection(api, meta_provider):
    connection = make_connection(api)
    meta_provider.business_managers = [{"external_id": "bm_1", "name": "Agency BM"}]
    body = api.post(f"/api/v1/meta-connections/{connection['id']}/check-capability").json()
    assert body["capabilities"] == {
        "list_business_managers": True,
        "create_ad_account": True,
        "share_ad_account_access": True,
        "share_pixel_access": True,
        "reason": None,
    }
    assert body["business_managers"] == [{"external_id": "bm_1", "name": "Agency BM"}]
    assert body["last_capability_check_at"] is not None


# ------------------------------------------------------------------------ create batch: full flow


def test_create_batch_full_flow_success(api, meta_provider):
    connection = make_connection(api)
    api.post(f"/api/v1/meta-connections/{connection['id']}/check-capability")

    draft = api.post(
        "/api/v1/account-creation-batches",
        json={
            "meta_connection_id": connection["id"],
            "business_manager_external_id": "bm_1",
            "items": [{"name": "New TKQC", "currency": "VND", "country": "VN"}],
        },
    ).json()
    assert draft["batch"]["confirmed_at"] is None
    assert len(draft["items"]) == 1

    confirmed = api.post(
        f"/api/v1/account-creation-batches/{draft['batch']['id']}/confirm",
        json={"preview_hash": draft["current_preview_hash"]},
    )
    assert confirmed.status_code == 200, confirmed.text

    ran = api.post(f"/api/v1/account-creation-batches/{draft['batch']['id']}/run").json()
    assert ran["items"][0]["status"] == "succeeded"
    assert ran["items"][0]["synced_ad_account_id"] is not None

    # The synced account is real and reachable through the ordinary registry endpoint.
    account = api.get(f"/api/v1/ad-accounts/{ran['items'][0]['synced_ad_account_id']}").json()
    assert account["readiness_status"] == "unknown"


def test_create_batch_blocked_when_capability_says_no(api, meta_provider):
    connection = make_connection(api)
    meta_provider.capability = CapabilityCheck(
        list_business_managers=True,
        create_ad_account=False,
        share_ad_account_access=True,
        reason=MetaFailureCode.PERMISSION_MISSING,
    )
    api.post(f"/api/v1/meta-connections/{connection['id']}/check-capability")

    response = api.post(
        "/api/v1/account-creation-batches",
        json={
            "meta_connection_id": connection["id"],
            "business_manager_external_id": "bm_1",
            "items": [{"name": "A", "currency": "VND"}],
        },
    )
    assert response.status_code == 409


def test_confirm_with_wrong_preview_hash_is_409(api):
    connection = make_connection(api)
    draft = api.post(
        "/api/v1/account-creation-batches",
        json={
            "meta_connection_id": connection["id"],
            "business_manager_external_id": "bm_1",
            "items": [{"name": "A", "currency": "VND"}],
        },
    ).json()

    response = api.post(
        f"/api/v1/account-creation-batches/{draft['batch']['id']}/confirm",
        json={"preview_hash": "wrong-hash"},
    )
    assert response.status_code == 409


def test_run_before_confirm_is_409(api):
    connection = make_connection(api)
    draft = api.post(
        "/api/v1/account-creation-batches",
        json={
            "meta_connection_id": connection["id"],
            "business_manager_external_id": "bm_1",
            "items": [{"name": "A", "currency": "VND"}],
        },
    ).json()

    response = api.post(f"/api/v1/account-creation-batches/{draft['batch']['id']}/run")
    assert response.status_code == 409


# ------------------------------------------------------------------------ share batch: full flow


def test_share_batch_full_flow_success(api):
    connection = make_connection(api)
    api.post(f"/api/v1/meta-connections/{connection['id']}/check-capability")

    draft = api.post(
        "/api/v1/access-share-batches",
        json={
            "meta_connection_id": connection["id"],
            "items": [{"source_external_account_id": "act_1", "recipient_reference": "system_user:1", "role": "advertiser"}],
        },
    ).json()
    api.post(
        f"/api/v1/access-share-batches/{draft['batch']['id']}/confirm",
        json={"preview_hash": draft["current_preview_hash"]},
    )
    ran = api.post(f"/api/v1/access-share-batches/{draft['batch']['id']}/run").json()
    assert ran["items"][0]["status"] == "succeeded"
    assert ran["items"][0]["access_grant_reference"] is not None


# ------------------------------------------------------------------------ reconciliation via API


def test_reconcile_unknown_item_via_api(api, meta_provider):
    from app.services.meta_provider import CreateAccountResult

    connection = make_connection(api)
    draft = api.post(
        "/api/v1/account-creation-batches",
        json={
            "meta_connection_id": connection["id"],
            "business_manager_external_id": "bm_1",
            "items": [{"name": "A", "currency": "VND"}],
        },
    ).json()
    api.post(
        f"/api/v1/account-creation-batches/{draft['batch']['id']}/confirm",
        json={"preview_hash": draft["current_preview_hash"]},
    )
    meta_provider.queue_create_result(CreateAccountResult(status="unknown", failure_code=MetaFailureCode.TIMEOUT))
    ran = api.post(f"/api/v1/account-creation-batches/{draft['batch']['id']}/run").json()
    item = ran["items"][0]
    assert item["status"] == "unknown"

    # The item's idempotency_key is an internal correlation detail, not returned in the API
    # payload — stage the reconciliation result against the one attempt the fake provider saw.
    idempotency_key = meta_provider.created[0].idempotency_key
    meta_provider.stage_reconcile_result(
        idempotency_key, CreateAccountResult(status="succeeded", external_account_id="fake_act_reconciled")
    )
    resolved = api.post(f"/api/v1/account-creation-batches/items/{item['id']}/reconcile").json()
    assert resolved["status"] == "succeeded"


# ------------------------------------------------------------------------ cross-workspace


def test_cross_workspace_connection_access_is_non_disclosing(api, other_auth, client):
    connection = make_connection(api)
    response = client.get(f"/api/v1/meta-connections/{connection['id']}", headers=other_auth)
    assert response.status_code == 404
