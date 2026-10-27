"""S1 — spend facts and the four spend health rules. Pure: no database, no provider, no network.

The degradation table in `docs/AUDIT_BEFORE_BUILD_SPEND.md` §4b is a test contract. Each row has
a test here named after it, so a row that stops holding fails by name.
"""
from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.core.enums import (
    HealthCategory,
    HealthSourceType,
    SignalSeverity,
    SpendFreshness,
    SpendObservationStatus,
)
from app.models.entities import AdAccount
from app.services.health_engine import build_candidates
from app.services.health_rules import HEALTH_RULES_BY_KEY, HEALTH_RULES_V1, HealthFacts
from app.services.spend_engine import ObservationView, assemble

TZ = "Asia/Ho_Chi_Minh"  # UTC+7, the workspace's own; the container runs UTC
SPEND_KEYS = {
    "spend_observation_missing_or_stale",
    "spend_change_vs_baseline",
    "spend_cap_approaching",
    "spend_currency_mismatch",
}
MINIMUMS = {"VND": 500000, "USD": 20}


def _rows(spend_by_day: dict[date, str | None], currency: str = "VND") -> tuple[dict, ...]:
    return tuple(
        {
            "date_start": day.isoformat(),
            "date_stop": day.isoformat(),
            "spend": value,
            "account_currency": currency,
        }
        for day, value in sorted(spend_by_day.items())
    )


def obs(
    observed_at: datetime,
    *,
    daily: dict[date, str | None] | None = None,
    status: SpendObservationStatus = SpendObservationStatus.SUCCEEDED,
    currency: str | None = "VND",
    timezone_name: str | None = TZ,
    window_days: int = 8,
    window_until: date | None = None,
    row_currency: str | None = None,
    failure_code: str | None = None,
    amount_spent: str | None = None,
    spend_cap: str | None = None,
) -> ObservationView:
    until = window_until or (
        observed_at.astimezone(ZoneInfo(timezone_name)).date()
        if timezone_name
        else observed_at.date()
    )
    return ObservationView(
        id=str(uuid.uuid4()),
        observed_at=observed_at,
        status=status,
        failure_code=failure_code,
        currency=currency,
        timezone_name=timezone_name,
        amount_spent_raw=amount_spent,
        spend_cap_raw=spend_cap,
        daily=_rows(daily or {}, row_currency or currency or "VND"),
        window_since=until - timedelta(days=window_days - 1),
        window_until=until,
        reader_source="server_default",
    )


def facts_for(
    observations, *, now: datetime, observable: bool = True, registry_currency: str | None = "VND"
) -> HealthFacts:
    account = AdAccount(id=uuid.uuid4(), display_name="Spend test", currency=registry_currency)
    spend = assemble(
        observable=observable,
        observations=observations,
        now=now,
        stale_after_hours=26,
        reader_source="server_default" if observable else None,
        registry_currency=registry_currency,
        baseline_min_days=5,
        change_ratio_threshold=0.5,
        change_min_amounts=MINIMUMS,
        cap_ratio_threshold=0.9,
    )
    return HealthFacts(
        account=account,
        readiness=None,  # spend rules never read it
        checklist_items=[],
        unresolved_events=[],
        now=now,
        manual_review_due_after_days=30,
        spend=spend,
    )


def fire(facts: HealthFacts, key: str):
    return HEALTH_RULES_BY_KEY[key].evaluate(facts)


#: 2026-10-26 02:00 local (UTC+7) — so the latest complete local day is 2026-10-25.
NOW = datetime(2026, 10, 25, 19, 0, tzinfo=UTC)
YESTERDAY = date(2026, 10, 25)


def steady_week(latest: str, base: str = "1000000") -> dict[date, str]:
    days = {YESTERDAY - timedelta(days=i): base for i in range(1, 7)}
    days[YESTERDAY] = latest
    return days


# ------------------------------------------------------------------ registry shape


def test_the_registry_grows_by_exactly_the_four_spend_rules():
    keys = {rule.rule_key for rule in HEALTH_RULES_V1}
    assert keys >= SPEND_KEYS
    # 14 after S1; S2 adds its four platform-status rules (test_s2_platform_status_rules.py), O3
    # one discovery rule (test_o3_absence_rule.py).
    assert len(HEALTH_RULES_V1) == 19
    for key in SPEND_KEYS:
        rule = HEALTH_RULES_BY_KEY[key]
        assert rule.category == HealthCategory.SPEND
        assert rule.default_severity in (SignalSeverity.WARNING, SignalSeverity.ATTENTION)


def test_only_the_cap_rule_starts_disabled_until_units_are_confirmed():
    disabled = {rule.rule_key for rule in HEALTH_RULES_V1 if not rule.enabled_by_default}
    assert disabled == {"spend_cap_approaching"}


