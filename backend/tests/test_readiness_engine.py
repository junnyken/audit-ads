"""Unit tests for the readiness rollup (A1 §Test Plan — Readiness rollup).

These build ORM objects in memory and call the engine directly: the rules under test are pure
functions of recorded facts, and testing them without a database keeps the failure message
about the rule rather than about fixtures.
"""
from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.core.enums import (
    AccountStatus,
    AccountType,
    ChecklistReviewStatus,
    EventSeverity,
    EventStatus,
    EvidenceStatus,
    ReadinessStatus,
)
from app.models.entities import AccountEvent, AdAccount, ReadinessChecklistItem
from app.services.checklist_config import DEFAULT_CHECKLIST, DEFAULT_CHECKLIST_BY_KEY
from app.services.readiness import AccountLinkFacts, evaluate_readiness

NOW = datetime(2026, 9, 4, 12, 0, tzinfo=UTC)


def make_account(**overrides) -> AdAccount:
    defaults = {
        "id": uuid.uuid4(),
        "workspace_id": uuid.uuid4(),
        "display_name": "Test account",
        "external_account_id": "act_1",
        "account_type": AccountType.BUSINESS_MANAGER,
        "business_manager_id": uuid.uuid4(),
        "personal_account_reference_id": None,
        "owner_label": "Operator",
        "status": AccountStatus.ACTIVE,
        "readiness_status": ReadinessStatus.UNKNOWN,
        "requires_page": False,
        "requires_pixel": False,
        "landing_page_url": None,
        "last_manual_review_at": NOW - timedelta(days=1),
        "last_synced_at": None,
        "archived_at": None,
        "tags": [],
        "notes": "",
    }
    defaults.update(overrides)
    return AdAccount(**defaults)


def make_items(**overrides) -> list[ReadinessChecklistItem]:
    """One row per default definition; operator items default to completed + verified."""
    items = []
    for definition in DEFAULT_CHECKLIST:
        state = overrides.get(definition.item_key, {})
        items.append(
            ReadinessChecklistItem(
                id=uuid.uuid4(),
                workspace_id=uuid.uuid4(),
                ad_account_id=uuid.uuid4(),
                item_key=definition.item_key,
                label=definition.label,
                category=definition.category,
                is_mandatory=definition.is_mandatory,
                evidence_status=state.get(
                    "evidence_status",
                    EvidenceStatus.VERIFIED if definition.requires_evidence else EvidenceStatus.MISSING,
                ),
                review_status=state.get("review_status", ChecklistReviewStatus.COMPLETED),
                expires_at=state.get("expires_at"),
                waiver_reason=state.get("waiver_reason", ""),
                notes="",
            )
        )
    return items


def full_facts() -> AccountLinkFacts:
    return AccountLinkFacts(
        has_active_page_link=True,
        has_active_pixel_link=True,
        has_active_browser_link=True,
        has_active_proxy_link=False,
        has_active_payment_link=True,
    )


def evaluate(account=None, items=None, events=(), facts=None):
    return evaluate_readiness(
        account or make_account(),
        items if items is not None else make_items(),
        events,
        facts or full_facts(),
        now=NOW,
    )


def test_complete_account_is_operationally_ready():
    result = evaluate()
    assert result.readiness_status == ReadinessStatus.OPERATIONALLY_READY.value
    assert result.completed_item_count == result.required_item_count
    assert any(reason.code == "all_required_items_satisfied" for reason in result.reasons)


def test_archived_account_is_unknown_with_archival_reason():
    result = evaluate(account=make_account(archived_at=NOW - timedelta(days=1)))
    assert result.readiness_status == ReadinessStatus.UNKNOWN.value
    assert result.reasons[0].code == "account_archived"
    assert "archived" in result.reasons[0].message.lower()


@pytest.mark.parametrize("status", [AccountStatus.RESTRICTED, AccountStatus.DISABLED])
def test_restricted_or_disabled_account_is_not_ready_even_when_complete(status):
    result = evaluate(account=make_account(status=status))
    assert result.readiness_status == ReadinessStatus.NOT_READY.value
    assert any(reason.code == f"account_status_{status.value}" for reason in result.reasons)


