"""A10.3 — a Business Manager per Meta connection.

Before this, every connection read `META_BUSINESS_ID`. Creating a connection named after a second
business did not make it read that business: it read the configured one and listed its accounts
under the other one's name. Observed live on 2026-09-11 with two connections labelled "Triều Shop"
and "Quảng Cáo Top", both returning the same eight accounts.

The token axis is deliberately untouched. Whether one system-user token can read a second Business
Manager's assets is still unanswered (see `docs/AUDIT_BEFORE_BUILD_A10_3.md` §4), and a per-BM
token could never live in the database anyway — hard rule 1. Storing which BM to read is common to
both designs, which is why it could be built before that question was settled.
"""
from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.services.meta_provider import DiscoveredAsset

SERVER_BM = "1993884657458857"
OTHER_BM = "109796697343603"


@pytest.fixture()
def configured_bm():
    settings = get_settings()
    previous = settings.meta_business_id
    settings.meta_business_id = SERVER_BM
    yield SERVER_BM
    settings.meta_business_id = previous


def make_connection(api, **overrides):
    payload = {"label": "Connection", "environment": "fake"}
    payload.update(overrides)
    return api.post("/api/v1/meta-connections", json=payload).json()


def test_a_connection_without_a_reference_still_reads_the_server_setting(api, configured_bm):
    """Every connection created before this column did exactly this, and must keep doing it."""
    connection = make_connection(api)

    assert connection["business_manager_reference"] == SERVER_BM
    assert connection["business_manager_source"] == "server"


def test_a_connection_reads_the_business_manager_it_names(api, meta_provider, configured_bm):
    """The defect this closes: a connection named after one business reading another's accounts."""
    meta_provider.business_managers.append({"external_id": OTHER_BM, "name": "Triều Shop"})
    meta_provider.discovered_ad_accounts.append(
        DiscoveredAsset("999", "Triều Shop account", "owned_ad_accounts")
    )
    connection = make_connection(api, label="Triều Shop", business_manager_reference=OTHER_BM)

    assert connection["business_manager_source"] == "connection"
    body = api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries").json()

    assert body["business_manager"] == {"reference": OTHER_BM, "name": "Triều Shop"}


def test_two_connections_read_two_different_business_managers(api, meta_provider, configured_bm):
    """The whole point, and the case that could not be expressed at all before: same workspace,
    same token, two Business Managers, two separate inventories."""
    meta_provider.business_managers.extend(
        [
            {"external_id": SERVER_BM, "name": "Quảng Cáo Top"},
            {"external_id": OTHER_BM, "name": "Triều Shop"},
        ]
    )
    meta_provider.discovered_ad_accounts.append(
        DiscoveredAsset("111", "An account", "owned_ad_accounts")
    )
    first = make_connection(api, label="Quảng Cáo Top")
    second = make_connection(api, label="Triều Shop", business_manager_reference=OTHER_BM)

    api.post(f"/api/v1/meta-connections/{first['id']}/discoveries")
    api.post(f"/api/v1/meta-connections/{second['id']}/discoveries")
    rows = api.get("/api/v1/meta-connections/discovery-summary").json()

    by_connection = {row["connection_id"]: row["run"]["business_manager"]["reference"] for row in rows}
    assert by_connection[first["id"]] == SERVER_BM
    assert by_connection[second["id"]] == OTHER_BM


def test_a_business_manager_the_provider_does_not_return_fails_the_run(
    api, meta_provider, configured_bm
):
    """Naming a Business Manager does not make it readable. The run refuses rather than
    attributing whatever the provider happened to return to the id that was asked for."""
    meta_provider.business_managers.append({"external_id": SERVER_BM, "name": "Quảng Cáo Top"})
    connection = make_connection(api, label="Somewhere else", business_manager_reference=OTHER_BM)

    body = api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries").json()

    assert body["status"] == "failed"
    assert body["failure_code"] == "not_configured"
    assert body["ad_accounts"]["coverage_status"] == "not_attempted"


def test_the_reference_is_not_treated_as_a_secret_but_the_token_still_is(api, configured_bm):
    """A BM id is visible in Business Settings, so it is an ordinary field. `StrictPayload` refuses
    by field *name*, and this one must not trip it — while nothing token-shaped appears anywhere."""
    response = api.post(
        "/api/v1/meta-connections",
        json={"label": "Named", "environment": "fake", "business_manager_reference": OTHER_BM},
    )

    assert response.status_code == 201
    for forbidden in ("access_token", "Bearer", "meta_access_token"):
        assert forbidden not in response.text


def test_whitespace_around_a_reference_does_not_create_a_second_business_manager(
    api, meta_provider, configured_bm
):
    """A pasted id carries trailing whitespace more often than not, and an untrimmed one would
    never match the provider's answer — failing every run for a reason nobody could see."""
    meta_provider.business_managers.append({"external_id": OTHER_BM, "name": "Triều Shop"})
    connection = make_connection(api, business_manager_reference=f"  {OTHER_BM}  ")

    assert connection["business_manager_reference"] == OTHER_BM
    body = api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries").json()
    assert body["status"] == "succeeded"
