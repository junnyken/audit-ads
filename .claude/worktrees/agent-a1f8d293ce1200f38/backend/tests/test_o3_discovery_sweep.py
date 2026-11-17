"""O3 — the discovery sweep in the dispatcher. Fake provider behind the one seam; nothing here
reaches Meta. Each test named after a row of the audit's degradation table
(`docs/AUDIT_BEFORE_BUILD_O3_AUTO_IMPORT.md` §4b) says so in its docstring — that table is the
contract.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa

from app.commands import run_dispatcher
from app.commands.run_dispatcher import discovery_sweep_pass
from app.core.config import Settings, get_settings
from app.core.enums import (
    DiscoveryRunStatus,
    DiscoveryTrigger,
    OperationalRunKind,
    OperationalRunStatus,
)
from app.models.entities import AdAccount, AuditLog
from app.models.meta_discovery import BusinessManagerDiscoveryRun
from app.models.operations import OperationalRun
from app.services import spend_service
from app.services.audit import SYSTEM_DISCOVERY_SWEEP_ACTOR
from app.services.meta_provider import (
    AssetDiscovery,
    CapabilityCheck,
    DiscoveredAsset,
    EdgeOutcome,
    MetaFailureCode,
)
from app.services.operations import SAFE_SUMMARY_KEYS
from tests.o3_helpers import (
    HUB,
    automatic_connection,
    connection,
    stage,
)

OTHER = "555000111"


def runs(db_session) -> list[BusinessManagerDiscoveryRun]:
    db_session.expire_all()
    return list(
        db_session.execute(
            sa.select(BusinessManagerDiscoveryRun).order_by(BusinessManagerDiscoveryRun.started_at)
        ).scalars().all()
    )


def accounts(db_session) -> list[AdAccount]:
    db_session.expire_all()
    return list(db_session.execute(sa.select(AdAccount)).scalars().all())


def discovery_calls(provider) -> list[str]:
    return [arg for name, arg in provider.calls if name == "discover_ad_accounts"]


# ------------------------------------------------------------------ off by default


def test_the_sweep_is_off_by_default():
    """Row: `DISCOVERY_SWEEP_EVERY_N_PASSES=0` — no scan, no import."""
    assert Settings().discovery_sweep_every_n_passes == 0
    assert get_settings().discovery_sweep_every_n_passes == 0
    assert Settings().discovery_stale_after_hours == 24
    assert Settings().auto_import_telegram_grace_hours == 24


@pytest.mark.parametrize("every, expected_calls", [(0, 0), (1, 1)])
def test_the_loop_runs_the_discovery_pass_only_when_a_cadence_is_set(monkeypatch, every, expected_calls):
    calls: list[int] = []

    def one_pass(**_kwargs):
        run_dispatcher._stop = True
        return {}

    monkeypatch.setattr(run_dispatcher, "one_pass", one_pass)
    monkeypatch.setattr(run_dispatcher, "discovery_sweep_pass", lambda *, batch: calls.append(batch) or {})
    monkeypatch.setattr(run_dispatcher, "spend_sweep_pass", lambda *, batch: {})
    monkeypatch.setattr(run_dispatcher, "health_sweep_pass", lambda *, batch: {})
    try:
        run_dispatcher.run_loop(
            batch=1, interval=5, recovery_every=0, discovery_every=every, discovery_batch=3
        )
    finally:
        run_dispatcher._stop = False
    assert calls == ([3] if expected_calls else [])


def test_the_cli_flag_runs_exactly_one_pass(monkeypatch, capsys):
    seen: list[int] = []
    monkeypatch.setattr(
        run_dispatcher, "discovery_sweep_pass", lambda *, batch: seen.append(batch) or {"imported": 0}
    )
    monkeypatch.setattr("sys.argv", ["run_dispatcher", "--discovery-sweep"])
    with pytest.raises(SystemExit) as exit_info:
        run_dispatcher.main()
    assert exit_info.value.code == 0
    assert seen == [get_settings().discovery_sweep_batch]
    assert "imported=0" in capsys.readouterr().out


# ------------------------------------------------------------------ who is swept


def test_flags_off_means_no_scan_and_no_import(api, db_session, sweep_env):
    """Row: connection switches off — no scan, no import."""
    connection(api)
    stage(sweep_env["provider"], ("111", "owned_ad_accounts"))

    totals = discovery_sweep_pass(batch=5)

    assert totals["runs"] == 0 and totals["imported"] == 0
    assert sweep_env["built"] == [] and sweep_env["provider"].calls == []
    assert runs(db_session) == [] and accounts(db_session) == []


def test_a_fake_or_sandbox_connection_is_never_swept_even_if_its_row_says_automatic(
    api, db_session, sweep_env
):
    """Row: `fake`/`sandbox` — never scanned, never imported. The API refuses the switch; this
    proves the sweep's own query refuses too, should a row ever hold `true` anyway."""
    fake = connection(api, environment="fake", label="Fake")
    sandbox = connection(api, environment="sandbox", label="Sandbox")
    db_session.execute(
        sa.text(
            "UPDATE meta_connections SET auto_discovery_enabled = true, auto_import_enabled = true "
            "WHERE id IN (:a, :b)"
        ),
        {"a": fake["id"], "b": sandbox["id"]},
    )
    db_session.commit()
    stage(sweep_env["provider"], ("111", "owned_ad_accounts"))

    totals = discovery_sweep_pass(batch=5)

    assert totals["runs"] == 0 and totals["not_configured"] == 0
    assert sweep_env["built"] == [] and runs(db_session) == [] and accounts(db_session) == []


