"""Unit tests for the A2 health engine (MINI-SPEC A2 §10.1).

Pure functions, in-memory objects, no database: a failure here points at a rule, not a fixture.
The A1 readiness helpers are reused deliberately — health is defined in terms of A1 facts, so
the tests should be too.
"""
from __future__ import annotations

import uuid
from datetime import timedelta

import pytest

from app.core.enums import (
    AccountStatus,
    ChecklistReviewStatus,
    EventSeverity,
    EventStatus,
    EvidenceStatus,
    HealthFreshness,
    HealthStatus,
    ReadinessStatus,
    SignalSeverity,
    SignalStatus,
)
from app.models.health import AccountHealthSignal
from app.services.health_engine import (
    CLEAR_SIGNALS_LABEL,
    HEALTH_STATUS_DESCRIPTION,
    build_candidates,
    derive_freshness,
    roll_up,
)
from app.services.health_rules import HEALTH_RULES_BY_KEY, HealthFacts
from app.services.readiness import evaluate_readiness
from tests.test_readiness_engine import NOW, full_facts, make_account, make_event, make_items

ALL_RULES = set(HEALTH_RULES_BY_KEY)


def build_facts(account=None, items=None, events=(), links=None, checklist_present=True):
    account = account or make_account()
    items = make_items() if items is None else items
    links = links or full_facts()
    readiness = evaluate_readiness(account, items, events, links, now=NOW)
    return HealthFacts(
        account=account,
        readiness=readiness,
        checklist_items=list(items) if checklist_present else [],
        unresolved_events=[event for event in events if event.is_unresolved],
        now=NOW,
        manual_review_due_after_days=30,
    )


def keys(candidates) -> list[str]:
    return [candidate.rule_key for candidate in candidates]


# --------------------------------------------------------------------- rule evaluation
def test_restricted_status_raises_a_critical_candidate():
    facts = build_facts(account=make_account(status=AccountStatus.RESTRICTED))
    candidates = build_candidates(facts, ALL_RULES)
    restricted = next(c for c in candidates if c.rule_key == "account_restricted_status")
    assert restricted.severity == SignalSeverity.CRITICAL
    assert restricted.signal_key == "account_restricted_status:account"
    assert restricted.evidence["account_status"] == "restricted"


def test_disabled_status_raises_a_critical_candidate():
    facts = build_facts(account=make_account(status=AccountStatus.DISABLED))
    assert "account_disabled_status" in keys(build_candidates(facts, ALL_RULES))


def test_status_returning_to_active_removes_the_status_candidate():
    """The lifecycle closes a signal by no longer producing its candidate."""
    restricted = build_candidates(build_facts(account=make_account(status=AccountStatus.RESTRICTED)), ALL_RULES)
    active = build_candidates(build_facts(account=make_account(status=AccountStatus.ACTIVE)), ALL_RULES)
    assert "account_restricted_status" in keys(restricted)
    assert "account_restricted_status" not in keys(active)


def test_open_critical_event_produces_one_critical_candidate_per_event():
    events = [make_event(EventSeverity.CRITICAL), make_event(EventSeverity.CRITICAL)]
    candidates = build_candidates(build_facts(events=events), ALL_RULES)
    critical = [c for c in candidates if c.rule_key == "critical_account_event_open"]
    assert len(critical) == 2
    assert {c.source_entity_id for c in critical} == {str(e.id) for e in events}
    assert all(c.source_entity_type == "account_event" for c in critical)
    # A manual observation must never look like platform-sourced evidence.
    assert all(c.source_type.value == "manual_event" for c in critical)


def test_resolved_source_event_produces_no_candidate():
    events = [make_event(EventSeverity.CRITICAL, EventStatus.RESOLVED)]
    assert "critical_account_event_open" not in keys(build_candidates(build_facts(events=events), ALL_RULES))


