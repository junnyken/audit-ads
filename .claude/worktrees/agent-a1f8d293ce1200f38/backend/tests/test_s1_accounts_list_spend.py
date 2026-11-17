"""S1 follow-up — the compact `spend` object on `GET /ad-accounts`. Fake provider only."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy import event

from app.models.spend import AdAccountSpendObservation
from tests.s1_spend_helpers import good_read, make_account, make_bm, make_connection

BM = "1993884657458857"
STEADY = {1: "1600000", 2: "1000000"}


def _setup(api):
    bm = make_bm(api, BM)
    make_connection(api, bm_external_id=BM)
    return bm


def _item(api, account_id):
    items = api.get("/api/v1/ad-accounts?page_size=200").json()["items"]
    return next(i for i in items if i["id"] == account_id)


def test_list_carries_compact_spend_matching_the_detail_view(api, spend_env):
    bm = _setup(api)
    account = make_account(api, bm=bm, external_id="111")
    spend_env["provider"].queue_spend_result("111", good_read(STEADY))
    api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")

    spend = _item(api, account["id"])["spend"]
    detail = api.get(f"/api/v1/ad-accounts/{account['id']}/spend").json()

    assert set(spend) == {"freshness", "observed_currency", "latest_complete_day"}
    assert spend["freshness"] == detail["freshness"] == "current"
    assert spend["observed_currency"] == "VND"
    assert spend["latest_complete_day"] == {"date": detail["latest_complete_day"], "spend_raw": "1600000"}
    assert isinstance(spend["latest_complete_day"]["spend_raw"], str)


def test_states_are_not_merged_and_unobservable_is_distinct(api, spend_env):
    bm = _setup(api)
    never = make_account(api, bm=bm, external_id="222")
    nobody = make_account(api, bm=None, external_id="333")

    assert _item(api, never["id"])["spend"] == {
        "freshness": "never_observed", "observed_currency": None, "latest_complete_day": None,
    }
    assert _item(api, nobody["id"])["spend"]["freshness"] == "not_observable"


def test_stale_uses_the_same_rule_as_the_detail_view(api, db_session, spend_env):
    bm = _setup(api)
    account = make_account(api, bm=bm, external_id="444")
    spend_env["provider"].queue_spend_result("444", good_read(STEADY))
    api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")
    old = datetime.now(UTC) - timedelta(days=5)
    db_session.execute(sa.update(AdAccountSpendObservation).values(observed_at=old))
    db_session.commit()

    assert _item(api, account["id"])["spend"]["freshness"] == "stale"
    assert api.get(f"/api/v1/ad-accounts/{account['id']}/spend").json()["freshness"] == "stale"


def test_day_without_a_row_is_null_never_zero(api, spend_env):
    bm = _setup(api)
    account = make_account(api, bm=bm, external_id="555")
    spend_env["provider"].queue_spend_result("555", good_read({3: "30"}))  # yesterday has no row
    api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")

    day = _item(api, account["id"])["spend"]["latest_complete_day"]

    assert day is not None and day["spend_raw"] is None


def test_failed_latest_read_does_not_hide_the_last_success(api, spend_env):
    from app.services.meta_provider import MetaFailureCode, SpendRead

    bm = _setup(api)
    account = make_account(api, bm=bm, external_id="666")
    spend_env["provider"].queue_spend_result("666", good_read(STEADY))
    api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")
    spend_env["provider"].queue_spend_result(
        "666", SpendRead(ok=False, failure_code=MetaFailureCode.TOKEN_EXPIRED, failure_summary="x")
    )
    api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")

    spend = _item(api, account["id"])["spend"]
    assert spend["latest_complete_day"]["spend_raw"] == "1600000"


def test_listing_contacts_no_provider(api, spend_env):
    bm = _setup(api)
    make_account(api, bm=bm, external_id="777")

    api.get("/api/v1/ad-accounts")

    assert spend_env["provider"].calls == []
    assert spend_env["built"] == []


def test_query_count_does_not_grow_with_the_number_of_accounts(api, db_session, spend_env):
    bm = _setup(api)

    def count_for_list() -> int:
        queries = 0

        def counter(*_a, **_k):
            nonlocal queries
            queries += 1

        engine = db_session.get_bind()
        event.listen(engine, "before_cursor_execute", counter)
        try:
            assert api.get("/api/v1/ad-accounts?page_size=200").status_code == 200
        finally:
            event.remove(engine, "before_cursor_execute", counter)
        return queries

    def add(n, start):
        for i in range(n):
            ext = f"9{start + i:05d}"
            account = make_account(api, bm=bm, external_id=ext)
            spend_env["provider"].queue_spend_result(ext, good_read(STEADY))
            api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")

    add(2, 0)
    small = count_for_list()
    add(10, 100)
    large = count_for_list()

    print(f"\n[S1 accounts list] 2 accounts: {small} queries | 12 accounts: {large} queries")
    assert large == small, f"query count grew with accounts: {small} -> {large}"