def test_without_a_credential_nothing_is_called(api, db_session, sweep_env, monkeypatch):
    """Row: reader `none` / dispatcher without `META_*` — `not_configured`, zero calls."""
    automatic_connection(api)
    settings = get_settings()
    monkeypatch.setattr(settings, "meta_access_token", "")
    monkeypatch.setattr(settings, "meta_access_tokens_by_business", {})

    totals = discovery_sweep_pass(batch=5)

    assert totals["not_configured"] == 1 and totals["runs"] == 0
    assert sweep_env["built"] == [] and sweep_env["provider"].calls == []


def test_an_automatic_connection_is_swept_once_per_window(api, db_session, sweep_env):
    automatic_connection(api)
    stage(sweep_env["provider"], ("111", "owned_ad_accounts"))

    first = discovery_sweep_pass(batch=5)
    second = discovery_sweep_pass(batch=5)

    assert first["runs"] == 1 and first["never_discovered"] == 1
    assert second["runs"] == 0, "current within discovery_stale_after_hours"
    assert discovery_calls(sweep_env["provider"]) == [HUB]


def test_never_discovered_goes_before_stale_and_they_are_counted_apart(api, db_session, sweep_env):
    first = automatic_connection(api, label="Old")
    stage(sweep_env["provider"])
    discovery_sweep_pass(batch=5)
    db_session.execute(
        sa.update(BusinessManagerDiscoveryRun).values(
            completed_at=datetime.now(UTC) - timedelta(hours=30)
        )
    )
    db_session.commit()
    second = automatic_connection(api, bm=OTHER, label="New")
    sweep_env["provider"].business_managers.append({"external_id": OTHER, "name": "Other"})
    sweep_env["provider"].calls.clear()

    totals = discovery_sweep_pass(batch=5)

    assert discovery_calls(sweep_env["provider"]) == [OTHER, HUB], "never discovered first"
    assert totals["never_discovered"] == 1 and totals["stale"] == 1
    assert {str(r.meta_connection_id) for r in runs(db_session)} == {first["id"], second["id"]}


def test_the_batch_bounds_a_pass_and_the_rest_is_due_remaining(api, db_session, sweep_env):
    for index in range(3):
        bm = f"90000{index}"
        sweep_env["provider"].business_managers.append({"external_id": bm, "name": bm})
        automatic_connection(api, bm=bm, label=f"C{index}")

    totals = discovery_sweep_pass(batch=2)

    assert totals["runs"] == 2 and totals["due_remaining"] == 1


