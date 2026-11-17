"""O3 — health rule 19, `account_not_returned_by_latest_discovery`.

Absence from a discovery only means something against a **complete** inventory, and even then it
says nothing about Meta removing or restricting the account. These tests pin both halves: the rule
fires on exactly reconciliation's `missing_from_latest_discovery` branch, and on nothing else.
"""
from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa

from app.commands.run_dispatcher import discovery_sweep_pass
from app.core.enums import (
    ACTIVE_SIGNAL_STATUSES,
    CoverageStatus,
    HealthCategory,
    HealthSourceType,
    SignalSeverity,
)
from app.models.entities import AdAccount
from app.models.health import AccountHealthSignal
from app.models.meta_discovery import BusinessManagerDiscoveryRun
from app.services.discovery_facts import DiscoveryFacts, build_discovery_facts
from app.services.health_engine import build_candidates
from app.services.health_rules import HEALTH_RULES_BY_KEY, HEALTH_RULES_V1
from app.services.meta_provider import AssetDiscovery, DiscoveredAsset, EdgeOutcome, MetaFailureCode
from tests.o3_helpers import HUB, automatic_connection, connection
from tests.s1_spend_helpers import make_account, make_bm
from tests.test_health_engine import build_facts

KEY = "account_not_returned_by_latest_discovery"

COMPLETE = DiscoveryFacts(
    run_id="run-1",
    completed_at=datetime(2026, 10, 27, 1, 0, tzinfo=UTC),
    business_manager_reference=HUB,
    read_as="adsops-readonly",
    coverage_status=CoverageStatus.COMPLETE,
    returned=False,
)


def fired(discovery) -> list:
    facts = build_facts()
    facts.discovery = discovery
    return [c for c in build_candidates(facts, {KEY}) if c.rule_key == KEY]


# ------------------------------------------------------------------ pure rule


def test_the_registry_grows_from_18_to_19_by_this_one_rule():
    assert len(HEALTH_RULES_V1) == 19
    rule = HEALTH_RULES_BY_KEY[KEY]
    assert rule.default_severity == SignalSeverity.ATTENTION
    assert rule.category == HealthCategory.DATA_QUALITY
    assert rule.enabled_by_default is True


def test_it_fires_only_for_a_complete_run_that_did_not_return_the_account():
    (candidate,) = fired(COMPLETE)
    assert candidate.severity == SignalSeverity.ATTENTION
    assert candidate.source_type == HealthSourceType.PROVIDER_OBSERVATION
    assert candidate.source_entity_type == "business_manager_discovery_run"
    assert candidate.source_entity_id == "run-1"


def test_partial_incomplete_or_unknown_coverage_concludes_nothing():
    """Row: partial coverage — no absence conclusion."""
    for status in (CoverageStatus.PARTIAL, CoverageStatus.INCOMPLETE, CoverageStatus.UNKNOWN,
                   CoverageStatus.NOT_ATTEMPTED):
        assert fired(replace(COMPLETE, coverage_status=status)) == [], status


def test_returned_or_no_run_says_nothing():
    assert fired(replace(COMPLETE, returned=True)) == []
    assert fired(None) == [], "no run is not 'returned', and not 'not returned' either"


def test_the_evidence_is_allowlisted_and_never_claims_removal_or_restriction():
    (candidate,) = fired(COMPLETE)
    assert set(candidate.evidence) == {
        "message", "discovery_run_id", "discovery_completed_at", "business_manager_reference",
        "read_as", "coverage_status", "source",
    }
    message = candidate.evidence["message"].lower()
    assert "says nothing about whether meta removed or restricted it" in message
    for word in ("deleted", "banned", "safe", "cannot be restricted", "lost"):
        assert word not in message.replace("removed or restricted it", "")


def test_the_run_id_is_volatile_so_a_daily_repeat_does_not_supersede_the_signal():
    from app.services.health_service import evidence_hash

    (first,) = fired(COMPLETE)
    (second,) = fired(replace(COMPLETE, run_id="run-2", completed_at=COMPLETE.completed_at + timedelta(days=1)))
    assert evidence_hash(first.evidence) == evidence_hash(second.evidence)
    (other_reader,) = fired(replace(COMPLETE, read_as="someone-else"))
    assert evidence_hash(first.evidence) != evidence_hash(other_reader.evidence)


# ---------------------------------------------------------------- facts from the database


def _complete_inventory(*external_ids: str) -> AssetDiscovery:
    return AssetDiscovery(
        assets=tuple(DiscoveredAsset(x, f"Account {x}", "owned_ad_accounts") for x in external_ids),
        edges=(
            EdgeOutcome("owned_ad_accounts", ok=True, pages_read=1, items=len(external_ids)),
            EdgeOutcome("client_ad_accounts", ok=True, pages_read=1, items=0),
        ),
        required_edges=("owned_ad_accounts", "client_ad_accounts"),
    )


def _partial_inventory(*external_ids: str) -> AssetDiscovery:
    return AssetDiscovery(
        assets=tuple(DiscoveredAsset(x, f"Account {x}", "owned_ad_accounts") for x in external_ids),
        edges=(
            EdgeOutcome("owned_ad_accounts", ok=True, pages_read=1, items=len(external_ids)),
            EdgeOutcome("client_ad_accounts", ok=False, failure_code=MetaFailureCode.RATE_LIMITED),
        ),
        required_edges=("owned_ad_accounts", "client_ad_accounts"),
    )


