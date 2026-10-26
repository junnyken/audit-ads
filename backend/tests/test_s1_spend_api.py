"""S1 — the spend API. Fake provider through the one seam; nothing here reaches Meta."""
from __future__ import annotations

import sqlalchemy as sa

from app.core.enums import WorkspaceRole
from app.core.security import hash_password
from app.models.entities import AuditLog, User, WorkspaceMember
from app.models.spend import AdAccountSpendObservation
from app.services.meta_provider import MetaFailureCode, SpendRead
from tests.conftest import login
from tests.s1_spend_helpers import (
    good_read,
    make_account,
    make_bm,
    make_connection,
)

BM = "1993884657458857"
STEADY = {1: "1600000", 2: "1000000", 3: "1000000", 4: "1000000", 5: "1000000", 6: "1000000", 7: "1000000"}


def setup_account(api, external_id="123456789", currency="VND", connection=True):
    bms = {bm["external_id"]: bm for bm in api.get("/api/v1/business-managers").json()["items"]}
    bm = bms.get(BM) or make_bm(api, BM)
    if connection and not api.get("/api/v1/meta-connections").json():
        make_connection(api, bm_external_id=BM)
    return make_account(api, bm=bm, external_id=external_id, currency=currency)


def reads(provider) -> int:
    return sum(1 for name, _ in provider.calls if name == "read_account_spend")


def member(client, db_session, owner, role: WorkspaceRole, email: str):
    user = User(email=email, full_name=email, password_hash=hash_password("correct-horse-battery"), is_active=True)
    db_session.add(user)
    db_session.flush()
    db_session.add(WorkspaceMember(workspace_id=owner["workspace"].id, user_id=user.id, role=role))
    db_session.commit()
    return login(client, email, "correct-horse-battery")


# --------------------------------------------------------------------------- reads


def test_get_spend_for_an_unreadable_account_is_not_observable_and_calls_nothing(api, spend_env):
    account = make_account(api, bm=None, external_id="123", currency="VND")

    body = api.get(f"/api/v1/ad-accounts/{account['id']}/spend").json()

    assert body["freshness"] == "not_observable"
    assert body["observable"] is False
    assert body["latest_observation"] is None and body["daily"] == []
    assert body["disclaimer"].startswith("Chi tiêu là số Meta trả về")
    assert reads(spend_env["provider"]) == 0


def test_get_spend_never_observed_then_current_after_refresh(api, spend_env):
    account = setup_account(api)
    assert api.get(f"/api/v1/ad-accounts/{account['id']}/spend").json()["freshness"] == "never_observed"
    spend_env["provider"].queue_spend_result(
        "123456789", good_read({0: "77", **STEADY}, amount_spent="123456700", spend_cap="200000000")
    )

    body = api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh").json()

    assert body["freshness"] == "current"
    assert body["reader_source"] == "server_default"
    latest = body["latest_observation"]
    assert latest["amount_spent_raw"] == "123456700" and isinstance(latest["amount_spent_raw"], str)
    assert latest["spend_cap_raw"] == "200000000"
    assert latest["trigger"] == "manual_refresh"
    assert [d["spend_raw"] for d in body["daily"]][:2] == ["1600000", "1000000"]
    assert all(isinstance(d["spend_raw"], str) for d in body["daily"])
    assert body["today_partial"]["spend_raw"] == "77"
    assert body["today_partial"]["label"] == "incomplete_day"
    assert body["baseline"]["median_raw"] == "1000000"
    assert len(body["baseline"]["days_used"]) == 6
    # GET afterwards answers from storage alone.
    before = reads(spend_env["provider"])
    again = api.get(f"/api/v1/ad-accounts/{account['id']}/spend").json()
    assert again["latest_observation"]["id"] == latest["id"]
    assert reads(spend_env["provider"]) == before


def test_days_without_a_row_are_listed_apart_never_as_zero(api, spend_env):
    account = setup_account(api)
    spend_env["provider"].queue_spend_result("123456789", good_read({1: "10", 3: "30"}))

    body = api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh").json()

    assert [d["spend_raw"] for d in body["daily"]] == ["10", "30"]
    assert len(body["days_without_row"]) >= 1
    assert "0" not in [d["spend_raw"] for d in body["daily"]]