def test_missing_mandatory_evidence_is_unknown_with_item_reason():
    items = make_items(
        payment_method_reviewed={
            "evidence_status": EvidenceStatus.MISSING,
            "review_status": ChecklistReviewStatus.NOT_REVIEWED,
        }
    )
    result = evaluate(items=items)
    assert result.readiness_status == ReadinessStatus.UNKNOWN.value
    codes = {reason.code for reason in result.reasons}
    assert "payment_method_reviewed_incomplete" in codes


def test_expired_mandatory_evidence_prevents_operationally_ready():
    items = make_items(payment_method_reviewed={"evidence_status": EvidenceStatus.EXPIRED})
    result = evaluate(items=items)
    assert result.readiness_status == ReadinessStatus.NOT_READY.value
    assert any(reason.code == "payment_method_reviewed_blocked" for reason in result.reasons)


def test_rejected_mandatory_evidence_prevents_operationally_ready():
    items = make_items(ownership_confirmed={"evidence_status": EvidenceStatus.REJECTED})
    result = evaluate(items=items)
    assert result.readiness_status == ReadinessStatus.NOT_READY.value


def test_expired_review_date_prevents_operationally_ready():
    items = make_items(admin_access_reviewed={"expires_at": NOW - timedelta(days=1)})
    result = evaluate(items=items)
    assert result.readiness_status == ReadinessStatus.NOT_READY.value


def test_waiver_never_satisfies_a_required_item():
    items = make_items(
        billing_issue_checked={
            "review_status": ChecklistReviewStatus.WAIVED,
            "waiver_reason": "Handled by finance out of band",
        }
    )
    result = evaluate(items=items)
    assert result.readiness_status == ReadinessStatus.NOT_READY.value
    assert any("waiver" in reason.message.lower() for reason in result.reasons)


def make_event(severity: EventSeverity, status: EventStatus = EventStatus.OPEN) -> AccountEvent:
    return AccountEvent(
        id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        ad_account_id=uuid.uuid4(),
        event_type="observed",
        severity=severity,
        source="manual",
        occurred_at=NOW - timedelta(hours=1),
        summary="Observed something",
        status=status,
        archived_at=None,
        resolution_note="",
    )


def test_unresolved_warning_event_yields_ready_with_warnings():
    result = evaluate(events=[make_event(EventSeverity.WARNING)])
    assert result.readiness_status == ReadinessStatus.READY_WITH_WARNINGS.value
    assert any(reason.code == "unresolved_warning_event" for reason in result.reasons)


def test_unresolved_critical_event_yields_not_ready():
    result = evaluate(events=[make_event(EventSeverity.CRITICAL)])
    assert result.readiness_status == ReadinessStatus.NOT_READY.value


def test_resolved_events_do_not_block():
    result = evaluate(events=[make_event(EventSeverity.CRITICAL, EventStatus.RESOLVED)])
    assert result.readiness_status == ReadinessStatus.OPERATIONALLY_READY.value


def test_info_events_do_not_downgrade_readiness():
    result = evaluate(events=[make_event(EventSeverity.INFO)])
    assert result.readiness_status == ReadinessStatus.OPERATIONALLY_READY.value


def test_bm_item_required_only_for_business_manager_accounts():
    bm_result = evaluate(account=make_account(account_type=AccountType.BUSINESS_MANAGER))
    bm_item = next(i for i in bm_result.items if i.item_key == "business_manager_confirmed")
    assert bm_item.required is True

    personal_result = evaluate(
        account=make_account(
            account_type=AccountType.PERSONAL_REFERENCE,
            business_manager_id=None,
            personal_account_reference_id=uuid.uuid4(),
        )
    )
    bm_item = next(i for i in personal_result.items if i.item_key == "business_manager_confirmed")
    assert bm_item.required is False
    personal_item = next(
        i for i in personal_result.items if i.item_key == "personal_account_reference_confirmed"
    )
    assert personal_item.required is True
    assert personal_result.readiness_status == ReadinessStatus.OPERATIONALLY_READY.value


def test_manual_review_past_interval_prevents_operationally_ready():
    result = evaluate(account=make_account(last_manual_review_at=NOW - timedelta(days=365)))
    assert result.readiness_status == ReadinessStatus.NOT_READY.value
    assert any(reason.code == "last_manual_review_completed_blocked" for reason in result.reasons)