# ------------------------------------------------------------------ the run itself


def test_a_scheduled_run_is_marked_as_such_and_started_by_nobody(api, db_session, sweep_env):
    automatic_connection(api)
    stage(sweep_env["provider"], ("111", "owned_ad_accounts"))

    discovery_sweep_pass(batch=5)

    (run,) = runs(db_session)
    assert run.trigger == DiscoveryTrigger.SCHEDULED_SWEEP
    assert run.created_by is None
    assert run.status == DiscoveryRunStatus.SUCCEEDED
    assert run.provider_actor_name == "adsops-readonly"


def test_every_audit_row_of_the_pass_names_the_system_not_a_person(api, db_session, owner, sweep_env):
    automatic_connection(api)
    stage(sweep_env["provider"], ("111", "owned_ad_accounts"), ("222", "client_ad_accounts"))
    db_session.expire_all()
    before = {row.id for row in db_session.execute(sa.select(AuditLog)).scalars()}

    discovery_sweep_pass(batch=5)

    db_session.expire_all()
    written = [row for row in db_session.execute(sa.select(AuditLog)).scalars() if row.id not in before]
    assert len(written) > 10, "imports, checklists, health, alerts, the run, the pass"
    (operational,) = db_session.execute(
        sa.select(OperationalRun).where(OperationalRun.kind == OperationalRunKind.DISCOVERY_SWEEP)
    ).scalars().all()
    for row in written:
        assert row.actor_id is None, row.action
        assert row.metadata_json["actor"] == SYSTEM_DISCOVERY_SWEEP_ACTOR, row.action
        assert row.metadata_json["operational_run_id"] == str(operational.id), row.action
    actions = {row.action for row in written}
    assert {
        "meta_discovery.business_manager_validated",
        "meta_discovery.assets_discovered",
        "meta_discovery.ad_account_auto_imported",
        "ad_account.created",
        "meta_discovery.sweep_pass_recorded",
    } <= actions
    assert "meta_discovery.ad_account_imported" not in actions, "a person's import action is not reused"


def test_the_operational_run_records_only_allowlisted_counters(api, db_session, sweep_env):
    automatic_connection(api)
    stage(sweep_env["provider"], ("111", "owned_ad_accounts"))

    totals = discovery_sweep_pass(batch=5)

    assert set(totals) <= SAFE_SUMMARY_KEYS
    run = db_session.execute(
        sa.select(OperationalRun).where(OperationalRun.kind == OperationalRunKind.DISCOVERY_SWEEP)
    ).scalar_one()
    assert run.status == OperationalRunStatus.SUCCEEDED
    assert run.summary_json == totals


def test_a_failed_validation_imports_nothing(api, db_session, sweep_env):
    """Row: validation `failed` (`token_expired`, `permission_missing`, `not_configured`) — run
    `failed`, nothing imported, no absence conclusion, no summary."""
    automatic_connection(api)
    stage(sweep_env["provider"], ("111", "owned_ad_accounts"))
    sweep_env["provider"].capability = CapabilityCheck(
        False, False, False, False, reason=MetaFailureCode.TOKEN_EXPIRED
    )

    totals = discovery_sweep_pass(batch=5)

    (run,) = runs(db_session)
    assert run.status == DiscoveryRunStatus.FAILED and run.failure_code == "token_expired"
    assert totals["failed"] == 1 and totals["imported"] == 0 and totals["summaries"] == 0
    assert accounts(db_session) == []
    assert discovery_calls(sweep_env["provider"]) == [], "assets are never read after a failed validation"