def test_open_warning_event_produces_a_warning_candidate():
    candidates = build_candidates(build_facts(events=[make_event(EventSeverity.WARNING)]), ALL_RULES)
    warning = next(c for c in candidates if c.rule_key == "warning_account_event_open")
    assert warning.severity == SignalSeverity.WARNING


def test_missing_mandatory_evidence_produces_an_attention_candidate_listing_items():
    items = make_items(
        payment_method_reviewed={
            "evidence_status": EvidenceStatus.MISSING,
            "review_status": ChecklistReviewStatus.NOT_REVIEWED,
        }
    )
    candidates = build_candidates(build_facts(items=items), ALL_RULES)
    missing = next(c for c in candidates if c.rule_key == "mandatory_readiness_evidence_missing")
    assert missing.severity == SignalSeverity.ATTENTION
    assert "payment_method_reviewed" in missing.evidence["item_keys"]


def test_expired_mandatory_evidence_produces_a_warning_candidate():
    items = make_items(payment_method_reviewed={"evidence_status": EvidenceStatus.EXPIRED})
    candidates = build_candidates(build_facts(items=items), ALL_RULES)
    expired = next(c for c in candidates if c.rule_key == "mandatory_readiness_evidence_expired")
    assert expired.severity == SignalSeverity.WARNING
    assert "payment_method_reviewed" in expired.evidence["item_keys"]


def test_readiness_unknown_produces_attention_not_clear():
    items = make_items(
        ownership_confirmed={
            "evidence_status": EvidenceStatus.MISSING,
            "review_status": ChecklistReviewStatus.NOT_REVIEWED,
        }
    )
    facts = build_facts(items=items)
    assert facts.readiness.readiness_status == ReadinessStatus.UNKNOWN.value
    candidates = build_candidates(facts, ALL_RULES)
    unknown = next(c for c in candidates if c.rule_key == "readiness_unknown")
    assert unknown.severity == SignalSeverity.ATTENTION


def test_stale_manual_review_produces_a_warning_with_the_policy_interval():
    facts = build_facts(account=make_account(last_manual_review_at=NOW - timedelta(days=400)))
    candidate = next(
        c for c in build_candidates(facts, ALL_RULES) if c.rule_key == "manual_review_due_or_stale"
    )
    assert candidate.severity == SignalSeverity.WARNING
    assert candidate.evidence["policy_interval_days"] == 30


def test_never_reviewed_account_also_raises_the_manual_review_rule():
    facts = build_facts(account=make_account(last_manual_review_at=None))
    candidate = next(
        c for c in build_candidates(facts, ALL_RULES) if c.rule_key == "manual_review_due_or_stale"
    )
    assert candidate.evidence["last_manual_review_at"] is None
    assert "never" in candidate.evidence["message"].lower()


def test_missing_checklist_inputs_raise_an_unknown_severity_candidate():
    facts = build_facts(checklist_present=False)
    candidate = next(
        c for c in build_candidates(facts, ALL_RULES) if c.rule_key == "account_data_stale_or_unknown"
    )
    assert candidate.severity == SignalSeverity.UNKNOWN


def test_readiness_not_ready_is_suppressed_when_a_critical_fact_already_explains_it():
    facts = build_facts(account=make_account(status=AccountStatus.RESTRICTED))
    assert facts.readiness.readiness_status == ReadinessStatus.NOT_READY.value
    candidates = keys(build_candidates(facts, ALL_RULES))
    assert "account_restricted_status" in candidates
    assert "readiness_not_ready" not in candidates


def test_readiness_not_ready_is_emitted_when_no_critical_fact_explains_it():
    items = make_items(payment_method_reviewed={"evidence_status": EvidenceStatus.EXPIRED})
    facts = build_facts(items=items)
    assert facts.readiness.readiness_status == ReadinessStatus.NOT_READY.value
    assert "readiness_not_ready" in keys(build_candidates(facts, ALL_RULES))


