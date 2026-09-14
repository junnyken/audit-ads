"""O1.1 — the two read-only additions behind the connection discovery workspace.

Both exist because a fact was already stored and simply never reached the operator: which edge
produced an observation, and what every earlier run saw. Neither adds a column, a table, or a
provider call.
"""
from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.services.meta_provider import AssetDiscovery, DiscoveredAsset, EdgeOutcome

BM = "1993884657458857"


@pytest.fixture()
def configured_bm():
    settings = get_settings()
    previous = settings.meta_business_id
    settings.meta_business_id = BM
    yield BM
    settings.meta_business_id = previous


def make_connection(api, **overrides):
    payload = {"label": "Workspace connection", "environment": "fake"}
    payload.update(overrides)
    return api.post("/api/v1/meta-connections", json=payload).json()


def _seed(meta_provider, *, accounts=(), pixels=()):
    meta_provider.business_managers.append({"external_id": BM, "name": "Quảng Cáo Top"})
    meta_provider.discovered_ad_accounts.extend(accounts)
    meta_provider.discovered_pixels.extend(pixels)


# --------------------------------------------------------------- source_edge on the DTO


def test_a_discovered_account_carries_the_edge_that_produced_it(api, meta_provider, configured_bm):
    """The operator could already read this in prose — "Returned by owned_ad_accounts." — which a
    filter cannot use and a translation would quietly break. It is a field now."""
    _seed(
        meta_provider,
        accounts=[
            DiscoveredAsset("111", "Owned one", "owned_ad_accounts"),
            DiscoveredAsset("222", "Client one", "client_ad_accounts"),
        ],
    )
    connection = make_connection(api)

    body = api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries").json()
    by_id = {row["external_id"]: row for row in body["ad_accounts"]["reconciliation"]}

    assert by_id["111"]["source_edge"] == "owned_ad_accounts"
    assert by_id["222"]["source_edge"] == "client_ad_accounts"


def test_a_matched_account_keeps_its_edge_after_import(api, meta_provider, configured_bm):
    """Importing changes the reconciliation status, not where the account was seen. A row that
    lost its edge on import could never be filtered as client-shared again."""
    _seed(meta_provider, accounts=[DiscoveredAsset("333", "Client one", "client_ad_accounts")])
    connection = make_connection(api)
    run = api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries").json()
    api.post(
        f"/api/v1/meta-connections/{connection['id']}/discoveries/{run['id']}/imports",
        json={"external_account_id": "333"},
    )

    body = api.get(f"/api/v1/meta-connections/{connection['id']}/discoveries/latest").json()
    row = next(r for r in body["ad_accounts"]["reconciliation"] if r["external_id"] == "333")

    assert row["status"] == "matched"
    assert row["source_edge"] == "client_ad_accounts"


def test_a_pixel_row_carries_its_edge_too(api, meta_provider, configured_bm):
    _seed(meta_provider, pixels=[DiscoveredAsset("555", "A pixel", "adspixels")])
    connection = make_connection(api)

    body = api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries").json()
    row = body["pixels"]["reconciliation"][0]

    assert row["source_edge"] == "adspixels"


# ------------------------------------------------------------------- discovery history


def test_the_history_lists_every_run_newest_first(api, meta_provider, configured_bm):
    _seed(meta_provider, accounts=[DiscoveredAsset("111", "Account", "owned_ad_accounts")])
    connection = make_connection(api)
    for _ in range(3):
        api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries")

    body = api.get(f"/api/v1/meta-connections/{connection['id']}/discoveries").json()

    assert body["total"] == 3
    started = [row["started_at"] for row in body["items"]]
    assert started == sorted(started, reverse=True)


def test_the_history_paginates_with_this_project_s_own_convention(api, meta_provider, configured_bm):
    _seed(meta_provider, accounts=[DiscoveredAsset("111", "Account", "owned_ad_accounts")])
    connection = make_connection(api)
    for _ in range(3):
        api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries")

    body = api.get(f"/api/v1/meta-connections/{connection['id']}/discoveries?page=2&page_size=2").json()

    assert body["page"] == 2
    assert body["page_size"] == 2
    assert body["total"] == 3
    assert body["total_pages"] == 2
    assert len(body["items"]) == 1