def test_no_spend_rule_suggests_changing_anything_from_this_product():
    for key in SPEND_KEYS:
        rule = HEALTH_RULES_BY_KEY[key]
        text = f"{rule.recommended_next_step} {rule.why_it_matters} {rule.description}".lower()
        for banned in ("pause", "safe", "guarantee", "cannot be restricted", "approved", "score"):
            assert banned not in text, (key, banned)


# --------------------------------------------------------------- degradation table rows


def test_row_no_connection_or_reader_is_not_observable_and_fires_nothing():
    facts = facts_for([obs(NOW, daily=steady_week("5000000"))], now=NOW, observable=False)
    assert facts.spend.freshness == SpendFreshness.NOT_OBSERVABLE
    for key in SPEND_KEYS:
        assert fire(facts, key) == [], key


def test_row_reader_but_never_read_is_attention_from_rule_one_only():
    facts = facts_for([], now=NOW)
    assert facts.spend.freshness == SpendFreshness.NEVER_OBSERVED
    [signal] = fire(facts, "spend_observation_missing_or_stale")
    assert signal.severity == SignalSeverity.ATTENTION
    assert signal.evidence["spend_freshness"] == "never_observed"
    for key in SPEND_KEYS - {"spend_observation_missing_or_stale"}:
        assert fire(facts, key) == []


def test_row_latest_failed_but_older_success_still_current_keeps_using_the_success():
    good = obs(NOW - timedelta(hours=1), daily=steady_week("5000000"))
    failed = obs(
        NOW - timedelta(minutes=30),
        status=SpendObservationStatus.FAILED,
        failure_code="permission_missing",
    )
    facts = facts_for([failed, good], now=NOW)
    assert facts.spend.freshness == SpendFreshness.CURRENT
    assert facts.spend.latest_attempt.failure_code == "permission_missing"
    assert fire(facts, "spend_observation_missing_or_stale") == []
    assert len(fire(facts, "spend_change_vs_baseline")) == 1


def test_row_three_failures_in_a_row_fire_rule_one_even_while_current():
    good = obs(NOW - timedelta(hours=5), daily=steady_week("1000000"))
    failures = [
        obs(NOW - timedelta(hours=h), status=SpendObservationStatus.FAILED, failure_code="token_expired")
        for h in (1, 2, 3)
    ]
    facts = facts_for([*failures, good], now=NOW)
    [signal] = fire(facts, "spend_observation_missing_or_stale")
    assert signal.evidence["consecutive_failed_reads"] == 3
    assert signal.evidence["latest_failure_code"] == "token_expired"


def test_row_stale_success_fires_rule_one_and_no_day_rule():
    old = obs(NOW - timedelta(hours=30), daily=steady_week("9000000"))
    facts = facts_for([old], now=NOW)
    assert facts.spend.freshness == SpendFreshness.STALE
    [signal] = fire(facts, "spend_observation_missing_or_stale")
    assert signal.evidence["spend_freshness"] == "stale"
    assert fire(facts, "spend_change_vs_baseline") == []


def test_row_no_timezone_means_no_day_rule_and_names_the_missing_input():
    facts = facts_for([obs(NOW, daily=steady_week("9000000"), timezone_name=None,
                           window_until=YESTERDAY + timedelta(days=1))], now=NOW)
    assert facts.spend.missing_input == "timezone_name"
    assert facts.spend.latest_complete_day is None
    assert fire(facts, "spend_change_vs_baseline") == []


def test_row_an_unknown_timezone_name_is_treated_as_missing():
    facts = facts_for([obs(NOW, daily=steady_week("9000000"), timezone_name="Mars/Olympus",
                           window_until=YESTERDAY + timedelta(days=1))], now=NOW)
    assert facts.spend.missing_input == "timezone_name"
    assert fire(facts, "spend_change_vs_baseline") == []


def test_row_yesterday_without_a_row_is_not_zero_and_does_not_fire():
    days = steady_week("0")
    del days[YESTERDAY]
    facts = facts_for([obs(NOW, daily=days)], now=NOW)
    entry = facts.spend.day(YESTERDAY)
    assert entry is not None and entry.has_row is False and entry.amount is None
    assert fire(facts, "spend_change_vs_baseline") == []


def test_a_real_zero_row_is_a_number_and_a_drop_fires():
    facts = facts_for([obs(NOW, daily=steady_week("0"))], now=NOW)
    [signal] = fire(facts, "spend_change_vs_baseline")
    assert signal.evidence["direction"] == "decrease"
    assert signal.evidence["spend"] == "0"


