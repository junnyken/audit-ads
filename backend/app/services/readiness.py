"""ReadinessRollupService — deterministic, explainable, no numerical score (A1 §D).

The engine answers one question: *given only what is recorded, what can be justified?*
It never upgrades a state because data is absent. Missing data yields `unknown`; recorded
problems yield `not_ready`. Nothing here predicts future platform behaviour, and no message
claims an account is safe or that an ad will be approved.
"""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.config import get_settings
from app.core.enums import (
    AccountStatus,
    AccountType,
    ChecklistReviewStatus,
    DataFreshness,
    EventSeverity,
    EvidenceStatus,
    ReadinessStatus,
    ReasonSeverity,
)
from app.models.entities import AccountEvent, AdAccount, ReadinessChecklistItem
from app.services.checklist_config import (
    ADVISORY_ITEM_KEYS,
    CONDITION_ACCOUNT_TYPE_BM,
    CONDITION_ACCOUNT_TYPE_PERSONAL,
    CONDITION_HAS_LANDING_PAGE,
    CONDITION_HAS_PROXY,
    CONDITION_REQUIRES_PAGE,
    CONDITION_REQUIRES_PIXEL,
    DEFAULT_CHECKLIST_BY_KEY,
    DERIVED_BM_LINK,
    DERIVED_BROWSER_LINK,
    DERIVED_MANUAL_REVIEW,
    DERIVED_PAGE_LINK,
    DERIVED_PERSONAL_LINK,
    DERIVED_PIXEL_LINK,
    ChecklistItemDefinition,
)

#: Per-item outcome vocabulary used by the engine and rendered by the Readiness tab.
STATE_SATISFIED = "satisfied"
STATE_UNKNOWN = "unknown"
STATE_PROBLEM = "problem"
STATE_NOT_REQUIRED = "not_required"


@dataclass
class AccountLinkFacts:
    """Derived facts the engine needs. Gathered once per evaluation, never guessed."""

    has_active_page_link: bool = False
    has_active_pixel_link: bool = False
    has_active_browser_link: bool = False
    has_active_proxy_link: bool = False
    has_active_payment_link: bool = False


@dataclass
class ItemEvaluation:
    item_key: str
    label: str
    category: str
    state: str
    required: bool
    is_mandatory: bool
    requirement_reason: str
    derived_from: str | None
    requires_evidence: bool
    evidence_status: str
    review_status: str
    expires_at: datetime | None
    message: str
    checklist_item_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["expires_at"] = self.expires_at.isoformat() if self.expires_at else None
        return data


@dataclass
class ReadinessReason:
    code: str
    severity: str
    source_type: str
    source_id: str | None
    message: str


@dataclass
class ReadinessResult:
    ad_account_id: str
    readiness_status: str
    evaluated_at: datetime
    required_item_count: int
    completed_item_count: int
    reasons: list[ReadinessReason] = field(default_factory=list)
    items: list[ItemEvaluation] = field(default_factory=list)
    data_freshness: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ad_account_id": self.ad_account_id,
            "readiness_status": self.readiness_status,
            "evaluated_at": self.evaluated_at.isoformat(),
            "required_item_count": self.required_item_count,
            "completed_item_count": self.completed_item_count,
            "reasons": [asdict(reason) for reason in self.reasons],
            "items": [item.to_dict() for item in self.items],
            "data_freshness": self.data_freshness,
        }


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def is_condition_met(condition: str | None, account: AdAccount, facts: AccountLinkFacts) -> bool:
    if condition is None:
        return True
    if condition == CONDITION_ACCOUNT_TYPE_BM:
        return account.account_type == AccountType.BUSINESS_MANAGER
    if condition == CONDITION_ACCOUNT_TYPE_PERSONAL:
        return account.account_type == AccountType.PERSONAL_REFERENCE
    if condition == CONDITION_REQUIRES_PAGE:
        return bool(account.requires_page)
    if condition == CONDITION_REQUIRES_PIXEL:
        return bool(account.requires_pixel)
    if condition == CONDITION_HAS_LANDING_PAGE:
        return bool(account.landing_page_url)
    if condition == CONDITION_HAS_PROXY:
        return facts.has_active_proxy_link
    return False