def test_observations_list_includes_failed_reads_with_their_code(api, spend_env):
    account = setup_account(api)
    spend_env["provider"].queue_spend_result(
        "123456789", SpendRead(ok=False, failure_code=MetaFailureCode.TOKEN_EXPIRED, failure_summary="Expired.")
    )
    api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")
    spend_env["provider"].queue_spend_result("123456789", good_read({1: "5"}))
    api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")

    page = api.get(f"/api/v1/ad-accounts/{account['id']}/spend/observations").json()

    assert page["total"] == 2
    assert [item["status"] for item in page["items"]] == ["succeeded", "failed"]
    assert page["items"][1]["failure_code"] == "token_expired"
    assert page["items"][1]["daily"] == []
    body = api.get(f"/api/v1/ad-accounts/{account['id']}/spend").json()
    assert body["latest_attempt"]["status"] == "succeeded"


# ------------------------------------------------------------------------- refresh


def test_refresh_reads_exactly_once_and_audits_with_the_real_actor(api, db_session, owner, spend_env):
    account = setup_account(api)
    spend_env["provider"].queue_spend_result("123456789", good_read({1: "5"}))

    response = api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")

    assert response.status_code == 200, response.text
    assert reads(spend_env["provider"]) == 1
    [audit] = db_session.execute(
        sa.select(AuditLog).where(AuditLog.action == "spend.observation_refreshed")
    ).scalars().all()
    assert audit.actor_id == owner["user"].id
    observation = db_session.execute(sa.select(AdAccountSpendObservation)).scalars().one()
    assert audit.entity_id == str(observation.id)
    assert "token" not in str(audit.after_json).lower()


def test_refresh_is_owner_only(client, db_session, owner, api, spend_env):
    account = setup_account(api)
    for role, email in ((WorkspaceRole.ADMIN, "admin@example.com"), (WorkspaceRole.VIEWER, "viewer@example.com")):
        headers = member(client, db_session, owner, role, email)
        response = client.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh", headers=headers)
        assert response.status_code == 403, (role, response.text)
    assert reads(spend_env["provider"]) == 0


def test_refresh_of_an_unreadable_account_is_refused_without_a_call(api, spend_env):
    account = make_account(api, bm=None, external_id="123")
    response = api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")
    assert response.status_code == 409
    assert reads(spend_env["provider"]) == 0


def test_refresh_of_an_archived_account_is_refused(api, spend_env):
    account = setup_account(api)
    api.post(f"/api/v1/ad-accounts/{account['id']}/archive")
    response = api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")
    assert response.status_code == 409 and response.json()["error"]["code"] == "entity_archived"
    assert reads(spend_env["provider"]) == 0


def test_refresh_reevaluates_health_from_the_stored_read(api, spend_env):
    account = setup_account(api)
    spend_env["provider"].queue_spend_result("123456789", good_read(STEADY))

    api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")

    signals = api.get(f"/api/v1/ad-accounts/{account['id']}/health/signals").json()
    items = signals["items"] if isinstance(signals, dict) else signals
    keys = {s["rule_key"] for s in items}
    assert "spend_change_vs_baseline" in keys
    [change] = [s for s in items if s["rule_key"] == "spend_change_vs_baseline"]
    assert change["category"] == "spend" and change["source_type"] == "provider_observation"
    # Recalculating afterwards contacts no platform.
    before = reads(spend_env["provider"])
    api.post(f"/api/v1/ad-accounts/{account['id']}/health/recalculate")
    assert reads(spend_env["provider"]) == before


# ----------------------------------------------------------------------- authorization


def test_another_workspace_gets_404_everywhere(client, api, other_auth, spend_env):
    account = setup_account(api)
    for method, path in (
        ("get", f"/api/v1/ad-accounts/{account['id']}/spend"),
        ("get", f"/api/v1/ad-accounts/{account['id']}/spend/observations"),
        ("post", f"/api/v1/ad-accounts/{account['id']}/spend/refresh"),
    ):
        response = getattr(client, method)(path, headers=other_auth)
        assert response.status_code == 404, (path, response.status_code)
    summary = client.get("/api/v1/spend/summary", headers=other_auth).json()
    assert summary["total_accounts"] == 0
    assert reads(spend_env["provider"]) == 0


