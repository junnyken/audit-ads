"""S2 — the platform-status blocks on existing payloads. Fake provider only; no GET calls Meta."""
from __future__ import annotations

import re
from dataclasses import replace
from datetime import UTC, datetime

import sqlalchemy as sa

from app.core.enums import WorkspaceRole
from app.models.entities import User, WorkspaceMember
from app.models.team import MemberAdAccountAssignment
from app.services.meta_provider import MetaFailureCode, SpendRead
from tests.s1_spend_helpers import good_read, make_account, make_bm, make_connection
from tests.test_s1_spend_api import member

BM = "1993884657458857"
STEADY = {1: "1600000", 2: "1000000"}
COMPACT_KEYS = {"status", "account_status_raw", "freshness", "observed_at"}
FULL_KEYS = {
    "status", "status_class", "account_status_raw", "disable_reason", "disable_reason_raw",
    "observed_at", "observation_id", "observation_status", "failure_code", "reader_source",
    "freshness", "previous", "since_observed_at", "disclaimer",
}
AFFIRMATIVE = re.compile(
    r"\b(is safe|are safe|safe account|protected from|unbanned|is approved|will be approved|immune"
    r"|cannot be restricted|not restricted|will be reopened|recovered|restored|an toàn"
    r"|không bị khoá|sẽ được mở lại)\b",
    re.IGNORECASE,
)


def read(status: str | None, reason: str | None = "0") -> SpendRead:
    return replace(good_read(STEADY), account_status_raw=status, disable_reason_raw=reason)


def setup(api, ext="8001", bm=True):
    bms = {b["external_id"]: b for b in api.get("/api/v1/business-managers").json()["items"]}
    record = bms.get(BM) or make_bm(api, BM)
    if not api.get("/api/v1/meta-connections").json():
        make_connection(api, bm_external_id=BM)
    return make_account(api, bm=record if bm else None, external_id=ext)


def refresh(api, spend_env, account, result, ext="8001"):
    spend_env["provider"].queue_spend_result(ext, result)
    response = api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")
    assert response.status_code == 200, response.text
    return response.json()


def list_item(api, account_id):
    items = api.get("/api/v1/ad-accounts?page_size=200").json()["items"]
    return next(i for i in items if i["id"] == account_id)


def provider_reads(provider) -> int:
    return sum(1 for name, _ in provider.calls if name == "read_account_spend")


def test_spend_view_carries_the_full_block(api, spend_env):
    account = setup(api)
    refresh(api, spend_env, account, read("1"))
    body = refresh(api, spend_env, account, read("2", "3"))
    block = body["platform_status"]
    assert set(block) == FULL_KEYS
    assert block["status"] == "disabled" and block["status_class"] == "blocking"
    assert block["account_status_raw"] == "2"
    assert block["disable_reason"] == "risk_payment" and block["disable_reason_raw"] == "3"
    assert block["observation_status"] == "succeeded" and block["failure_code"] is None
    assert block["freshness"] == "current"
    assert block["previous"]["account_status_raw"] == "1" and block["previous"]["status"] == "active"
    assert block["since_observed_at"] == block["observed_at"]
    assert "Ads Manager" in block["disclaimer"]
    assert api.get(f"/api/v1/ad-accounts/{account['id']}/spend").json()["platform_status"] == block


def test_block_is_null_until_a_code_is_observed(api, spend_env):
    account = setup(api)
    assert api.get(f"/api/v1/ad-accounts/{account['id']}/spend").json()["platform_status"] is None
    body = refresh(api, spend_env, account, read(None, None))
    assert body["platform_status"] is None, "a node without the field is 'not observed', not active"
    assert list_item(api, account["id"])["platform_status"] is None


def test_a_failed_read_that_carried_a_code_is_the_latest_word(api, spend_env):
    account = setup(api)
    refresh(api, spend_env, account, read("1"))
    failed = SpendRead(
        ok=False, failure_code=MetaFailureCode.RATE_LIMITED, failure_summary="x",
        account_status_raw="2", disable_reason_raw="1",
    )
    body = refresh(api, spend_env, account, failed)
    block = body["platform_status"]
    assert block["status"] == "disabled"
    assert block["observation_status"] == "failed" and block["failure_code"] == "rate_limited"
    compact = list_item(api, account["id"])["platform_status"]
    assert compact["status"] == "disabled" and compact["account_status_raw"] == "2"