def test_account_never_manually_reviewed_is_unknown():
    result = evaluate(account=make_account(last_manual_review_at=None))
    assert result.readiness_status == ReadinessStatus.UNKNOWN.value


def test_browser_reference_alone_cannot_make_an_account_ready():
    """A1 Guardrail 7: an operational reference is never sufficient on its own."""
    empty_items = make_items(
        **{
            definition.item_key: {
                "review_status": ChecklistReviewStatus.NOT_REVIEWED,
                "evidence_status": EvidenceStatus.MISSING,
            }
            for definition in DEFAULT_CHECKLIST
        }
    )
    facts = AccountLinkFacts(has_active_browser_link=True, has_active_proxy_link=True)
    result = evaluate(items=empty_items, facts=facts)
    assert result.readiness_status != ReadinessStatus.OPERATIONALLY_READY.value


def test_proxy_item_is_advisory_and_never_blocks():
    facts = full_facts()
    facts.has_active_proxy_link = True
    result = evaluate(facts=facts)
    assert result.readiness_status == ReadinessStatus.OPERATIONALLY_READY.value
    advisory = next(i for i in result.items if i.item_key == "proxy_reference_reviewed")
    assert advisory.required is False


def test_page_and_pixel_items_required_only_when_the_workflow_needs_them():
    account = make_account(requires_page=True, requires_pixel=False)
    facts = AccountLinkFacts(has_active_page_link=False, has_active_browser_link=True)
    result = evaluate(account=account, facts=facts)
    page_item = next(i for i in result.items if i.item_key == "page_linked")
    pixel_item = next(i for i in result.items if i.item_key == "pixel_linked")
    assert page_item.required is True and page_item.state == "unknown"
    assert pixel_item.required is False
    assert result.readiness_status == ReadinessStatus.UNKNOWN.value


def test_landing_page_items_required_only_when_a_landing_page_is_assigned():
    account = make_account(landing_page_url="https://example.test/offer")
    result = evaluate(account=account)
    keys = {i.item_key: i for i in result.items}
    assert keys["landing_page_verified"].required is True
    assert keys["contact_policy_verified"].required is True


def test_unknown_account_status_is_not_treated_as_healthy():
    result = evaluate(account=make_account(status=AccountStatus.UNKNOWN))
    assert result.readiness_status == ReadinessStatus.UNKNOWN.value
    assert any(reason.code == "account_status_unknown" for reason in result.reasons)


def test_data_freshness_is_unknown_when_never_synced():
    result = evaluate()
    assert result.data_freshness["status"] == "unknown"
    assert result.data_freshness["last_synced_at"] is None


def test_data_freshness_reports_stale_for_old_syncs():
    result = evaluate(account=make_account(last_synced_at=NOW - timedelta(days=90)))
    assert result.data_freshness["status"] == "stale"


def test_no_reason_message_makes_a_safety_or_approval_claim():
    """A1 forbids claiming an account is safe or an ad approved.

    "guarantee" is allowed only inside an explicit denial ("not a guarantee against
    restriction"); an affirmative use would be exactly the claim the spec bans.
    """
    affirmative = re.compile(
        r"\bis guaranteed\b|\bguarantees\b|\bwill be approved\b|\bsafe from\b"
        r"|\bcannot be restricted\b|\bwon't be restricted\b",
        re.IGNORECASE,
    )
    negated_guarantee = re.compile(r"(not a|no|never a)\s+guarantee", re.IGNORECASE)
    for status in (AccountStatus.ACTIVE, AccountStatus.RESTRICTED, AccountStatus.UNKNOWN):
        result = evaluate(account=make_account(status=status))
        for reason in result.reasons:
            assert not affirmative.search(reason.message), reason.message
            if "guarantee" in reason.message.lower():
                assert negated_guarantee.search(reason.message), reason.message


def test_every_default_item_has_a_stable_key_and_requirement_note():
    assert len(DEFAULT_CHECKLIST) == len(DEFAULT_CHECKLIST_BY_KEY) == 14
    for definition in DEFAULT_CHECKLIST:
        assert definition.item_key == definition.item_key.lower()
        assert definition.requirement_note
