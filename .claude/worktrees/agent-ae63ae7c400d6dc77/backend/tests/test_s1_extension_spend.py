"""S1 in the extension summary: a compact, read-only `spend` block (no Meta call, no new route).

Run alone and never in parallel with another pytest process: it shares the test database.
"""
from __future__ import annotations

from tests.s1_spend_helpers import good_read, make_account
from tests.test_a5_extension_api import ext_headers
from tests.test_s1_spend_api import STEADY, reads, setup_account


def ext_summary(client, auth, account_id):
    headers = ext_headers(client, auth)
    response = client.get(f"/api/v1/extension/accounts/{account_id}/summary", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["spend"], headers


def test_unreadable_account_is_not_observable_and_has_no_amounts(client, auth, api, spend_env):
    account = make_account(api, bm=None, external_id="123456789", currency="VND")

    spend, _ = ext_summary(client, auth, account["id"])

    assert spend["freshness"] == "not_observable" and spend["observable"] is False
    assert spend["latest_complete_day"] is None and spend["today_partial"] is None
    assert spend["currency"] is None and spend["observed_at"] is None
    assert spend["signal_open"] is False
    assert reads(spend_env["provider"]) == 0


def test_never_observed_is_distinct_from_not_observable(client, auth, api, spend_env):
    account = setup_account(api)

    spend, _ = ext_summary(client, auth, account["id"])

    assert spend["freshness"] == "never_observed" and spend["observable"] is True
    assert spend["latest_complete_day"] is None and spend["today_partial"] is None
    assert reads(spend_env["provider"]) == 0


def test_current_summary_carries_raw_strings_and_an_open_spend_signal(client, auth, api, spend_env):
    account = setup_account(api)
    spend_env["provider"].queue_spend_result("123456789", good_read({0: "77", **STEADY}))
    api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")
    before = reads(spend_env["provider"])

    spend, _ = ext_summary(client, auth, account["id"])

    assert spend["freshness"] == "current" and spend["currency"] == "VND"
    assert spend["latest_complete_day"]["spend_raw"] == "1600000"
    assert isinstance(spend["latest_complete_day"]["spend_raw"], str)
    assert spend["today_partial"]["spend_raw"] == "77"
    assert spend["today_partial"]["label"] == "incomplete_day"
    assert spend["signal_open"] is True  # spend_change_vs_baseline, as in the dashboard test
    assert reads(spend_env["provider"]) == before  # the extension path never calls Meta


def test_a_day_without_a_row_is_null_never_zero(client, auth, api, spend_env):
    account = setup_account(api)
    spend_env["provider"].queue_spend_result("123456789", good_read({3: "30"}))
    api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")

    spend, _ = ext_summary(client, auth, account["id"])

    day = spend["latest_complete_day"]
    assert day is not None and day["spend_raw"] is None
    assert spend["today_partial"] is None


def test_context_resolve_includes_the_same_block(client, auth, api, spend_env):
    account = setup_account(api)
    spend_env["provider"].queue_spend_result("123456789", good_read(STEADY))
    api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")
    headers = ext_headers(client, auth)

    body = client.post(
        "/api/v1/extension/context/resolve",
        json={"external_account_id": "123456789", "safe_path": "/adsmanager/manage/campaigns"},
        headers=headers,
    ).json()

    assert body["context_status"] == "confirmed"
    assert body["spend"]["freshness"] == "current"


def test_dashboard_twin_includes_spend(api, spend_env):
    account = setup_account(api)

    body = api.get(f"/api/v1/ad-accounts/{account['id']}/extension-summary").json()

    assert body["spend"]["freshness"] == "never_observed"


def test_extension_token_is_refused_by_every_dashboard_spend_route(client, auth, api, spend_env):
    account = setup_account(api)
    headers = ext_headers(client, auth)
    base = f"/api/v1/ad-accounts/{account['id']}"

    for method, path in (
        ("get", f"{base}/spend"),
        ("get", f"{base}/spend/observations"),
        ("post", f"{base}/spend/refresh"),
        ("get", "/api/v1/spend/summary"),
    ):
        response = getattr(client, method)(path, headers=headers)
        assert response.status_code == 401, (path, response.status_code)
    assert reads(spend_env["provider"]) == 0


def test_foreign_and_unauthenticated_callers_get_no_spend(client, auth, api, other_auth, spend_env):
    account = setup_account(api)
    headers = ext_headers(client, auth)

    assert client.get(f"/api/v1/extension/accounts/{account['id']}/summary").status_code == 401
    foreign = client.get(
        f"/api/v1/ad-accounts/{account['id']}/extension-summary", headers=other_auth
    )
    assert foreign.status_code == 404
    assert "spend" not in foreign.text
    assert client.get(f"/api/v1/extension/accounts/{account['id']}/summary", headers=headers).status_code == 200