def test_list_and_detail_carry_the_same_compact_block(api, spend_env):
    account = setup(api)
    refresh(api, spend_env, account, read("101"))
    compact = list_item(api, account["id"])["platform_status"]
    assert set(compact) == COMPACT_KEYS
    assert compact == {**compact, "status": "closed", "account_status_raw": "101", "freshness": "current"}
    detail = api.get(f"/api/v1/ad-accounts/{account['id']}").json()
    assert detail["platform_status"] == compact
    full = api.get(f"/api/v1/ad-accounts/{account['id']}/spend").json()["platform_status"]
    assert {k: full[k] for k in COMPACT_KEYS} == compact
    # The S1 compact spend keeps its exact shape.
    assert set(list_item(api, account["id"])["spend"]) == {"freshness", "observed_currency", "latest_complete_day"}


def test_unrecognised_codes_are_unknown_never_active(api, spend_env):
    account = setup(api)
    body = refresh(api, spend_env, account, read("201"))
    assert body["platform_status"]["status"] == "unknown"
    assert body["platform_status"]["status_class"] == "unknown"
    assert list_item(api, account["id"])["platform_status"]["status"] == "unknown"


def test_summary_counts_by_class_and_never_scores(api, spend_env):
    a = setup(api, ext="8001")
    b = setup(api, ext="8002")
    c = setup(api, ext="8003")
    d = setup(api, ext="8004")
    setup(api, ext="8005")  # never read
    refresh(api, spend_env, a, read("1"), ext="8001")
    refresh(api, spend_env, b, read("2"), ext="8002")
    refresh(api, spend_env, c, read("9"), ext="8003")
    refresh(api, spend_env, d, read("abc"), ext="8004")
    summary = api.get("/api/v1/spend/summary").json()
    assert summary["platform_status_counts"] == {
        "active": 1, "blocking": 1, "pending": 1, "unknown": 1, "none": 1,
    }
    assert not any("score" in key for key in summary)


def test_extension_summary_carries_the_block(api, spend_env):
    account = setup(api)
    refresh(api, spend_env, account, read("2", "15"))
    body = api.get(f"/api/v1/ad-accounts/{account['id']}/extension-summary").json()
    block = body["platform_status"]
    assert block["status"] == "disabled" and block["disable_reason"] == "compromised_ad_account"
    assert block["freshness"] == "current" and block["observation_status"] == "succeeded"
    assert body["spend"]["freshness"] == "current"


def test_extension_summary_block_is_null_without_a_code(api, spend_env):
    account = setup(api)
    body = api.get(f"/api/v1/ad-accounts/{account['id']}/extension-summary").json()
    assert body["platform_status"] is None


def test_no_get_contacts_the_provider(api, spend_env):
    account = setup(api)
    refresh(api, spend_env, account, read("2"))
    before = provider_reads(spend_env["provider"])
    for path in (
        f"/api/v1/ad-accounts/{account['id']}/spend",
        f"/api/v1/ad-accounts/{account['id']}",
        "/api/v1/ad-accounts",
        "/api/v1/spend/summary",
        f"/api/v1/ad-accounts/{account['id']}/extension-summary",
        f"/api/v1/ad-accounts/{account['id']}/health",
    ):
        assert api.get(path).status_code == 200, path
    assert provider_reads(spend_env["provider"]) == before


def test_another_workspace_gets_404_and_no_counts(client, api, other_auth, spend_env):
    account = setup(api)
    refresh(api, spend_env, account, read("2"))
    for path in (f"/api/v1/ad-accounts/{account['id']}", f"/api/v1/ad-accounts/{account['id']}/spend"):
        assert client.get(path, headers=other_auth).status_code == 404
    counts = client.get("/api/v1/spend/summary", headers=other_auth).json()["platform_status_counts"]
    assert counts == {"active": 0, "blocking": 0, "pending": 0, "unknown": 0, "none": 0}


