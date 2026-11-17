"""S1 — the spend sweep in the dispatcher. Fake provider only; nothing here reaches Meta.

The first path in this product that calls Meta on a timer, so every fence is pinned: off by
default, bounded, `rate_limited` stops that connection's pass, never-observed and stale are
counted apart, not-observable accounts are never due, and every read is recorded.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa

from app.commands import run_dispatcher
from app.commands.run_dispatcher import spend_sweep_pass
from app.core.config import Settings, get_settings
from app.core.enums import (
    EvaluationTrigger,
    OperationalRunKind,
    OperationalRunStatus,
    SpendObservationStatus,
)
from app.models.entities import AdAccount, AuditLog
from app.models.health import AccountHealthSignal, HealthEvaluationRun
from app.models.operations import OperationalRun
from app.models.spend import AdAccountSpendObservation
from app.services import spend_service
from app.services.meta_provider import MetaFailureCode, SpendRead
from app.services.operations import SAFE_SUMMARY_KEYS
from tests.s1_spend_helpers import (
    good_read,
    make_account,
    make_bm,
    make_connection,
)

BM_A = "1993884657458857"
BM_B = "555000111"


def observable_account(api, external_id: str, *, bm_external_id: str = BM_A, currency="VND"):
    bms = {bm["external_id"]: bm for bm in api.get("/api/v1/business-managers").json()["items"]}
    bm = bms.get(bm_external_id) or make_bm(api, bm_external_id)
    return make_account(api, bm=bm, external_id=external_id, currency=currency)


def observations(db_session):
    db_session.expire_all()
    return list(
        db_session.execute(
            sa.select(AdAccountSpendObservation).order_by(AdAccountSpendObservation.observed_at)
        ).scalars().all()
    )


def spend_calls(provider) -> list[str]:
    return [arg for name, arg in provider.calls if name == "read_account_spend"]


# ---------------------------------------------------------------- off by default


def test_the_sweep_is_off_by_default():
    assert Settings().spend_sweep_every_n_passes == 0
    assert get_settings().spend_sweep_every_n_passes == 0


@pytest.mark.parametrize("every, expected_calls", [(0, 0), (1, 1)])
def test_the_loop_runs_the_spend_pass_only_when_a_cadence_is_set(monkeypatch, every, expected_calls):
    calls: list[int] = []

    def one_pass(**_kwargs):
        run_dispatcher._stop = True  # stop after the first iteration
        return {}

    monkeypatch.setattr(run_dispatcher, "one_pass", one_pass)
    monkeypatch.setattr(run_dispatcher, "spend_sweep_pass", lambda *, batch: calls.append(batch) or {})
    monkeypatch.setattr(run_dispatcher, "health_sweep_pass", lambda *, batch: {})
    try:
        run_dispatcher.run_loop(batch=1, interval=5, recovery_every=0, spend_every=every, spend_batch=7)
    finally:
        run_dispatcher._stop = False
    assert len(calls) == expected_calls
    if expected_calls:
        assert calls == [7]


def test_the_cli_flag_runs_exactly_one_pass(monkeypatch, capsys):
    seen: list[int] = []
    monkeypatch.setattr(run_dispatcher, "spend_sweep_pass", lambda *, batch: seen.append(batch) or {"observed": 0})
    monkeypatch.setattr("sys.argv", ["run_dispatcher", "--spend-sweep"])
    with pytest.raises(SystemExit) as exit_info:
        run_dispatcher.main()
    assert exit_info.value.code == 0
    assert seen == [get_settings().spend_sweep_batch]
    assert "observed=0" in capsys.readouterr().out


# --------------------------------------------------------------- not observable


@pytest.fixture()
def no_reader(monkeypatch, meta_provider):
    """No reader credential on the server — explicitly, because a developer's `backend/.env` may
    carry one and `Settings` reads it. The provider seam is also replaced, so even a regression
    here could only reach the fake."""
    settings = get_settings()
    monkeypatch.setattr(settings, "meta_access_token", "")
    monkeypatch.setattr(settings, "meta_access_tokens_by_business", {})
    monkeypatch.setattr(spend_service, "provider_for_connection", lambda reader: meta_provider)
    return settings


def test_without_a_credential_every_account_is_not_observable_and_nothing_is_called(
    api, db_session, meta_provider, no_reader
):
    make_connection(api, bm_external_id=BM_A)
    observable_account(api, "111")

    totals = spend_sweep_pass(batch=10)

    assert totals["not_observable"] == 1
    assert totals["observed"] == totals["failed"] == totals["never_observed"] == 0
    assert meta_provider.calls == []
    assert observations(db_session) == []


def test_fake_sandbox_and_missing_links_are_not_observable(api, db_session, spend_env):
    make_connection(api, bm_external_id=BM_A, environment="fake")
    make_connection(api, bm_external_id=BM_B, environment="sandbox")
    observable_account(api, "111", bm_external_id=BM_A)  # only a fake connection
    observable_account(api, "222", bm_external_id=BM_B)  # only a sandbox connection
    make_account(api, bm=None, external_id="333")  # no Business Manager
    bm = make_bm(api, "777")
    make_connection(api, bm_external_id="777")
    make_account(api, bm=bm, external_id=None, name="No external id")  # nothing to ask for

    totals = spend_sweep_pass(batch=10)

    assert totals["not_observable"] == 4
    assert spend_calls(spend_env["provider"]) == []
    assert spend_env["built"] == []


# -------------------------------------------------------------- selection and order


def test_never_observed_is_read_before_stale_and_counted_apart(api, db_session, spend_env):
    make_connection(api, bm_external_id=BM_A)
    stale = observable_account(api, "111")
    provider = spend_env["provider"]
    provider.queue_spend_result("111", good_read({1: "100"}))
    spend_sweep_pass(batch=10)
    never = observable_account(api, "222")
    # Age the only observation past the stale window.
    db_session.execute(
        sa.update(AdAccountSpendObservation).values(
            observed_at=datetime.now(UTC) - timedelta(hours=30)
        )
    )
    db_session.commit()
    provider.calls.clear()
    provider.queue_spend_result("111", good_read({1: "100"}))
    provider.queue_spend_result("222", good_read({1: "100"}))

    totals = spend_sweep_pass(batch=10)

    assert spend_calls(provider) == ["222", "111"], "never observed first"
    assert totals["never_observed"] == 1 and totals["stale"] == 1
    assert totals["observed"] == 2
    assert {str(o.ad_account_id) for o in observations(db_session)} == {stale["id"], never["id"]}


def test_a_current_account_is_not_read_again(api, db_session, spend_env):
    make_connection(api, bm_external_id=BM_A)
    observable_account(api, "111")
    spend_env["provider"].queue_spend_result("111", good_read({1: "100"}))
    spend_sweep_pass(batch=10)
    spend_env["provider"].calls.clear()

    totals = spend_sweep_pass(batch=10)

    assert spend_calls(spend_env["provider"]) == []
    assert totals["never_observed"] == totals["stale"] == 0


def test_the_batch_bounds_one_pass_and_the_rest_is_due_remaining(api, db_session, spend_env):
    make_connection(api, bm_external_id=BM_A)
    for index in range(5):
        observable_account(api, f"10{index}")

    totals = spend_sweep_pass(batch=2)

    assert len(spend_calls(spend_env["provider"])) == 2
    assert totals["due_remaining"] == 3


def test_an_account_whose_reads_keep_failing_does_not_starve_the_others(api, db_session, spend_env):
    make_connection(api, bm_external_id=BM_A)
    observable_account(api, "101")
    observable_account(api, "102")
    spend_sweep_pass(batch=1)  # unstaged: fails with not_configured
    spend_env["provider"].calls.clear()

    spend_sweep_pass(batch=1)

    assert spend_calls(spend_env["provider"]) == ["102"], "the never-attempted account gets its turn"


# --------------------------------------------------------------- failures and limits


def test_a_failed_read_is_recorded_and_does_not_stop_the_pass(api, db_session, spend_env):
    make_connection(api, bm_external_id=BM_A)
    observable_account(api, "101")
    observable_account(api, "102")
    spend_env["provider"].queue_spend_result(
        "101", SpendRead(ok=False, failure_code=MetaFailureCode.PERMISSION_MISSING, failure_summary="No.")
    )
    spend_env["provider"].queue_spend_result("102", good_read({1: "100"}))

    totals = spend_sweep_pass(batch=10)

    assert totals["failed"] == 1 and totals["observed"] == 1
    rows = {o.external_account_id: o for o in observations(db_session)}
    assert rows["101"].status == SpendObservationStatus.FAILED
    assert rows["101"].failure_code == "permission_missing"
    assert rows["101"].daily_json is None, "a failed read stores no days, and no zeros"
    assert rows["102"].status == SpendObservationStatus.SUCCEEDED


def test_rate_limited_stops_that_connection_but_not_another(api, db_session, spend_env):
    make_connection(api, bm_external_id=BM_A, label="A")
    make_connection(api, bm_external_id=BM_B, label="B")
    observable_account(api, "101", bm_external_id=BM_A)
    observable_account(api, "102", bm_external_id=BM_A)
    observable_account(api, "103", bm_external_id=BM_A)
    observable_account(api, "201", bm_external_id=BM_B)
    provider = spend_env["provider"]
    provider.queue_spend_result("101", SpendRead(ok=False, failure_code=MetaFailureCode.RATE_LIMITED))
    provider.queue_spend_result("201", good_read({1: "5"}))

    totals = spend_sweep_pass(batch=10)

    assert spend_calls(provider) == ["101", "201"], "no further read through the limited connection"
    assert totals["rate_limited"] == 1
    assert totals["due_remaining"] == 2
    assert totals["observed"] == 1
    assert totals["failed"] == 0
    run = db_session.execute(
        sa.select(OperationalRun).where(OperationalRun.kind == OperationalRunKind.SPEND_SWEEP)
    ).scalars().one()
    assert run.status == OperationalRunStatus.PARTIAL


# ---------------------------------------------------------------- what a pass leaves


def test_each_pass_records_a_run_with_every_counter_kept(api, db_session, spend_env):
    make_connection(api, bm_external_id=BM_A)
    observable_account(api, "101")
    spend_env["provider"].queue_spend_result("101", good_read({1: "100"}))

    totals = spend_sweep_pass(batch=10)

    assert set(totals) <= SAFE_SUMMARY_KEYS, set(totals) - SAFE_SUMMARY_KEYS
    db_session.expire_all()
    run = db_session.execute(
        sa.select(OperationalRun).where(OperationalRun.kind == OperationalRunKind.SPEND_SWEEP)
    ).scalars().one()
    assert run.status == OperationalRunStatus.SUCCEEDED
    assert run.summary_json == totals


def test_each_read_is_followed_by_a_health_evaluation_pointing_at_it(api, db_session, spend_env):
    make_connection(api, bm_external_id=BM_A)
    account = observable_account(api, "101")
    spend_env["provider"].queue_spend_result("101", good_read({1: "100"}))

    spend_sweep_pass(batch=10)

    [observation] = observations(db_session)
    run = db_session.execute(
        sa.select(HealthEvaluationRun).where(
            HealthEvaluationRun.trigger_type == EvaluationTrigger.SPEND_OBSERVATION
        )
    ).scalars().one()
    assert str(run.ad_account_id) == account["id"]
    assert run.trigger_reference_id == str(observation.id)


def test_one_audit_row_per_workspace_per_pass_with_a_real_actor(api, db_session, owner, spend_env):
    make_connection(api, bm_external_id=BM_A)
    observable_account(api, "101")
    observable_account(api, "102")

    spend_sweep_pass(batch=10)

    rows = db_session.execute(
        sa.select(AuditLog).where(AuditLog.action == "spend.observations_recorded")
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].actor_id == owner["user"].id
    assert len(rows[0].after_json["ad_account_ids"]) == 2
    assert rows[0].after_json["failed"] == 2


def test_the_sweep_never_writes_the_registry(api, db_session, spend_env):
    make_connection(api, bm_external_id=BM_A)
    account = observable_account(api, "101", currency="VND")
    spend_env["provider"].queue_spend_result("101", good_read({1: "100"}, currency="USD"))

    spend_sweep_pass(batch=10)

    db_session.expire_all()
    row = db_session.get(AdAccount, account["id"])
    assert row.last_synced_at is None, "a spend read must not move readiness's data freshness"
    assert row.currency == "VND", "Meta's currency is stored on the observation, never written back"
    mismatch = db_session.execute(
        sa.select(AccountHealthSignal).where(AccountHealthSignal.rule_key == "spend_currency_mismatch")
    ).scalars().all()
    assert len(mismatch) == 1


def test_never_observed_accounts_raise_attention_after_a_failed_read(api, db_session, spend_env):
    make_connection(api, bm_external_id=BM_A)
    account = observable_account(api, "101")

    spend_sweep_pass(batch=10)  # unstaged fake: not_configured

    health = api.get(f"/api/v1/ad-accounts/{account['id']}/health").json()
    codes = [reason["code"] for reason in health["summary_reasons"]]
    assert "spend_observation_missing_or_stale" in codes