def manual_review_is_current(account: AdAccount, *, now: datetime, interval_days: int) -> bool | None:
    """True/False when a review timestamp exists, None when it never happened."""
    reviewed_at = _aware(account.last_manual_review_at)
    if reviewed_at is None:
        return None
    return reviewed_at >= now - timedelta(days=interval_days)


def _derived_state(
    definition: ChecklistItemDefinition,
    account: AdAccount,
    facts: AccountLinkFacts,
    *,
    now: datetime,
    interval_days: int,
) -> tuple[str, str]:
    """Return (state, message) for a derived item."""
    if definition.derived_from == DERIVED_BM_LINK:
        if account.business_manager_id is not None:
            return STATE_SATISFIED, "Mapped to a Business Manager record."
        return STATE_UNKNOWN, "No Business Manager is mapped to this account."
    if definition.derived_from == DERIVED_PERSONAL_LINK:
        if account.personal_account_reference_id is not None:
            return STATE_SATISFIED, "Mapped to a personal-account reference record."
        return STATE_UNKNOWN, "No personal-account reference is mapped to this account."
    if definition.derived_from == DERIVED_PAGE_LINK:
        if facts.has_active_page_link:
            return STATE_SATISFIED, "An active Page link exists."
        return STATE_UNKNOWN, "No active Page link is recorded."
    if definition.derived_from == DERIVED_PIXEL_LINK:
        if facts.has_active_pixel_link:
            return STATE_SATISFIED, "An active Pixel link exists."
        return STATE_UNKNOWN, "No active Pixel link is recorded."
    if definition.derived_from == DERIVED_BROWSER_LINK:
        if facts.has_active_browser_link:
            return STATE_SATISFIED, "An active browser-profile reference is assigned."
        return STATE_UNKNOWN, "No active browser-profile reference is assigned."
    if definition.derived_from == DERIVED_MANUAL_REVIEW:
        current = manual_review_is_current(account, now=now, interval_days=interval_days)
        if current is None:
            return STATE_UNKNOWN, "This account has never been manually reviewed."
        if current:
            return STATE_SATISFIED, "The manual review is within the configured interval."
        return (
            STATE_PROBLEM,
            f"The last manual review is older than the configured {interval_days}-day interval.",
        )
    return STATE_UNKNOWN, "No derived source is available for this item."


def _operator_state(item: ReadinessChecklistItem, definition: ChecklistItemDefinition, *, now: datetime) -> tuple[str, str]:
    expires_at = _aware(item.expires_at)
    if item.review_status == ChecklistReviewStatus.NEEDS_UPDATE:
        return STATE_PROBLEM, "The review is marked as needing an update."
    if item.evidence_status == EvidenceStatus.REJECTED:
        return STATE_PROBLEM, "The supplied evidence was rejected."
    if item.evidence_status == EvidenceStatus.EXPIRED:
        return STATE_PROBLEM, "The supplied evidence has expired."
    if expires_at is not None and expires_at <= now:
        return STATE_PROBLEM, "This review has passed its expiry date."
    if item.review_status == ChecklistReviewStatus.WAIVED:
        # A1 §B: a waiver never satisfies a mandatory item by default.
        return STATE_PROBLEM, "A waiver was recorded; a waiver does not satisfy a required item."
    if item.review_status == ChecklistReviewStatus.COMPLETED:
        if not definition.requires_evidence:
            return STATE_SATISFIED, "Review completed."
        if item.evidence_status == EvidenceStatus.VERIFIED:
            return STATE_SATISFIED, "Review completed and evidence verified."
        return STATE_UNKNOWN, "Review completed, but no verified evidence is attached."
    if item.review_status == ChecklistReviewStatus.IN_REVIEW:
        return STATE_UNKNOWN, "The review is still in progress."
    return STATE_UNKNOWN, "This item has not been reviewed."