def _signals(db_session, account_id) -> list[AccountHealthSignal]:
    db_session.expire_all()
    return list(
        db_session.execute(
            sa.select(AccountHealthSignal).where(
                AccountHealthSignal.ad_account_id == account_id,
                AccountHealthSignal.rule_key == KEY,
            )
        ).scalars().all()
    )


def _active(db_session, account_id) -> list[AccountHealthSignal]:
    return [s for s in _signals(db_session, account_id) if s.status in ACTIVE_SIGNAL_STATUSES]


def _age_runs(db_session, hours: float):
    db_session.execute(
        sa.update(BusinessManagerDiscoveryRun).values(
            completed_at=datetime.now(UTC) - timedelta(hours=hours)
        )
    )
    db_session.commit()


def test_a_complete_sweep_that_misses_an_account_opens_the_signal_and_archives_nothing(
    api, db_session, sweep_env
):
    """Row: absence — signal only. Never archived, never a status change."""
    bm = make_bm(api, HUB, "Hub BM")
    gone = make_account(api, bm=bm, external_id="444", name="Not shared any more")
    automatic_connection(api)
    sweep_env["provider"].queue_ad_account_discovery(_complete_inventory("111"))

    totals = discovery_sweep_pass(batch=5)

    assert totals["not_returned_complete"] == 1
    (signal,) = _active(db_session, gone["id"])
    assert signal.severity == SignalSeverity.ATTENTION
    account = db_session.get(AdAccount, gone["id"])
    db_session.refresh(account)
    assert account.archived_at is None
    assert account.status.value == gone["status"]


def test_a_partial_sweep_opens_nothing(api, db_session, sweep_env):
    """Row: partial coverage → no absence conclusion."""
    bm = make_bm(api, HUB, "Hub BM")
    gone = make_account(api, bm=bm, external_id="444")
    automatic_connection(api)
    sweep_env["provider"].queue_ad_account_discovery(_partial_inventory("111"))

    totals = discovery_sweep_pass(batch=5)

    assert totals["not_returned_complete"] == 0
    assert _signals(db_session, gone["id"]) == []


def test_a_newer_complete_run_that_returns_it_closes_the_signal(api, db_session, sweep_env):
    bm = make_bm(api, HUB, "Hub BM")
    account = make_account(api, bm=bm, external_id="444")
    automatic_connection(api)
    sweep_env["provider"].queue_ad_account_discovery(_complete_inventory("111"))
    discovery_sweep_pass(batch=5)
    assert len(_active(db_session, account["id"])) == 1
    _age_runs(db_session, 30)
    sweep_env["provider"].queue_ad_account_discovery(_complete_inventory("111", "444"))

    discovery_sweep_pass(batch=5)

    assert _active(db_session, account["id"]) == []


def test_a_newer_partial_run_silences_it_rather_than_keeping_an_old_conclusion(api, db_session, sweep_env):
    """The newest look decides; a partial newest look is not a clear result and not a finding."""
    bm = make_bm(api, HUB, "Hub BM")
    account = make_account(api, bm=bm, external_id="444")
    automatic_connection(api)
    sweep_env["provider"].queue_ad_account_discovery(_complete_inventory("111"))
    discovery_sweep_pass(batch=5)
    _age_runs(db_session, 30)
    sweep_env["provider"].queue_ad_account_discovery(_partial_inventory("111"))

    discovery_sweep_pass(batch=5)

    assert _active(db_session, account["id"]) == []


def test_facts_ignore_stale_fake_and_other_business_manager_runs(api, db_session, sweep_env):
    bm = make_bm(api, HUB, "Hub BM")
    created = make_account(api, bm=bm, external_id="444")
    automatic_connection(api)
    sweep_env["provider"].queue_ad_account_discovery(_complete_inventory("111"))
    discovery_sweep_pass(batch=5)
    account = db_session.get(AdAccount, created["id"])
    now = datetime.now(UTC)

    facts = build_discovery_facts(db_session, account.workspace_id, account, now=now)
    assert facts is not None and facts.complete and facts.returned is False

    # Outside the window: no run, so nothing to conclude.
    assert build_discovery_facts(db_session, account.workspace_id, account, now=now + timedelta(hours=25)) is None

    # A fake identity's inventory is never evidence about a real account.
    db_session.execute(
        sa.update(BusinessManagerDiscoveryRun).values(provider_actor_external_id="fake-system-user")
    )
    db_session.commit()
    db_session.expire_all()
    assert build_discovery_facts(db_session, account.workspace_id, account, now=now) is None


def test_a_fake_connections_manual_run_never_feeds_the_rule(api, db_session, meta_provider):
    """Fake discovery is stamped `fake`; the rule only reads `production` runs."""
    from app.core.config import get_settings

    settings = get_settings()
    previous = settings.meta_business_id
    settings.meta_business_id = ""
    try:
        bm = make_bm(api, HUB, "Hub BM")
        created = make_account(api, bm=bm, external_id="444")
        conn = connection(api, environment="fake")
        meta_provider.business_managers.append({"external_id": HUB, "name": "Fake"})
        meta_provider.discovered_ad_accounts.append(DiscoveredAsset("111", "Fake", "owned_ad_accounts"))
        assert api.post(f"/api/v1/meta-connections/{conn['id']}/discoveries").status_code == 201
        account = db_session.get(AdAccount, created["id"])
        assert build_discovery_facts(db_session, account.workspace_id, account, now=datetime.now(UTC)) is None
    finally:
        settings.meta_business_id = previous