def test_a_disabled_rule_produces_nothing():
    facts = build_facts(account=make_account(status=AccountStatus.RESTRICTED))
    enabled = ALL_RULES - {"account_restricted_status"}
    assert "account_restricted_status" not in keys(build_candidates(facts, enabled))


def test_candidate_order_is_deterministic_and_worst_first():
    events = [make_event(EventSeverity.WARNING), make_event(EventSeverity.CRITICAL)]
    items = make_items(
        payment_method_reviewed={
            "evidence_status": EvidenceStatus.MISSING,
            "review_status": ChecklistReviewStatus.NOT_REVIEWED,
        }
    )
    facts = build_facts(account=make_account(status=AccountStatus.RESTRICTED), items=items, events=events)
    first = build_candidates(facts, ALL_RULES)
    second = build_candidates(facts, ALL_RULES)
    assert [c.signal_key for c in first] == [c.signal_key for c in second]
    severities = [c.severity for c in first]
    assert severities == sorted(
        severities, key=lambda sev: ["critical", "warning", "attention", "unknown"].index(sev.value)
    )


def test_signal_key_is_stable_for_identical_source_state():
    facts = build_facts(account=make_account(status=AccountStatus.RESTRICTED))
    a = build_candidates(facts, ALL_RULES)
    b = build_candidates(build_facts(account=make_account(status=AccountStatus.RESTRICTED)), ALL_RULES)
    assert {c.signal_key for c in a} == {c.signal_key for c in b}


# --------------------------------------------------------------------------- rollup
def make_signal(severity: SignalSeverity, status: SignalStatus = SignalStatus.OPEN, rule_key="r"):
    return AccountHealthSignal(
        id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        ad_account_id=uuid.uuid4(),
        rule_key=rule_key,
        rule_version=1,
        signal_key=f"{rule_key}:x",
        severity=severity,
        status=status,
        evidence_json={"message": f"{rule_key} fired"},
        observed_at=NOW,
        last_evaluated_at=NOW,
    )


def test_any_active_critical_signal_yields_critical_health():
    result = roll_up(
        [make_signal(SignalSeverity.CRITICAL), make_signal(SignalSeverity.WARNING)],
        now=NOW,
        freshness=HealthFreshness.CURRENT,
    )
    assert result.health_status == HealthStatus.CRITICAL.value
    assert result.counts == {"critical": 1, "warning": 1, "attention": 0, "unknown": 0}


def test_warning_without_critical_yields_warning():
    result = roll_up([make_signal(SignalSeverity.WARNING)], now=NOW, freshness=HealthFreshness.CURRENT)
    assert result.health_status == HealthStatus.WARNING.value


def test_attention_without_warning_or_critical_yields_attention_needed():
    result = roll_up([make_signal(SignalSeverity.ATTENTION)], now=NOW, freshness=HealthFreshness.CURRENT)
    assert result.health_status == HealthStatus.ATTENTION_NEEDED.value


def test_no_signals_with_current_data_yields_clear_signals():
    result = roll_up([], now=NOW, freshness=HealthFreshness.CURRENT)
    assert result.health_status == HealthStatus.CLEAR_SIGNALS.value


def test_no_signals_with_stale_data_yields_unknown_not_clear():
    result = roll_up([], now=NOW, freshness=HealthFreshness.STALE)
    assert result.health_status == HealthStatus.UNKNOWN.value
    assert result.summary_reasons[0].code == "health_evaluation_stale"


def test_unknown_severity_signal_blocks_clear_signals():
    result = roll_up([make_signal(SignalSeverity.UNKNOWN)], now=NOW, freshness=HealthFreshness.CURRENT)
    assert result.health_status == HealthStatus.UNKNOWN.value


def test_acknowledged_signals_still_count_towards_health():
    for severity, expected in (
        (SignalSeverity.CRITICAL, HealthStatus.CRITICAL.value),
        (SignalSeverity.WARNING, HealthStatus.WARNING.value),
    ):
        result = roll_up(
            [make_signal(severity, SignalStatus.ACKNOWLEDGED)],
            now=NOW,
            freshness=HealthFreshness.CURRENT,
        )
        assert result.health_status == expected


