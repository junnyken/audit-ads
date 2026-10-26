"""S2 — platform-status facts and the four platform-status health rules. Pure: no database.

The degradation table in `docs/AUDIT_BEFORE_BUILD_ACCOUNT_STATUS.md` §4b is a test contract. Each
row has a test here named after it (`test_row_…`), so a row that stops holding fails by name.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.core.enums import (
    AccountStatus,
    HealthCategory,
    HealthSourceType,
    SignalSeverity,
    SpendFreshness,
    SpendObservationStatus,
)
from app.models.entities import AdAccount
from app.services.health_engine import build_candidates
from app.services.health_rules import HEALTH_RULES_BY_KEY, HEALTH_RULES_V1, HealthFacts
from app.services.health_service import VOLATILE_EVIDENCE_KEYS, evidence_hash
from app.services.platform_status import PlatformAccountStatus
from app.services.spend_engine import ObservationView, assemble

TZ = "Asia/Ho_Chi_Minh"
NOW = datetime(2026, 10, 27, 5, 0, tzinfo=UTC)

BLOCKING_KEY = "platform_account_status_blocking"
PENDING_KEY = "platform_account_status_pending"
UNRECOGNISED_KEY = "platform_account_status_unrecognised"
MISMATCH_KEY = "platform_vs_recorded_status_mismatch"
S2_KEYS = {BLOCKING_KEY, PENDING_KEY, UNRECOGNISED_KEY, MISMATCH_KEY}
STALE_KEY = "spend_observation_missing_or_stale"

EVIDENCE_ALLOWLIST = {
    "message",
    "account_status_raw",
    "platform_status",
    "disable_reason_raw",
    "disable_reason",
    "spend_freshness",
    "reader_source",
    "source",
    "observation_id",
    "observed_at",
    "observation_status",
    "observation_failure_code",
    "previous_account_status_raw",
    "previous_observed_at",
    "since_observed_at",
    "registry_status",
}


def obs(
    hours_ago: float,
    status_raw: str | None = "1",
    *,
    reason_raw: str | None = "0",
    ok: bool = True,
    failure_code: str | None = None,
    timezone_name: str | None = TZ,
    currency: str | None = "VND",
) -> ObservationView:
    observed_at = NOW - timedelta(hours=hours_ago)
    return ObservationView(
        id=str(uuid.uuid4()),
        observed_at=observed_at,
        status=SpendObservationStatus.SUCCEEDED if ok else SpendObservationStatus.FAILED,
        failure_code=None if ok else (failure_code or "invalid_request"),
        currency=currency,
        timezone_name=timezone_name,
        account_status_raw=status_raw,
        disable_reason_raw=reason_raw if status_raw is not None else None,
        reader_source="server_default",
    )


def facts_for(observations, *, registry: AccountStatus = AccountStatus.UNKNOWN, observable: bool = True):
    account = AdAccount(id=uuid.uuid4(), display_name="Status test", currency="VND", status=registry)
    spend = assemble(
        observable=observable,
        observations=observations,
        now=NOW,
        stale_after_hours=26,
        reader_source="server_default" if observable else None,
        registry_currency="VND",
    )
    return HealthFacts(
        account=account,
        readiness=None,  # platform-status rules never read it
        checklist_items=[],
        unresolved_events=[],
        now=NOW,
        manual_review_due_after_days=30,
        spend=spend,
        platform_status=spend.platform_status,
    )


def s2(facts: HealthFacts):
    """Candidates from the four S2 rules only, as the engine builds them."""
    return list(build_candidates(facts, S2_KEYS))


def keys(facts: HealthFacts) -> set[str]:
    return {c.rule_key for c in s2(facts)}


# ------------------------------------------------------------------ registry shape


def test_the_registry_grows_from_14_to_18_by_the_four_status_rules():
    assert len(HEALTH_RULES_V1) == 18
    assert {rule.rule_key for rule in HEALTH_RULES_V1} >= S2_KEYS


def test_severities_and_categories_are_fixed_per_rule():
    expected = {
        BLOCKING_KEY: (SignalSeverity.CRITICAL, HealthCategory.ACCOUNT_STATUS),
        PENDING_KEY: (SignalSeverity.WARNING, HealthCategory.ACCOUNT_STATUS),
        UNRECOGNISED_KEY: (SignalSeverity.ATTENTION, HealthCategory.DATA_QUALITY),
        MISMATCH_KEY: (SignalSeverity.ATTENTION, HealthCategory.ACCOUNT_STATUS),
    }
    for key, (severity, category) in expected.items():
        rule = HEALTH_RULES_BY_KEY[key]
        assert (rule.default_severity, rule.category) == (severity, category), key


def test_all_four_rules_start_enabled():
    # §7 6.8: every S2 rule is on by default. Only S1's cap rule starts off.
    assert all(HEALTH_RULES_BY_KEY[key].enabled_by_default for key in S2_KEYS)
    assert {r.rule_key for r in HEALTH_RULES_V1 if not r.enabled_by_default} == {"spend_cap_approaching"}


def test_rule_guidance_never_promises_anything():
    for key in S2_KEYS:
        rule = HEALTH_RULES_BY_KEY[key]
        text = " ".join(
            [rule.name, rule.description, rule.why_it_matters, rule.recommended_next_step, rule.resolution_guidance]
        ).lower()
        for banned in ("is safe", "safe account", "recovered", "restored", "will be reopened", "appeal",
                       "cannot be restricted", "guarantee"):
            assert banned not in text, (key, banned)


# ------------------------------------------------------------------ degradation table rows


def test_row_not_observable_without_any_observation():
    facts = facts_for([], observable=False)
    assert facts.platform_status is None
    assert s2(facts) == []


def test_row_observable_but_no_node_ever_answered():
    facts = facts_for([])
    assert facts.platform_status is None
    assert s2(facts) == []


def test_row_node_answered_without_an_account_status_field():
    facts = facts_for([obs(1, None)])
    assert facts.platform_status is None
    assert s2(facts) == []


def test_row_active_current_fires_nothing_unless_the_record_says_otherwise():
    for registry in (AccountStatus.UNKNOWN, AccountStatus.ACTIVE, AccountStatus.WARNING):
        facts = facts_for([obs(1, "1")], registry=registry)
        assert facts.platform_status.status is PlatformAccountStatus.ACTIVE
        assert facts.platform_status.freshness is SpendFreshness.CURRENT
        assert s2(facts) == [], registry
    for registry in (AccountStatus.RESTRICTED, AccountStatus.DISABLED):
        candidates = s2(facts_for([obs(1, "1")], registry=registry))
        assert [c.rule_key for c in candidates] == [MISMATCH_KEY]
        assert candidates[0].evidence["registry_status"] == registry.value


def test_row_active_stale_never_drives_a_record_change():
    facts = facts_for([obs(40, "1")], registry=AccountStatus.DISABLED)
    assert facts.platform_status.status is PlatformAccountStatus.ACTIVE
    assert facts.platform_status.freshness is SpendFreshness.STALE
    assert s2(facts) == []


def test_row_disabled_current_is_critical_with_the_reason():
    facts = facts_for([obs(1, "2", reason_raw="3")], registry=AccountStatus.ACTIVE)
    by_key = {c.rule_key: c for c in s2(facts)}
    assert set(by_key) == {BLOCKING_KEY, MISMATCH_KEY}
    blocking = by_key[BLOCKING_KEY]
    assert blocking.severity is SignalSeverity.CRITICAL
    assert blocking.evidence["platform_status"] == "disabled"
    assert blocking.evidence["disable_reason"] == "risk_payment"
    assert blocking.evidence["disable_reason_raw"] == "3"
    assert "account_status 2" in blocking.evidence["message"]
    assert "RISK_PAYMENT (3)" in blocking.evidence["message"]


def test_row_disabled_on_a_failed_read_still_counts():
    facts = facts_for([obs(1, "2", ok=False, failure_code="rate_limited")])
    assert facts.spend.latest_success is None  # the spend half failed…
    candidates = s2(facts)
    assert [c.rule_key for c in candidates] == [BLOCKING_KEY]  # …the node still answered
    assert candidates[0].evidence["observation_status"] == "failed"
    assert candidates[0].evidence["observation_failure_code"] == "rate_limited"


def test_row_disabled_then_reads_refused_stays_critical_and_spend_goes_stale():
    observations = [
        obs(30, "2", reason_raw="1"),
        obs(3, None, ok=False, failure_code="permission_missing"),
        obs(2, None, ok=False, failure_code="permission_missing"),
        obs(1, None, ok=False, failure_code="permission_missing"),
    ]
    facts = facts_for(observations, registry=AccountStatus.ACTIVE)
    assert facts.platform_status.status is PlatformAccountStatus.DISABLED
    assert facts.platform_status.freshness is SpendFreshness.STALE
    candidates = build_candidates(facts, S2_KEYS | {STALE_KEY})
    by_key = {c.rule_key: c for c in candidates}
    assert set(by_key) == {BLOCKING_KEY, STALE_KEY}, "mismatch needs a current observation"
    assert by_key[BLOCKING_KEY].severity is SignalSeverity.CRITICAL
    assert by_key[BLOCKING_KEY].evidence["spend_freshness"] == "stale"
    assert by_key[STALE_KEY].severity is SignalSeverity.ATTENTION
    assert "last status Meta returned" in by_key[BLOCKING_KEY].evidence["message"]


@pytest.mark.parametrize("raw", ["3", "7", "8", "9"])
def test_row_pending_codes_are_a_warning(raw):
    candidates = s2(facts_for([obs(1, raw)], registry=AccountStatus.ACTIVE))
    by_key = {c.rule_key: c for c in candidates}
    assert set(by_key) == {PENDING_KEY, MISMATCH_KEY}
    assert by_key[PENDING_KEY].severity is SignalSeverity.WARNING


@pytest.mark.parametrize("raw, state", [("100", "pending_closure"), ("101", "closed")])
def test_row_pending_closure_and_closed_are_critical(raw, state):
    candidates = s2(facts_for([obs(1, raw)], registry=AccountStatus.ACTIVE))
    by_key = {c.rule_key: c for c in candidates}
    assert set(by_key) == {BLOCKING_KEY, MISMATCH_KEY}
    assert by_key[BLOCKING_KEY].severity is SignalSeverity.CRITICAL
    assert by_key[BLOCKING_KEY].evidence["platform_status"] == state


@pytest.mark.parametrize("raw", ["201", "202", "42", "abc", "9999999999"])
def test_row_unrecognised_codes_are_attention_and_never_compared(raw):
    for registry in (AccountStatus.ACTIVE, AccountStatus.DISABLED):
        facts = facts_for([obs(1, raw)], registry=registry)
        assert facts.platform_status.status is PlatformAccountStatus.UNKNOWN
        candidates = s2(facts)
        assert [c.rule_key for c in candidates] == [UNRECOGNISED_KEY]
        assert candidates[0].severity is SignalSeverity.ATTENTION
        assert candidates[0].category is HealthCategory.DATA_QUALITY


@pytest.mark.parametrize("reason", [None, "99", "abc", ""])
def test_row_odd_disable_reason_never_changes_severity(reason):
    candidates = s2(facts_for([obs(1, "2", reason_raw=reason)]))
    assert [(c.rule_key, c.severity) for c in candidates] == [(BLOCKING_KEY, SignalSeverity.CRITICAL)]
    message = candidates[0].evidence["message"]
    assert ("not returned" in message) if reason is None else ("unrecognised code" in message)


@pytest.mark.parametrize("registry", [AccountStatus.UNKNOWN, AccountStatus.WARNING, AccountStatus.ARCHIVED])
def test_row_registry_unknown_warning_or_archived_is_never_compared(registry):
    for raw in ("1", "2", "3"):
        assert MISMATCH_KEY not in keys(facts_for([obs(1, raw)], registry=registry))


def test_row_missing_timezone_currency_or_insights_change_nothing():
    plain = s2(facts_for([obs(1, "2")]))
    bare = s2(facts_for([obs(1, "2", timezone_name=None, currency=None)]))
    assert [(c.rule_key, c.severity) for c in plain] == [(c.rule_key, c.severity) for c in bare]


# ------------------------------------------------------------------ beyond the table


def test_a_last_word_from_a_connection_that_no_longer_reads_is_kept():
    """Interpretation recorded in the S2 report: losing the reader is not a recovery."""
    facts = facts_for([obs(1, "2")], observable=False, registry=AccountStatus.ACTIVE)
    assert facts.platform_status.freshness is SpendFreshness.NOT_OBSERVABLE
    assert keys(facts) == {BLOCKING_KEY}


def test_previous_and_since_describe_the_change():
    observations = [obs(10, "1"), obs(8, "1"), obs(6, "2"), obs(4, "2"), obs(1, "2")]
    value = facts_for(observations).platform_status
    assert value.previous_account_status_raw == "1"
    assert value.previous_status is PlatformAccountStatus.ACTIVE
    assert value.previous_observed_at == observations[1].observed_at
    assert value.since_observed_at == observations[2].observed_at
    assert value.observation_id == observations[-1].id


def test_newest_code_wins_even_if_an_older_success_says_otherwise():
    facts = facts_for([obs(5, "1"), obs(1, "2", ok=False)])
    assert facts.platform_status.status is PlatformAccountStatus.DISABLED


def test_return_to_active_produces_no_candidate_at_all():
    facts = facts_for([obs(5, "2"), obs(1, "1")])
    assert s2(facts) == []  # the engine then resolves the open signal; no "recovered" candidate


def test_evidence_is_an_allowlist_and_labelled_as_a_platform_observation():
    facts = facts_for([obs(1, "2", reason_raw="15")], registry=AccountStatus.ACTIVE)
    for candidate in s2(facts):
        assert set(candidate.evidence) <= EVIDENCE_ALLOWLIST, set(candidate.evidence) - EVIDENCE_ALLOWLIST
        assert candidate.source_type is HealthSourceType.PROVIDER_OBSERVATION
        assert candidate.evidence["source"] == "Meta read-only observation (ad account node)"
        assert candidate.source_entity_type == "ad_account_spend_observation"
        for key in candidate.evidence:
            assert "score" not in key.lower() and "risk" not in key.lower()


def test_no_rule_emits_unknown_severity_and_scopes_are_one_per_account():
    for raw in ("1", "2", "3", "100", "201", "abc"):
        for registry in AccountStatus:
            for candidate in s2(facts_for([obs(1, raw)], registry=registry)):
                assert candidate.severity is not SignalSeverity.UNKNOWN
                assert candidate.scope in ("platform_status", "registry")


def test_the_same_code_on_a_newer_read_does_not_change_the_hash():
    first = s2(facts_for([obs(3, "2")]))[0]
    second = s2(facts_for([obs(3, "2"), obs(1, "2", ok=False)]))[0]
    assert first.evidence["observation_id"] != second.evidence["observation_id"]
    assert evidence_hash(first.evidence) == evidence_hash(second.evidence)


def test_sliding_context_keys_are_volatile():
    assert {
        "observation_id",
        "observed_at",
        "observation_status",
        "observation_failure_code",
        "previous_account_status_raw",
        "previous_observed_at",
        "since_observed_at",
    } <= VOLATILE_EVIDENCE_KEYS
    assert "spend_freshness" not in VOLATILE_EVIDENCE_KEYS
    assert "account_status_raw" not in VOLATILE_EVIDENCE_KEYS


def test_a_material_change_changes_the_hash():
    disabled = s2(facts_for([obs(1, "2")]))[0]
    closed = s2(facts_for([obs(1, "101")]))[0]
    other_reason = s2(facts_for([obs(1, "2", reason_raw="1")]))[0]
    stale = s2(facts_for([obs(30, "2")]))[0]
    hashes = {evidence_hash(c.evidence) for c in (disabled, closed, other_reason, stale)}
    assert len(hashes) == 4


def test_platform_status_rules_never_read_a_missing_facts_block():
    facts = facts_for([obs(1, "2")])
    facts.platform_status = None
    assert s2(facts) == []