def test_row_fewer_than_five_baseline_days_does_not_fire():
    days = {YESTERDAY: "9000000"}
    days.update({YESTERDAY - timedelta(days=i): "1000000" for i in range(1, 5)})  # 4 days
    facts = facts_for([obs(NOW, daily=days)], now=NOW)
    assert len(facts.spend.baseline_days()) == 4
    assert facts.spend.baseline_median() is None
    assert fire(facts, "spend_change_vs_baseline") == []


def test_baseline_days_without_rows_are_not_counted_as_zero():
    days = steady_week("9000000")
    del days[YESTERDAY - timedelta(days=2)]
    del days[YESTERDAY - timedelta(days=3)]  # 4 baseline rows left
    facts = facts_for([obs(NOW, daily=days)], now=NOW)
    assert facts.spend.baseline_median() is None
    assert fire(facts, "spend_change_vs_baseline") == []


@pytest.mark.parametrize("cap", [None, "", "0", "abc"])
def test_row_spend_cap_empty_zero_or_unparseable_does_not_fire(cap):
    facts = facts_for([obs(NOW, daily=steady_week("1000000"), amount_spent="999", spend_cap=cap)], now=NOW)
    assert fire(facts, "spend_cap_approaching") == []


def test_row_currency_conflict_between_node_and_insights_fires_mismatch_only():
    facts = facts_for([obs(NOW, daily=steady_week("9000000"), currency="VND", row_currency="USD",
                           amount_spent="95", spend_cap="100")], now=NOW)
    assert facts.spend.insights_currency_conflict is True
    assert fire(facts, "spend_change_vs_baseline") == []
    assert fire(facts, "spend_cap_approaching") == []
    signals = fire(facts, "spend_currency_mismatch")
    assert [s.scope for s in signals] == ["insights"]
    assert signals[0].severity == SignalSeverity.ATTENTION


# ------------------------------------------------------------------ the change rule


def test_a_fifty_percent_rise_above_the_minimum_fires_a_warning():
    facts = facts_for([obs(NOW, daily=steady_week("1600000"))], now=NOW)
    [signal] = fire(facts, "spend_change_vs_baseline")
    assert signal.severity == SignalSeverity.WARNING
    assert signal.category == HealthCategory.SPEND
    assert signal.source_type == HealthSourceType.PROVIDER_OBSERVATION
    assert signal.scope == f"day:{YESTERDAY.isoformat()}"
    assert signal.evidence["baseline_median"] == "1000000"
    assert signal.evidence["baseline_day_count"] == 6
    assert signal.evidence["direction"] == "increase"


def test_a_small_ratio_does_not_fire_even_above_the_minimum():
    facts = facts_for([obs(NOW, daily=steady_week("1400000"))], now=NOW)  # +40%
    assert fire(facts, "spend_change_vs_baseline") == []


def test_a_large_ratio_below_the_absolute_minimum_does_not_fire():
    # +200% but only 200 000 VND — below the 500 000 VND minimum.
    facts = facts_for([obs(NOW, daily=steady_week("300000", base="100000"))], now=NOW)
    assert fire(facts, "spend_change_vs_baseline") == []


def test_usd_uses_its_own_minimum():
    days = steady_week("45", base="20")  # +125%, +25 USD >= 20
    facts = facts_for([obs(NOW, daily=days, currency="USD")], now=NOW, registry_currency="USD")
    assert len(fire(facts, "spend_change_vs_baseline")) == 1
    small = steady_week("35", base="20")  # +75%, but +15 USD < 20
    facts = facts_for([obs(NOW, daily=small, currency="USD")], now=NOW, registry_currency="USD")
    assert fire(facts, "spend_change_vs_baseline") == []


def test_a_currency_with_no_minimum_never_fires():
    facts = facts_for([obs(NOW, daily=steady_week("9000000"), currency="EUR")], now=NOW, registry_currency="EUR")
    assert fire(facts, "spend_change_vs_baseline") == []


def test_todays_incomplete_day_never_feeds_a_rule():
    days = steady_week("1000000")
    today = YESTERDAY + timedelta(days=1)
    days[today] = "99000000"  # a wild partial number for today
    facts = facts_for([obs(NOW, daily=days)], now=NOW)
    assert facts.spend.today_partial is not None and facts.spend.today_partial.complete is False
    assert facts.spend.today_partial.day == today
    assert all(d.day != today for d in facts.spend.complete_days)
    assert fire(facts, "spend_change_vs_baseline") == []


# --------------------------------------------------- day boundary, UTC container vs UTC+7


def test_one_minute_before_local_midnight_the_latest_complete_day_is_the_day_before():
    observed = datetime(2026, 10, 25, 16, 59, tzinfo=UTC)  # 23:59 on the 25th in UTC+7
    facts = facts_for([obs(observed, daily=steady_week("1000000"))], now=observed)
    assert facts.spend.latest_complete_day == date(2026, 10, 24)
    # The 25th was still running when read: it is today's partial, never a complete day.
    assert facts.spend.today_partial is not None
    assert facts.spend.today_partial.day == date(2026, 10, 25)


