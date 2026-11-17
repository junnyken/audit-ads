"""Where an imported account came from, and the sentence that used to deny it.

`OverviewTab` told every never-synced account that "A1 stores operator-entered records only —
nothing here was fetched from a platform". That was true when A1 shipped and became false when
A10.3's registry import shipped: an imported account's name and external id come from Meta's
`owned_ad_accounts` edge. The first half — never synced — stayed true, which is exactly why the
false half survived review.

Provenance is derived from the audit row rather than stored: `ad_accounts` has no origin column,
and rule 3 already guarantees the import wrote its audit row in the same transaction.
"""
from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.services.meta_provider import DiscoveredAsset

BM = "1993884657458857"


@pytest.fixture()
def configured_bm():
    settings = get_settings()
    previous = settings.meta_business_id
    settings.meta_business_id = BM
    yield BM
    settings.meta_business_id = previous


def _import_one(api, meta_provider, external_id="111", edge="owned_ad_accounts"):
    meta_provider.business_managers.append({"external_id": BM, "name": "Quảng Cáo Top"})
    meta_provider.discovered_ad_accounts.append(DiscoveredAsset(external_id, "Imported", edge))
    connection = api.post(
        "/api/v1/meta-connections", json={"label": "Conn", "environment": "fake"}
    ).json()
    run = api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries").json()
    imported = api.post(
        f"/api/v1/meta-connections/{connection['id']}/discoveries/{run['id']}/imports",
        json={"external_account_id": external_id},
    )
    assert imported.status_code == 201, imported.text
    # The import response names the account `ad_account_id`, not `id` — it describes an import,
    # not an account. Assuming `id` is what made four of these tests fail on their first run.
    return {"id": imported.json()["ad_account_id"]}, run


def test_an_imported_account_reports_where_it_came_from(api, meta_provider, configured_bm):
    account, run = _import_one(api, meta_provider)

    detail = api.get(f"/api/v1/ad-accounts/{account['id']}").json()

    provenance = detail["imported_from_discovery"]
    assert provenance is not None
    assert provenance["discovery_run_id"] == run["id"]
    assert provenance["business_manager_reference"] == BM
    assert provenance["source_edge"] == "owned_ad_accounts"
    assert provenance["imported_at"]


def test_a_client_shared_account_keeps_its_own_edge(api, meta_provider, configured_bm):
    account, _ = _import_one(api, meta_provider, external_id="222", edge="client_ad_accounts")

    detail = api.get(f"/api/v1/ad-accounts/{account['id']}").json()

    assert detail["imported_from_discovery"]["source_edge"] == "client_ad_accounts"


def test_a_hand_typed_account_claims_no_provenance(api):
    """Null, not an empty object: "nobody imported this" is a different fact from "imported, details
    unknown", and the UI says different things for each."""
    account = api.post("/api/v1/ad-accounts", json={"display_name": "Typed by hand"}).json()

    detail = api.get(f"/api/v1/ad-accounts/{account['id']}").json()

    assert detail["imported_from_discovery"] is None


def test_the_list_endpoint_does_not_carry_it(api, meta_provider, configured_bm):
    """Detail only. One audit lookup per row would be N+1 on a page of two hundred accounts, and
    the list has no use for it."""
    _import_one(api, meta_provider)

    listed = api.get("/api/v1/ad-accounts").json()

    assert listed["items"]
    for item in listed["items"]:
        assert "imported_from_discovery" not in item


def test_provenance_carries_nothing_secret(api, meta_provider, configured_bm):
    account, _ = _import_one(api, meta_provider)

    raw = api.get(f"/api/v1/ad-accounts/{account['id']}").text

    for forbidden in ("access_token", "Bearer", "authorization", "password"):
        assert forbidden not in raw


def test_another_workspace_cannot_read_it(api, client, other_owner, meta_provider, configured_bm):
    account, _ = _import_one(api, meta_provider)
    login = client.post(
        "/api/v1/auth/login",
        json={"email": other_owner["user"].email, "password": other_owner["password"]},
    ).json()

    response = client.get(
        f"/api/v1/ad-accounts/{account['id']}",
        headers={"Authorization": f"Bearer {login['access_token']}"},
    )

    assert response.status_code == 404