def test_each_historical_run_keeps_its_own_coverage_and_authority(api, meta_provider, configured_bm):
    """A list that flattened runs into one status would hide exactly what history is for: a run
    that never attempted a required edge must not look like the complete one beside it."""
    meta_provider.business_managers.append({"external_id": BM, "name": "Quảng Cáo Top"})
    meta_provider.discovered_ad_accounts.append(
        DiscoveredAsset("111", "Account", "owned_ad_accounts")
    )
    connection = make_connection(api)
    api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries")

    meta_provider.queue_ad_account_discovery(
        AssetDiscovery(
            assets=(DiscoveredAsset("111", "Account", "owned_ad_accounts"),),
            edges=(EdgeOutcome("owned_ad_accounts", ok=True, pages_read=1, items=1),),
            required_edges=("owned_ad_accounts", "client_ad_accounts"),
        )
    )
    api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries")

    items = api.get(f"/api/v1/meta-connections/{connection['id']}/discoveries").json()["items"]
    newest, older = items[0], items[1]

    assert newest["ad_accounts"]["coverage_status"] == "incomplete"
    assert newest["ad_accounts"]["coverage"]["edges"]["client_ad_accounts"]["status"] == "not_attempted"
    assert older["ad_accounts"]["coverage_status"] == "complete"


def test_the_history_carries_no_reconciliation(api, meta_provider, configured_bm):
    """Reconciliation is recomputed against the registry as it is *now*. Pinning today's registry
    beside a week-old observation invites reading one as evidence about the other."""
    _seed(meta_provider, accounts=[DiscoveredAsset("111", "Account", "owned_ad_accounts")])
    connection = make_connection(api)
    api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries")

    row = api.get(f"/api/v1/meta-connections/{connection['id']}/discoveries").json()["items"][0]

    assert "reconciliation" not in row["ad_accounts"]
    assert "reconciliation" not in row["pixels"]


def test_reading_the_history_makes_no_provider_call(api, meta_provider, configured_bm):
    """Opening a page must never spend rate-limit budget on a real Business Manager."""
    _seed(meta_provider, accounts=[DiscoveredAsset("111", "Account", "owned_ad_accounts")])
    connection = make_connection(api)
    api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries")
    meta_provider.calls.clear()

    api.get(f"/api/v1/meta-connections/{connection['id']}/discoveries")

    assert meta_provider.calls == []


def test_the_history_never_carries_anything_token_shaped(api, meta_provider, configured_bm):
    _seed(meta_provider, accounts=[DiscoveredAsset("111", "Account", "owned_ad_accounts")])
    connection = make_connection(api)
    api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries")

    raw = api.get(f"/api/v1/meta-connections/{connection['id']}/discoveries").text

    for forbidden in ("access_token", "Bearer", "meta_access_token", "authorization"):
        assert forbidden not in raw


def test_another_workspaces_history_is_not_disclosed(api, client, other_owner, configured_bm):
    """Out of scope answers 404, never 403 — a 403 would confirm the connection exists."""
    login = client.post(
        "/api/v1/auth/login",
        json={"email": other_owner["user"].email, "password": other_owner["password"]},
    ).json()
    headers = {"Authorization": f"Bearer {login['access_token']}"}
    theirs = client.post(
        "/api/v1/meta-connections",
        json={"label": "Theirs", "environment": "fake"},
        headers=headers,
    ).json()

    response = api.get(f"/api/v1/meta-connections/{theirs['id']}/discoveries")

    assert response.status_code == 404


def test_a_connection_with_no_runs_returns_an_empty_page_not_an_error(api, configured_bm):
    """Today's actual state for a fresh connection. An empty history is a normal answer."""
    connection = make_connection(api)

    body = api.get(f"/api/v1/meta-connections/{connection['id']}/discoveries").json()

    assert body["items"] == []
    assert body["total"] == 0