def test_one_minute_after_local_midnight_yesterday_is_complete():
    observed = datetime(2026, 10, 25, 17, 1, tzinfo=UTC)  # 00:01 on the 26th in UTC+7
    facts = facts_for([obs(observed, daily=steady_week("1000000"))], now=observed)
    # A UTC calendar would still say the 25th is "today". The account's own day decides.
    assert facts.spend.latest_complete_day == date(2026, 10, 25)
    assert facts.spend.day(date(2026, 10, 25)).has_row


def test_a_day_read_before_it_ended_is_not_complete_even_in_a_later_window():
    """A read at 23:00 local saw a partial 25th. A later read after midnight decides the day."""
    early = obs(datetime(2026, 10, 25, 16, 0, tzinfo=UTC), daily={date(2026, 10, 25): "10"})
    later = obs(datetime(2026, 10, 25, 18, 0, tzinfo=UTC), daily={date(2026, 10, 25): "1234"})
    facts = facts_for([early, later], now=datetime(2026, 10, 25, 18, 5, tzinfo=UTC))
    assert facts.spend.day(date(2026, 10, 25)).spend_raw == "1234"


def test_the_newest_complete_read_of_a_day_wins_including_saying_it_has_no_row():
    older = obs(NOW - timedelta(hours=10), daily={YESTERDAY - timedelta(days=1): "500"})
    newer = obs(NOW - timedelta(hours=1), daily={})
    facts = facts_for([newer, older], now=NOW)
    entry = facts.spend.day(YESTERDAY - timedelta(days=1))
    assert entry.has_row is False


# ------------------------------------------------------------- cap and currency rules


def test_cap_fires_at_ninety_percent_and_not_below():
    facts = facts_for([obs(NOW, daily=steady_week("1"), amount_spent="9000", spend_cap="10000")], now=NOW)
    [signal] = fire(facts, "spend_cap_approaching")
    assert signal.severity == SignalSeverity.WARNING
    assert signal.evidence["spend_cap_raw"] == "10000"
    facts = facts_for([obs(NOW, daily=steady_week("1"), amount_spent="8999", spend_cap="10000")], now=NOW)
    assert fire(facts, "spend_cap_approaching") == []


def test_cap_rule_does_not_use_a_stale_read():
    facts = facts_for([obs(NOW - timedelta(hours=40), amount_spent="9900", spend_cap="10000")], now=NOW)
    assert fire(facts, "spend_cap_approaching") == []


def test_registry_currency_mismatch_is_attention():
    facts = facts_for([obs(NOW, daily=steady_week("1"), currency="USD", row_currency="USD")],
                      now=NOW, registry_currency="VND")
    [signal] = fire(facts, "spend_currency_mismatch")
    assert signal.scope == "registry"
    assert signal.evidence == {
        **signal.evidence,
        "observed_currency": "USD",
        "registry_currency": "VND",
    }


def test_no_mismatch_when_the_registry_has_no_currency():
    facts = facts_for([obs(NOW, daily=steady_week("1"), currency="USD", row_currency="USD")],
                      now=NOW, registry_currency=None)
    assert fire(facts, "spend_currency_mismatch") == []


# -------------------------------------------------------------------- cross-cutting


def test_no_spend_rule_ever_emits_unknown_severity_or_a_score():
    scenarios = [
        facts_for([], now=NOW),
        facts_for([obs(NOW, daily=steady_week("0"), amount_spent="99", spend_cap="100")], now=NOW),
        facts_for([obs(NOW, daily=steady_week("9000000"), timezone_name=None,
                       window_until=YESTERDAY)], now=NOW),
        facts_for([obs(NOW - timedelta(hours=50))], now=NOW),
    ]
    for facts in scenarios:
        for candidate in build_candidates(facts, SPEND_KEYS):
            assert candidate.severity != SignalSeverity.UNKNOWN
            for key in candidate.evidence:
                assert "score" not in key.lower() and "risk" not in key.lower()


def test_evidence_never_mentions_funding_or_carries_a_credential():
    facts = facts_for([obs(NOW, daily=steady_week("9000000"), amount_spent="99", spend_cap="100")], now=NOW)
    for candidate in build_candidates(facts, SPEND_KEYS):
        blob = str(candidate.evidence).lower()
        assert "funding" not in blob and "token" not in blob


def test_absent_spend_facts_keep_every_spend_rule_silent():
    facts = facts_for([], now=NOW)
    facts.spend = None
    for key in SPEND_KEYS:
        assert fire(facts, key) == []
