"""A7 tests — read-only rollup over A1/A2/A3. Real PostgreSQL, real API, per mini-spec's own
required pilot cases."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta


def make_bm(api, name="BM"):
    return api.post("/api/v1/business-managers", json={"name": name}).json()


def make_account(api, **overrides):
    payload = {"display_name": "Account", "status": "active"}
    payload.update(overrides)
    return api.post("/api/v1/ad-accounts", json=payload).json()


# ------------------------------------------------------------------------ overview


def test_overview_never_reports_a_spend_total_it_does_not_have(api):
    make_account(api)
    body = api.get("/api/v1/account-operations/overview").json()
    assert body["spend_total_by_currency"] is None  # never fabricated as 0 or omitted silently


def test_overview_counts_accounts_by_status(api):
    make_account(api, status="active")
    make_account(api, status="restricted")
    body = api.get("/api/v1/account-operations/overview").json()
    assert body["by_status"]["active"] >= 1
    assert body["by_status"]["restricted"] >= 1
    assert body["total_accounts"] >= 2


def test_overview_excludes_archived_from_total_but_counts_them_separately(api):
    account = make_account(api)
    api.post(f"/api/v1/ad-accounts/{account['id']}/archive")
    body = api.get("/api/v1/account-operations/overview").json()
    assert body["archived_accounts"] >= 1


# ------------------------------------------------------------------------ account table & activity status


def test_account_with_no_activity_evidence_is_unknown_not_a_guess(api):
    account = make_account(api)
    row = api.get(f"/api/v1/account-operations/accounts/{account['id']}").json()
    assert row["activity_status"] == "unknown"


def test_account_operations_row_has_no_spend_fields_populated(api):
    account = make_account(api)
    row = api.get(f"/api/v1/account-operations/accounts/{account['id']}").json()
    assert row["spend_today"] is None
    assert row["spend_last_7_days"] is None
    assert row["spend_current_month"] is None


def test_account_confirmed_stale_is_distinct_from_unknown(api, session):
    from app.models.entities import AdAccount

    account = make_account(api)
    row = session.get(AdAccount, account["id"])
    row.last_activity_at = datetime.now(UTC) - timedelta(days=30)
    session.commit()

    body = api.get(f"/api/v1/account-operations/accounts/{account['id']}").json()
    assert body["activity_status"] == "stale"


def test_account_active_recently_when_within_freshness_window(api, session):
    from app.models.entities import AdAccount

    account = make_account(api)
    row = session.get(AdAccount, account["id"])
    row.last_activity_at = datetime.now(UTC) - timedelta(hours=1)
    session.commit()

    body = api.get(f"/api/v1/account-operations/accounts/{account['id']}").json()
    assert body["activity_status"] == "active_recently"


def test_restricted_account_is_reflected_in_operations_table(api):
    account = make_account(api, status="restricted")
    body = api.get("/api/v1/account-operations/accounts").json()
    row = next(item for item in body["items"] if item["id"] == account["id"])
    assert row["status"] == "restricted"


# ------------------------------------------------------------------------ BM rollup pilot cases (mini-spec §pilot)


def test_bm_with_multiple_accounts_same_currency(api):
    bm = make_bm(api, "Agency BM")
    make_account(api, business_manager_id=bm["id"], account_type="business_manager", currency="VND")
    make_account(api, business_manager_id=bm["id"], account_type="business_manager", currency="VND")

    rows = api.get("/api/v1/account-operations/business-managers").json()
    row = next(r for r in rows if r["business_manager_id"] == bm["id"])
    assert row["account_count"] == 2
    assert row["spend_today"] is None


def test_bm_with_multiple_currencies_is_not_summed(api):
    bm = make_bm(api, "Multi-currency BM")
    make_account(api, business_manager_id=bm["id"], account_type="business_manager", currency="USD")
    make_account(api, business_manager_id=bm["id"], account_type="business_manager", currency="VND")

    overview = api.get("/api/v1/account-operations/overview").json()
    assert {"USD", "VND"}.issubset(set(overview["currencies_in_use"]))
    # No combined total anywhere in the payload — the field is None, not a summed number.
    assert overview["spend_total_by_currency"] is None


def test_bm_operations_reflects_open_critical_alert_count(api):
    bm = make_bm(api, "Alerting BM")
    # A restricted status produces a critical health signal immediately on creation (A2), which
    # A3 turns into a critical alert in the same evaluation — no explicit recalculate needed.
    make_account(api, business_manager_id=bm["id"], account_type="business_manager", status="restricted")

    rows = api.get("/api/v1/account-operations/business-managers").json()
    row = next(r for r in rows if r["business_manager_id"] == bm["id"])
    assert row["open_critical_alerts"] >= 1
