"""The periodic health re-evaluation, and the two reasons an account can be due.

Health has always been recalculated on mutation and on request. An account nobody touches
therefore ages until it is honestly reported as stale — correct, but it means staleness was
*surfaced* rather than *prevented*, and nothing in the product ever looked again on its own.

Measured 2026-09-15 in the development database before this existed: two snapshots, both last
evaluated at the moment their accounts were imported the day before, with nothing scheduled to
revisit them.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa

from app.commands.run_dispatcher import _due_accounts, health_sweep_pass
from app.core.config import get_settings
from app.core.enums import OperationalRunKind, OperationalRunStatus
from app.models.health import AccountHealthSnapshot
from app.models.operations import OperationalRun


@pytest.fixture()
def sweep_enabled():
    """The sweep is off by default; these tests turn it on for themselves and put it back."""
    settings = get_settings()
    previous = (settings.health_sweep_every_n_passes, settings.health_sweep_batch)
    settings.health_sweep_every_n_passes = 1
    settings.health_sweep_batch = 10
    yield settings
    settings.health_sweep_every_n_passes, settings.health_sweep_batch = previous


def _age_snapshot(db_session, account_id, *, hours: int) -> None:
    """Push an existing snapshot's last evaluation into the past, without touching anything else."""
    db_session.execute(
        sa.update(AccountHealthSnapshot)
        .where(AccountHealthSnapshot.ad_account_id == account_id)
        .values(last_evaluated_at=datetime.now(UTC) - timedelta(hours=hours))
    )
    db_session.commit()


# ------------------------------------------------------------------ what counts as due


def test_an_account_nobody_has_ever_evaluated_is_due(api, db_session, owner):
    account = api.post("/api/v1/ad-accounts", json={"display_name": "Never looked at"}).json()
    db_session.execute(sa.delete(AccountHealthSnapshot))
    db_session.commit()

    due = _due_accounts(
        db_session, owner["workspace"].id, cutoff=datetime.now(UTC), batch=10
    )

    assert [str(a.id) for a, _ in due] == [account["id"]]
    assert due[0][1] is None, "never evaluated must carry no timestamp, not a guessed one"


def test_a_freshly_evaluated_account_is_not_due(api, db_session, owner):
    api.post("/api/v1/ad-accounts", json={"display_name": "Just evaluated"})

    cutoff = datetime.now(UTC) - timedelta(hours=24)
    due = _due_accounts(db_session, owner["workspace"].id, cutoff=cutoff, batch=10)

    assert due == []


def test_an_aged_evaluation_becomes_due(api, db_session, owner):
    account = api.post("/api/v1/ad-accounts", json={"display_name": "Aged"}).json()
    _age_snapshot(db_session, account["id"], hours=48)

    cutoff = datetime.now(UTC) - timedelta(hours=24)
    due = _due_accounts(db_session, owner["workspace"].id, cutoff=cutoff, batch=10)

    assert [str(a.id) for a, _ in due] == [account["id"]]
    assert due[0][1] is not None


def test_an_archived_account_is_never_due(api, db_session, owner):
    account = api.post("/api/v1/ad-accounts", json={"display_name": "Archived"}).json()
    _age_snapshot(db_session, account["id"], hours=48)
    api.post(f"/api/v1/ad-accounts/{account['id']}/archive")

    due = _due_accounts(
        db_session, owner["workspace"].id, cutoff=datetime.now(UTC), batch=10
    )

    assert due == []


def test_the_batch_bounds_what_one_pass_takes(api, db_session, owner):
    for index in range(4):
        api.post("/api/v1/ad-accounts", json={"display_name": f"Account {index}"})
    db_session.execute(sa.delete(AccountHealthSnapshot))
    db_session.commit()

    due = _due_accounts(db_session, owner["workspace"].id, cutoff=datetime.now(UTC), batch=2)

    assert len(due) == 2


def test_never_evaluated_accounts_are_taken_first(api, db_session, owner):
    aged = api.post("/api/v1/ad-accounts", json={"display_name": "Aged"}).json()
    _age_snapshot(db_session, aged["id"], hours=72)
    never = api.post("/api/v1/ad-accounts", json={"display_name": "Never"}).json()
    db_session.execute(
        sa.delete(AccountHealthSnapshot).where(
            AccountHealthSnapshot.ad_account_id == never["id"]
        )
    )
    db_session.commit()

    due = _due_accounts(db_session, owner["workspace"].id, cutoff=datetime.now(UTC), batch=10)

    assert str(due[0][0].id) == never["id"], "an account nobody has ever assessed comes first"


# ------------------------------------------------------------------------- the pass itself