def test_rate_limited_stops_the_rest_of_the_pass_for_that_credential(api, db_session, sweep_env):
    """Row: `rate_limited` mid-pass — the remaining connections on that credential wait."""
    for index in range(3):
        bm = f"80000{index}"
        sweep_env["provider"].business_managers.append({"external_id": bm, "name": bm})
        automatic_connection(api, bm=bm, label=f"C{index}")
    sweep_env["provider"].capability = CapabilityCheck(
        False, False, False, False, reason=MetaFailureCode.RATE_LIMITED
    )

    totals = discovery_sweep_pass(batch=5)

    assert totals["runs"] == 1 and totals["rate_limited"] == 1
    assert totals["due_remaining"] == 2
    run = db_session.execute(
        sa.select(OperationalRun).where(OperationalRun.kind == OperationalRunKind.DISCOVERY_SWEEP)
    ).scalar_one()
    assert run.status == OperationalRunStatus.PARTIAL


def test_a_defect_in_one_connection_does_not_end_the_pass(api, db_session, sweep_env, monkeypatch):
    automatic_connection(api, label="Broken")
    sweep_env["provider"].business_managers.append({"external_id": OTHER, "name": "Other"})
    automatic_connection(api, bm=OTHER, label="Fine")
    stage(sweep_env["provider"], ("111", "owned_ad_accounts"))
    original = sweep_env["provider"].discover_ad_accounts

    def flaky(business_id):
        if business_id == HUB:
            raise RuntimeError("boom")
        return original(business_id)

    monkeypatch.setattr(sweep_env["provider"], "discover_ad_accounts", flaky)

    totals = discovery_sweep_pass(batch=5)

    assert totals["runs"] == 2 and totals["failed"] == 1 and totals["imported"] == 1
    assert [r.configured_business_manager_reference for r in runs(db_session)] == [OTHER]


def test_partial_coverage_still_imports_what_was_returned(api, db_session, sweep_env):
    """Row: coverage `partial`/`incomplete` with assets — `succeeded_with_warnings`, imported
    (presence needs no full inventory), no absence conclusion."""
    automatic_connection(api)
    sweep_env["provider"].queue_ad_account_discovery(
        AssetDiscovery(
            assets=(DiscoveredAsset("111", "Owned", "owned_ad_accounts"),),
            edges=(
                EdgeOutcome("owned_ad_accounts", ok=True, pages_read=1, items=1),
                EdgeOutcome("client_ad_accounts", ok=False, failure_code=MetaFailureCode.PERMISSION_MISSING),
            ),
            required_edges=("owned_ad_accounts", "client_ad_accounts"),
        )
    )

    totals = discovery_sweep_pass(batch=5)

    (run,) = runs(db_session)
    assert run.status == DiscoveryRunStatus.SUCCEEDED_WITH_WARNINGS
    assert totals["warnings"] == 1 and totals["imported"] == 1
    assert totals["not_returned_complete"] == 0


def test_an_empty_inventory_without_authority_imports_and_concludes_nothing(api, db_session, sweep_env):
    """Row: empty + authority `not_established` → `unknown` — nothing to import, no absence."""
    from app.core.enums import BusinessAuthority

    automatic_connection(api)
    stage(sweep_env["provider"])
    sweep_env["provider"].authority = BusinessAuthority.NOT_ESTABLISHED

    totals = discovery_sweep_pass(batch=5)

    (run,) = runs(db_session)
    assert run.ad_account_coverage_status.value == "unknown"
    assert totals["imported"] == 0 and totals["not_returned_complete"] == 0 and totals["summaries"] == 0


def test_the_spend_sweep_picks_up_an_imported_account_on_its_next_pass(api, db_session, sweep_env):
    """S1/S2 take over by themselves: the imported account sits under the hub BM, which has a
    readable production connection, so it is `never_observed` and due at once."""
    automatic_connection(api)
    stage(sweep_env["provider"], ("111", "client_ad_accounts"))
    discovery_sweep_pass(batch=5)

    selection = spend_service.select_due_accounts(
        db_session, accounts(db_session)[0].workspace_id, cutoff=datetime.now(UTC)
    )

    assert [d.account.external_account_id for d in selection.due] == ["111"]
    assert selection.due[0].never_observed