def test_a_member_outside_the_accounts_scope_gets_404(client, db_session, owner, api, spend_env):
    account = setup_account(api)
    headers = member(client, db_session, owner, WorkspaceRole.BUYER, "buyer@example.com")
    assert client.get(f"/api/v1/ad-accounts/{account['id']}/spend", headers=headers).status_code == 404
    assert client.get("/api/v1/spend/summary", headers=headers).json()["total_accounts"] == 0


def test_an_unauthenticated_caller_cannot_reach_spend(client, api, spend_env):
    account = setup_account(api)
    response = client.get(
        f"/api/v1/ad-accounts/{account['id']}/spend", headers={"Authorization": "Bearer not-a-token"}
    )
    assert response.status_code == 401


# --------------------------------------------------------------------------- summary


def test_summary_groups_by_currency_and_never_sums_across(api, spend_env):
    vnd_a = setup_account(api, external_id="101", currency="VND")
    vnd_b = setup_account(api, external_id="102", currency="VND")
    usd = setup_account(api, external_id="201", currency="USD")
    setup_account(api, external_id="301", currency="VND")  # never observed
    make_account(api, bm=None, external_id="401")  # not observable
    provider = spend_env["provider"]
    provider.queue_spend_result("101", good_read({1: "1000.5"}))
    provider.queue_spend_result("102", good_read({1: "2000"}))
    provider.queue_spend_result("201", good_read({1: "12.25"}, currency="USD"))
    for account in (vnd_a, vnd_b, usd):
        api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")

    body = api.get("/api/v1/spend/summary").json()

    assert body["freshness_counts"] == {
        "current": 3, "stale": 0, "never_observed": 1, "not_observable": 1,
    }
    by_currency = {group["currency"]: group for group in body["currencies"]}
    assert set(by_currency) == {"VND", "USD"}
    assert by_currency["VND"]["total_raw"] == "3000.5"
    assert by_currency["VND"]["accounts_included"] == 2
    assert by_currency["USD"]["total_raw"] == "12.25"
    assert body["accounts_unattributed"] == 2
    assert body["complete"] is False
    for forbidden in ("total", "grand_total", "total_raw", "sum"):
        assert forbidden not in body, forbidden


def test_a_group_missing_an_account_is_marked_incomplete(api, spend_env):
    with_row = setup_account(api, external_id="101")
    without_row = setup_account(api, external_id="102")
    spend_env["provider"].queue_spend_result("101", good_read({1: "10"}))
    spend_env["provider"].queue_spend_result("102", good_read({3: "10"}))  # no row for yesterday
    for account in (with_row, without_row):
        api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")

    [group] = api.get("/api/v1/spend/summary").json()["currencies"]

    assert group["total_raw"] == "10"
    assert group["accounts_included"] == 1
    assert group["accounts_without_row"] == 1
    assert group["complete"] is False


def test_summary_and_payloads_never_mention_funding(api, spend_env):
    account = setup_account(api)
    spend_env["provider"].queue_spend_result("123456789", good_read({1: "10"}))
    api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")
    for path in (
        f"/api/v1/ad-accounts/{account['id']}/spend",
        f"/api/v1/ad-accounts/{account['id']}/spend/observations",
        "/api/v1/spend/summary",
    ):
        text = api.get(path).text.lower()
        assert "funding" not in text and "placeholder-reader" not in text, path


def test_stored_daily_rows_pass_through_the_redactor(api, db_session, spend_env):
    """`daily_json` is built from allowlisted fields; the redactor is the second gate in case a
    provider ever hands back something credential-shaped in one of them."""
    from app.services.meta_provider import DailySpend

    account = setup_account(api)
    read = good_read({1: "10"})
    poisoned = SpendRead(
        **{**read.__dict__, "daily": (DailySpend("2026-10-01", "2026-10-01", "Bearer abcdef", "VND"),)}
    )
    spend_env["provider"].queue_spend_result("123456789", poisoned)

    api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")

    row = db_session.execute(sa.select(AdAccountSpendObservation)).scalars().one()
    assert "abcdef" not in str(row.daily_json)