def test_a_viewer_reads_the_status_but_cannot_change_anything(client, db_session, owner, api, spend_env):
    account = setup(api)
    refresh(api, spend_env, account, read("2"))
    headers = member(client, db_session, owner, WorkspaceRole.VIEWER, "viewer@example.com")
    viewer = db_session.execute(
        sa.select(WorkspaceMember).join(User, User.id == WorkspaceMember.user_id).where(
            User.email == "viewer@example.com"
        )
    ).scalar_one()
    db_session.add(
        MemberAdAccountAssignment(
            workspace_id=owner["workspace"].id,
            member_id=viewer.id,
            ad_account_id=account["id"],
            assigned_by=owner["user"].id,
            assigned_at=datetime.now(UTC),
        )
    )
    db_session.commit()
    body = client.get(f"/api/v1/ad-accounts/{account['id']}/spend", headers=headers).json()
    assert body["platform_status"]["status"] == "disabled"
    assert client.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh", headers=headers).status_code == 403
    assert client.patch(
        f"/api/v1/ad-accounts/{account['id']}", headers=headers, json={"status": "disabled"}
    ).status_code == 403


def test_no_payload_names_funding_or_carries_the_reader_credential(api, spend_env):
    account = setup(api)
    refresh(api, spend_env, account, read("2"))
    for path in (
        f"/api/v1/ad-accounts/{account['id']}/spend",
        "/api/v1/ad-accounts",
        "/api/v1/spend/summary",
        f"/api/v1/ad-accounts/{account['id']}/extension-summary",
    ):
        text = api.get(path).text.lower()
        assert "funding" not in text and "placeholder-reader" not in text, path


def test_no_status_payload_or_rule_claims_safety_or_recovery(api, spend_env):
    account = setup(api)
    refresh(api, spend_env, account, read("2"))
    refresh(api, spend_env, account, read("1"))
    bodies = [
        api.get(f"/api/v1/ad-accounts/{account['id']}/spend").text,
        api.get(f"/api/v1/ad-accounts/{account['id']}/health").text,
        api.get(f"/api/v1/ad-accounts/{account['id']}/health/signals").text,
        api.get("/api/v1/account-health/rules").text,
        api.get("/api/v1/alerts?page_size=100").text,
        api.get(f"/api/v1/ad-accounts/{account['id']}/extension-summary").text,
    ]
    # The extension's standing disclaimer is a denial ("…do not guarantee that an account cannot be
    # restricted"), which is exactly what rule 6 asks for; it is the one permitted occurrence.
    denial = "they do not guarantee that an account cannot be restricted"
    for body in bodies:
        body = body.replace(denial, "")
        assert not AFFIRMATIVE.search(body), AFFIRMATIVE.search(body).group(0)


def test_the_rules_endpoint_lists_all_four_enabled(api):
    rules = {rule["rule_key"]: rule for rule in api.get("/api/v1/account-health/rules").json()}
    for key in (
        "platform_account_status_blocking",
        "platform_account_status_pending",
        "platform_account_status_unrecognised",
        "platform_vs_recorded_status_mismatch",
    ):
        assert rules[key]["enabled"] is True, key


def test_an_answer_older_than_the_lookback_is_still_the_last_word(api, db_session, spend_env):
    from datetime import timedelta

    from app.models.spend import AdAccountSpendObservation

    account = setup(api)
    refresh(api, spend_env, account, read("2"))
    db_session.execute(
        sa.update(AdAccountSpendObservation).values(observed_at=datetime.now(UTC) - timedelta(days=40))
    )
    db_session.commit()
    body = api.get(f"/api/v1/ad-accounts/{account['id']}/spend").json()
    assert body["freshness"] == "stale", "old is stale, never 'never observed' (rule 28)"
    assert body["platform_status"]["status"] == "disabled"
    assert body["platform_status"]["freshness"] == "stale"
    assert list_item(api, account["id"])["platform_status"]["freshness"] == "stale"


def test_an_old_failed_read_with_a_code_is_found_without_any_success(api, db_session, spend_env):
    from datetime import timedelta

    from app.models.spend import AdAccountSpendObservation

    account = setup(api)
    failed = SpendRead(
        ok=False, failure_code=MetaFailureCode.RATE_LIMITED, failure_summary="x", account_status_raw="101",
    )
    refresh(api, spend_env, account, failed)
    db_session.execute(
        sa.update(AdAccountSpendObservation).values(observed_at=datetime.now(UTC) - timedelta(days=40))
    )
    db_session.commit()
    body = api.get(f"/api/v1/ad-accounts/{account['id']}/spend").json()
    assert body["freshness"] == "never_observed"
    assert body["platform_status"]["status"] == "closed"
    assert body["platform_status"]["observation_status"] == "failed"