@pytest.mark.parametrize(
    "status", [SignalStatus.RESOLVED, SignalStatus.EXPIRED, SignalStatus.SUPERSEDED]
)
def test_inactive_signals_do_not_contribute(status):
    result = roll_up(
        [make_signal(SignalSeverity.CRITICAL, status)], now=NOW, freshness=HealthFreshness.CURRENT
    )
    assert result.health_status == HealthStatus.CLEAR_SIGNALS.value
    assert result.counts["critical"] == 0


def test_archived_account_is_unknown_and_not_applicable():
    result = roll_up([], now=NOW, freshness=HealthFreshness.NOT_APPLICABLE, archived=True)
    assert result.health_status == HealthStatus.UNKNOWN.value
    assert result.summary_reasons[0].code == "account_archived"


def test_failed_evaluation_never_reports_a_clear_result():
    result = roll_up([], now=NOW, freshness=HealthFreshness.STALE, evaluation_failed=True)
    assert result.health_status == HealthStatus.UNKNOWN.value
    assert result.summary_reasons[0].code == "health_evaluation_failed"


def test_reason_ordering_is_deterministic_worst_first():
    signals = [
        make_signal(SignalSeverity.ATTENTION, rule_key="b_attention"),
        make_signal(SignalSeverity.CRITICAL, rule_key="a_critical"),
        make_signal(SignalSeverity.WARNING, rule_key="c_warning"),
    ]
    first = roll_up(signals, now=NOW, freshness=HealthFreshness.CURRENT)
    second = roll_up(list(reversed(signals)), now=NOW, freshness=HealthFreshness.CURRENT)
    assert [r.code for r in first.summary_reasons] == [r.code for r in second.summary_reasons]
    assert [r.severity for r in first.summary_reasons] == ["critical", "warning", "attention"]


# ------------------------------------------------------------------------ freshness
def test_freshness_is_unknown_when_never_evaluated():
    assert derive_freshness(None, now=NOW, stale_after_hours=24) == HealthFreshness.UNKNOWN


def test_freshness_is_current_within_the_policy_window():
    assert derive_freshness(NOW - timedelta(hours=1), now=NOW, stale_after_hours=24) == HealthFreshness.CURRENT


def test_freshness_is_stale_beyond_the_policy_window():
    assert derive_freshness(NOW - timedelta(hours=48), now=NOW, stale_after_hours=24) == HealthFreshness.STALE


def test_archived_freshness_is_not_applicable():
    assert (
        derive_freshness(NOW, now=NOW, stale_after_hours=24, archived=True)
        == HealthFreshness.NOT_APPLICABLE
    )


# ----------------------------------------------------------------------- vocabulary
def test_clear_signals_is_never_described_as_safe():
    banned = ("safe", "protected", "unbanned", "approved", "immune", "guaranteed", "no ban")
    for text in HEALTH_STATUS_DESCRIPTION.values():
        lowered = text.lower()
        for word in banned:
            if word in lowered:
                # The only permitted occurrences are explicit denials.
                assert "not a platform approval" in lowered or "not a guarantee" in lowered, text
    assert CLEAR_SIGNALS_LABEL == "No current issues found by configured checks"


def test_every_rule_carries_guidance_for_the_operator():
    assert len(HEALTH_RULES_BY_KEY) == 10
    for rule in HEALTH_RULES_BY_KEY.values():
        assert rule.why_it_matters and rule.recommended_next_step and rule.resolution_guidance
        assert rule.version >= 1


def test_no_rule_emits_a_numeric_score():
    facts = build_facts(account=make_account(status=AccountStatus.RESTRICTED))
    for candidate in build_candidates(facts, ALL_RULES):
        for key in candidate.evidence:
            assert "score" not in key.lower()
            assert "risk" not in key.lower()