def test_the_two_reasons_are_counted_separately(api, db_session, owner, sweep_enabled):
    """Rule 28: "never run" is a distinct state from "stale". Adding them together would make the
    first sweep of a fresh workspace report a large stale count that is not stale at all."""
    aged = api.post("/api/v1/ad-accounts", json={"display_name": "Aged"}).json()
    _age_snapshot(db_session, aged["id"], hours=48)
    never = api.post("/api/v1/ad-accounts", json={"display_name": "Never"}).json()
    db_session.execute(
        sa.delete(AccountHealthSnapshot).where(
            AccountHealthSnapshot.ad_account_id == never["id"]
        )
    )
    db_session.commit()

    totals = health_sweep_pass(batch=10)

    assert totals["never_evaluated"] == 1
    assert totals["stale"] == 1
    assert totals["evaluated"] == 2
    assert totals["failed"] == 0


def test_a_sweep_actually_refreshes_the_evaluation(api, db_session, owner, sweep_enabled):
    account = api.post("/api/v1/ad-accounts", json={"display_name": "Aged"}).json()
    _age_snapshot(db_session, account["id"], hours=48)

    health_sweep_pass(batch=10)

    db_session.expire_all()
    refreshed = db_session.execute(
        sa.select(AccountHealthSnapshot).where(
            AccountHealthSnapshot.ad_account_id == account["id"]
        )
    ).scalar_one()
    assert refreshed.last_evaluated_at > datetime.now(UTC) - timedelta(minutes=5)


def test_every_pass_is_recorded_so_a_stopped_sweep_is_visible(api, db_session, owner, sweep_enabled):
    """The dispatcher's own precedent: silence must not be the only symptom of a process that
    stopped running."""
    api.post("/api/v1/ad-accounts", json={"display_name": "One"})

    health_sweep_pass(batch=10)

    db_session.expire_all()
    run = db_session.execute(
        sa.select(OperationalRun)
        .where(OperationalRun.kind == OperationalRunKind.HEALTH_SWEEP)
        .order_by(OperationalRun.started_at.desc())
    ).scalars().first()
    assert run is not None
    assert run.status is OperationalRunStatus.SUCCEEDED
    # Every counter must survive the round trip. `sanitise_summary()` is an allowlist that drops
    # unknown keys silently, and the first version of this test asserted only `workspaces` — which
    # happened to be allowlisted already, so it passed while the recorded summary said nothing
    # about what the sweep had actually done. Found by running one sweep for real.
    for counter in ("never_evaluated", "stale", "evaluated", "failed", "due_remaining", "workspaces"):
        assert counter in run.summary_json, counter


def test_a_sweep_with_nothing_due_still_records_a_run(api, db_session, owner, sweep_enabled):
    """"Nothing was due" and "the sweep did not run" are different facts and must look different."""
    api.post("/api/v1/ad-accounts", json={"display_name": "Fresh"})

    totals = health_sweep_pass(batch=10)

    assert totals["evaluated"] == 0
    run = db_session.execute(
        sa.select(OperationalRun).where(OperationalRun.kind == OperationalRunKind.HEALTH_SWEEP)
    ).scalars().first()
    assert run is not None


def test_what_the_batch_could_not_reach_is_reported_not_dropped(api, db_session, owner, sweep_enabled):
    for index in range(4):
        api.post("/api/v1/ad-accounts", json={"display_name": f"Account {index}"})
    db_session.execute(sa.delete(AccountHealthSnapshot))
    db_session.commit()

    totals = health_sweep_pass(batch=2)

    assert totals["evaluated"] == 2
    assert totals["due_remaining"] >= 1, "a sweep that cannot keep up must say so"


def test_the_sweep_contacts_no_advertising_platform(api, meta_provider, owner, sweep_enabled):
    """Health re-reads stored records. A sweep that called out would turn a quiet cron into a
    rate-limit problem, and would make health depend on a platform being reachable."""
    api.post("/api/v1/ad-accounts", json={"display_name": "One"})
    meta_provider.calls.clear()

    health_sweep_pass(batch=10)

    assert meta_provider.calls == []


# ------------------------------------------------------------------------ staying off by default


def test_the_sweep_is_disabled_by_default():
    """An existing deployment must not change behaviour because a new version shipped. Turning
    this on is a release decision, not an upgrade side effect."""
    from app.core.config import Settings

    fresh = Settings(database_url="postgresql+psycopg://u:p@db/x", jwt_secret="x" * 40)

    assert fresh.health_sweep_every_n_passes == 0


def test_the_loop_skips_the_sweep_when_the_cadence_is_zero(monkeypatch):
    """Zero means off — not "every pass", which is what a naive modulo would do."""
    import app.commands.run_dispatcher as dispatcher

    called: list[int] = []
    monkeypatch.setattr(dispatcher, "one_pass", lambda **_: {})
    monkeypatch.setattr(dispatcher, "health_sweep_pass", lambda **kw: called.append(1) or {})
    monkeypatch.setattr(dispatcher, "_stop", False)

    passes = {"n": 0}

    def fake_sleep(_seconds):
        passes["n"] += 1
        if passes["n"] >= 3:
            dispatcher._stop = True

    monkeypatch.setattr(dispatcher.time, "sleep", fake_sleep)
    try:
        dispatcher.run_loop(batch=1, interval=1, recovery_every=0, health_every=0)
    finally:
        dispatcher._stop = False

    assert called == []