def evaluate_readiness(
    account: AdAccount,
    checklist_items: Iterable[ReadinessChecklistItem],
    events: Iterable[AccountEvent],
    facts: AccountLinkFacts,
    *,
    now: datetime | None = None,
) -> ReadinessResult:
    settings = get_settings()
    now = now or datetime.now(UTC)
    interval_days = settings.readiness_manual_review_interval_days

    items_by_key = {item.item_key: item for item in checklist_items}
    evaluations: list[ItemEvaluation] = []
    reasons: list[ReadinessReason] = []

    # ---- data freshness -------------------------------------------------------------
    last_synced_at = _aware(account.last_synced_at)
    if last_synced_at is None:
        freshness = DataFreshness.UNKNOWN
    elif last_synced_at >= now - timedelta(days=settings.data_freshness_stale_after_days):
        freshness = DataFreshness.CURRENT
    else:
        freshness = DataFreshness.STALE
    data_freshness = {
        "status": freshness.value,
        "last_synced_at": last_synced_at.isoformat() if last_synced_at else None,
    }

    # ---- per-item evaluation --------------------------------------------------------
    for key, definition in DEFAULT_CHECKLIST_BY_KEY.items():
        item = items_by_key.get(key)
        required = is_condition_met(definition.condition, account, facts) and key not in ADVISORY_ITEM_KEYS
        if definition.derived_from:
            state, message = _derived_state(
                definition, account, facts, now=now, interval_days=interval_days
            )
        elif item is None:
            state, message = STATE_UNKNOWN, "This checklist item has not been initialised."
        else:
            state, message = _operator_state(item, definition, now=now)

        if not required:
            if key in ADVISORY_ITEM_KEYS and is_condition_met(definition.condition, account, facts):
                # Advisory: surfaced so it is visible, but it can never block readiness.
                if state != STATE_SATISFIED:
                    reasons.append(
                        ReadinessReason(
                            code="proxy_reference_not_reviewed",
                            severity=ReasonSeverity.INFO.value,
                            source_type="checklist_item",
                            source_id=str(item.id) if item else None,
                            message="A proxy reference is assigned but has not been reviewed. This does not affect readiness.",
                        )
                    )
                effective_state = STATE_NOT_REQUIRED
                message = "Optional. " + message
            else:
                effective_state = STATE_NOT_REQUIRED
                message = "Not required for this account."
        else:
            effective_state = state

        evaluations.append(
            ItemEvaluation(
                item_key=key,
                label=definition.label,
                category=definition.category.value,
                state=effective_state,
                required=required,
                is_mandatory=definition.is_mandatory,
                requirement_reason=(
                    definition.requirement_note
                    if required
                    else "Not required for this account under the current configuration."
                ),
                derived_from=definition.derived_from,
                requires_evidence=definition.requires_evidence,
                evidence_status=(item.evidence_status.value if item else EvidenceStatus.MISSING.value),
                review_status=(
                    item.review_status.value if item else ChecklistReviewStatus.NOT_REVIEWED.value
                ),
                expires_at=item.expires_at if item else None,
                message=message,
                checklist_item_id=str(item.id) if item else None,
            )
        )

    required_items = [item for item in evaluations if item.required]
    satisfied_items = [item for item in required_items if item.state == STATE_SATISFIED]
    problem_items = [item for item in required_items if item.state == STATE_PROBLEM]
    unknown_items = [item for item in required_items if item.state == STATE_UNKNOWN]

    # ---- unresolved events ----------------------------------------------------------
    unresolved = [event for event in events if event.is_unresolved]
    critical_events = [e for e in unresolved if e.severity == EventSeverity.CRITICAL]
    warning_events = [e for e in unresolved if e.severity == EventSeverity.WARNING]

    def build(status: ReadinessStatus) -> ReadinessResult:
        return ReadinessResult(
            ad_account_id=str(account.id),
            readiness_status=status.value,
            evaluated_at=now,
            required_item_count=len(required_items),
            completed_item_count=len(satisfied_items),
            reasons=reasons,
            items=evaluations,
            data_freshness=data_freshness,
        )

    # ---- rule 1: archived accounts are excluded from active assessment ---------------
    if account.archived_at is not None:
        reasons.insert(
            0,
            ReadinessReason(
                code="account_archived",
                severity=ReasonSeverity.INFO.value,
                source_type="ad_account",
                source_id=str(account.id),
                message="Archived account is excluded from active readiness assessment.",
            ),
        )
        return build(ReadinessStatus.UNKNOWN)

    # ---- rule 2: platform status that requires manual review ------------------------
    status_blocked = account.status in (AccountStatus.RESTRICTED, AccountStatus.DISABLED)
    if status_blocked:
        reasons.append(
            ReadinessReason(
                code=f"account_status_{account.status.value}",
                severity=ReasonSeverity.CRITICAL.value,
                source_type="ad_account",
                source_id=str(account.id),
                message=f"Account status is {account.status.value}; this requires manual review.",
            )
        )

    # ---- rule 5: unresolved critical events -----------------------------------------
    for event in critical_events:
        reasons.append(
            ReadinessReason(
                code="unresolved_critical_event",
                severity=ReasonSeverity.CRITICAL.value,
                source_type="account_event",
                source_id=str(event.id),
                message=f"Unresolved critical event: {event.summary or event.event_type}",
            )
        )

    # ---- rule 4: item-level reasons --------------------------------------------------
    for item in problem_items:
        reasons.append(
            ReadinessReason(
                code=f"{item.item_key}_blocked",
                severity=ReasonSeverity.WARNING.value,
                source_type="checklist_item",
                source_id=item.checklist_item_id,
                message=f"{item.label}: {item.message}",
            )
        )
    for item in unknown_items:
        reasons.append(
            ReadinessReason(
                code=f"{item.item_key}_incomplete",
                severity=ReasonSeverity.WARNING.value,
                source_type="checklist_item",
                source_id=item.checklist_item_id,
                message=f"{item.label}: {item.message}",
            )
        )

    if status_blocked or critical_events or problem_items:
        return build(ReadinessStatus.NOT_READY)

    if unknown_items:
        return build(ReadinessStatus.UNKNOWN)

    # ---- rule 8: no confident result while the account's own status is unrecorded ----
    if account.status == AccountStatus.UNKNOWN:
        reasons.append(
            ReadinessReason(
                code="account_status_unknown",
                severity=ReasonSeverity.WARNING.value,
                source_type="ad_account",
                source_id=str(account.id),
                message="Account status has not been recorded, so readiness cannot be confirmed.",
            )
        )
        return build(ReadinessStatus.UNKNOWN)

    # ---- rule 6: everything required is satisfied, warnings remain -------------------
    if warning_events:
        for event in warning_events:
            reasons.append(
                ReadinessReason(
                    code="unresolved_warning_event",
                    severity=ReasonSeverity.WARNING.value,
                    source_type="account_event",
                    source_id=str(event.id),
                    message=f"Unresolved warning event: {event.summary or event.event_type}",
                )
            )
        return build(ReadinessStatus.READY_WITH_WARNINGS)

    # ---- rule 7: operationally ready --------------------------------------------------
    reasons.append(
        ReadinessReason(
            code="all_required_items_satisfied",
            severity=ReasonSeverity.INFO.value,
            source_type="ad_account",
            source_id=str(account.id),
            message=(
                "All required checklist items are satisfied, the manual review is current, and no "
                "unresolved warning or critical event exists. This is an internal operational "
                "state: it is not a platform approval, and it is not a guarantee against "
                "restriction."
            ),
        )
    )
    return build(ReadinessStatus.OPERATIONALLY_READY)
