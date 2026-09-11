"""A10.1 API — read-only discovery endpoints, against a real PostgreSQL database.

These run through the fake provider. A real provider call from a test would mean CI reading
somebody's live Business Manager on every push.
"""
from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.services.meta_provider import DiscoveredAsset

BM = "1993884657458857"


@pytest.fixture()
def configured_bm():
    """`META_BUSINESS_ID` as the route reads it. Restored afterwards so one test cannot decide
    what the next one sees."""
    settings = get_settings()
    previous = settings.meta_business_id
    settings.meta_business_id = BM
    yield BM
    settings.meta_business_id = previous


@pytest.fixture()
def unconfigured_bm():
    """`META_BUSINESS_ID` explicitly absent.

    Set rather than assumed: `get_settings()` reads the developer's own `backend/.env`, so a
    test that merely hoped the variable was unset passed on one machine and failed on the next
    the moment somebody configured a real Business Manager. What is under test is the behaviour
    with no id, not the contents of anyone's env file.
    """
    settings = get_settings()
    previous = settings.meta_business_id
    settings.meta_business_id = ""
    yield
    settings.meta_business_id = previous


def make_connection(api, **overrides):
    payload = {"label": "Discovery connection", "environment": "fake"}
    payload.update(overrides)
    return api.post("/api/v1/meta-connections", json=payload).json()


def _seed(meta_provider, *, accounts=(), pixels=()):
    meta_provider.business_managers.append({"external_id": BM, "name": "Quảng Cáo Top"})
    meta_provider.discovered_ad_accounts.extend(accounts)
    meta_provider.discovered_pixels.extend(pixels)


# ------------------------------------------------------------------------------ running


def test_a_discovery_run_reports_coverage_alongside_the_count(api, meta_provider, configured_bm):
    """A count without coverage cannot be judged: four accounts from a complete scan and four
    from a scan that never read the client edge look identical."""
    _seed(
        meta_provider,
        accounts=[
            DiscoveredAsset("1167063825546698", "Tbsupellex", "owned_ad_accounts"),
            DiscoveredAsset("338551421414333", "Quàng Chính", "client_ad_accounts"),
        ],
        pixels=[DiscoveredAsset("555", "Pixel của TBsupellex", "adspixels")],
    )
    connection = make_connection(api)

    body = api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries").json()

    assert body["status"] == "succeeded"
    assert body["business_manager"] == {"reference": BM, "name": "Quảng Cáo Top"}
    assert body["ad_accounts"]["coverage_status"] == "complete"
    assert body["ad_accounts"]["complete"] is True
    assert body["ad_accounts"]["required_edges"] == ["owned_ad_accounts", "client_ad_accounts"]
    assert body["pixels"]["coverage_status"] == "complete"


def test_an_empty_registry_reports_every_discovered_asset_as_missing_in_registry(
    api, meta_provider, configured_bm
):
    """The first-run state, and it must read as "not imported yet" rather than as an error."""
    _seed(meta_provider, accounts=[DiscoveredAsset("777", "New account", "owned_ad_accounts")])
    connection = make_connection(api)

    body = api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries").json()
    rows = body["ad_accounts"]["reconciliation"]

    assert [row["status"] for row in rows] == ["missing_in_registry"]
    assert body["status"] == "succeeded"


def test_without_a_configured_business_id_the_run_fails_and_reads_no_assets(
    api, meta_provider, unconfigured_bm
):
    """`META_BUSINESS_ID` unset. Meta will not name the business behind a system user token, so
    there is nothing to discover and no call worth spending."""
    _seed(meta_provider, accounts=[DiscoveredAsset("777", "Unreachable", "owned_ad_accounts")])
    connection = make_connection(api)

    body = api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries").json()

    assert body["status"] == "failed"
    assert body["failure_code"] == "not_configured"
    assert body["ad_accounts"]["coverage_status"] == "not_attempted"
    assert body["ad_accounts"]["reconciliation"] == []


def test_the_payload_states_that_registry_pixel_absence_cannot_be_evaluated(
    api, meta_provider, configured_bm
):
    """Carried in the response rather than left for the UI to remember, because forgetting it
    would turn a schema limit into a false claim that a Pixel disappeared."""
    _seed(meta_provider, pixels=[DiscoveredAsset("555", "A pixel", "adspixels")])
    connection = make_connection(api)

    body = api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries").json()

    assert body["pixels"]["registry_absence_evaluable"] is False


def test_no_discovery_response_carries_anything_token_shaped(api, meta_provider, configured_bm):
    _seed(meta_provider, accounts=[DiscoveredAsset("777", "Account", "owned_ad_accounts")])
    connection = make_connection(api)

    raw = api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries").text

    for forbidden in ("access_token", "Bearer", "meta_access_token", "authorization"):
        assert forbidden not in raw


# ------------------------------------------------------------------------------ reading


def test_latest_is_null_before_anything_has_run(api, configured_bm):
    connection = make_connection(api)

    response = api.get(f"/api/v1/meta-connections/{connection['id']}/discoveries/latest")

    assert response.status_code == 200
    assert response.json() is None


def test_reading_the_latest_run_makes_no_provider_call(api, meta_provider, configured_bm):
    """Discovery costs rate-limit budget; opening a page must not."""
    _seed(meta_provider, accounts=[DiscoveredAsset("777", "Account", "owned_ad_accounts")])
    connection = make_connection(api)
    api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries")
    meta_provider.calls.clear()

    body = api.get(f"/api/v1/meta-connections/{connection['id']}/discoveries/latest").json()

    assert body["ad_accounts"]["coverage_status"] == "complete"
    assert meta_provider.calls == []


def test_a_connection_from_another_workspace_is_not_disclosed(api, client, other_owner):
    """Out of scope answers 404, never 403 — a 403 would confirm the id exists."""
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

    response = api.post(f"/api/v1/meta-connections/{theirs['id']}/discoveries")

    assert response.status_code == 404
