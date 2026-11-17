"""Default readiness checklist (MINI-SPEC A1 §C).

`item_key` values are stable contract; labels are display text and may be localised.

Two kinds of item exist:

* **Operator items** — the operator performs a review and, where required, attaches evidence.
* **Derived items** — the required outcome *is* a fact the system already holds (an active link,
  a review timestamp). These are computed, never hand-marked, so an operator cannot tick
  "browser reference assigned" while no reference is assigned.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.core.enums import ChecklistCategory


@dataclass(frozen=True)
class ChecklistItemDefinition:
    item_key: str
    label: str
    category: ChecklistCategory
    is_mandatory: bool
    #: None -> always required. Otherwise the name of the condition evaluated per account.
    condition: str | None
    requires_evidence: bool
    #: None -> operator item. Otherwise the derived fact that satisfies it.
    derived_from: str | None
    #: Operator-facing "why is this required?" text.
    requirement_note: str


CONDITION_ACCOUNT_TYPE_BM = "account_type_is_business_manager"
CONDITION_ACCOUNT_TYPE_PERSONAL = "account_type_is_personal_reference"
CONDITION_REQUIRES_PAGE = "account_requires_page"
CONDITION_REQUIRES_PIXEL = "account_requires_pixel"
CONDITION_HAS_LANDING_PAGE = "account_has_landing_page"
CONDITION_HAS_PROXY = "account_has_proxy_reference"

DERIVED_BM_LINK = "business_manager_mapping"
DERIVED_PERSONAL_LINK = "personal_account_reference_mapping"
DERIVED_PAGE_LINK = "active_page_link"
DERIVED_PIXEL_LINK = "active_pixel_link"
DERIVED_BROWSER_LINK = "active_browser_profile_link"
DERIVED_MANUAL_REVIEW = "manual_review_recency"


DEFAULT_CHECKLIST: tuple[ChecklistItemDefinition, ...] = (
    ChecklistItemDefinition(
        item_key="ownership_confirmed",
        label="Ownership confirmed",
        category=ChecklistCategory.OWNERSHIP,
        is_mandatory=True,
        condition=None,
        requires_evidence=True,
        derived_from=None,
        requirement_note="Always required: the owner/reference mapping must be verified evidence, not an assumption.",
    ),
    ChecklistItemDefinition(
        item_key="business_manager_confirmed",
        label="Business Manager confirmed",
        category=ChecklistCategory.OWNERSHIP,
        is_mandatory=False,
        condition=CONDITION_ACCOUNT_TYPE_BM,
        requires_evidence=False,
        derived_from=DERIVED_BM_LINK,
        requirement_note="Required because the account type is business_manager.",
    ),
    ChecklistItemDefinition(
        item_key="personal_account_reference_confirmed",
        label="Personal account reference confirmed",
        category=ChecklistCategory.OWNERSHIP,
        is_mandatory=False,
        condition=CONDITION_ACCOUNT_TYPE_PERSONAL,
        requires_evidence=False,
        derived_from=DERIVED_PERSONAL_LINK,
        requirement_note="Required because the account type is personal_reference.",
    ),
    ChecklistItemDefinition(
        item_key="admin_access_reviewed",
        label="Admin access reviewed",
        category=ChecklistCategory.ACCESS,
        is_mandatory=True,
        condition=None,
        requires_evidence=False,
        derived_from=None,
        requirement_note="Always required: who holds admin access must be reviewed with a timestamp and note.",
    ),
    ChecklistItemDefinition(
        item_key="two_factor_reviewed",
        label="Two-factor protection reviewed",
        category=ChecklistCategory.ACCESS,
        is_mandatory=True,
        condition=None,
        requires_evidence=False,
        derived_from=None,
        requirement_note="Always required: operator confirmation only. Two-factor secrets are never stored here.",
    ),
    ChecklistItemDefinition(
        item_key="payment_method_reviewed",
        label="Payment method reviewed",
        category=ChecklistCategory.BILLING,
        is_mandatory=True,
        condition=None,
        requires_evidence=True,
        derived_from=None,
        requirement_note="Always required: verified evidence of the payment reference, without payment credentials.",
    ),
    ChecklistItemDefinition(
        item_key="billing_issue_checked",
        label="Billing issues checked",
        category=ChecklistCategory.BILLING,
        is_mandatory=True,
        condition=None,
        requires_evidence=False,
        derived_from=None,
        requirement_note="Always required: outstanding billing problems must be reviewed with a timestamp and note.",
    ),
    ChecklistItemDefinition(
        item_key="page_linked",
        label="Page linked",
        category=ChecklistCategory.ASSETS,
        is_mandatory=False,
        condition=CONDITION_REQUIRES_PAGE,
        requires_evidence=False,
        derived_from=DERIVED_PAGE_LINK,
        requirement_note="Required because this account is marked as needing a Page for its operating workflow.",
    ),
    ChecklistItemDefinition(
        item_key="pixel_linked",
        label="Pixel linked",
        category=ChecklistCategory.ASSETS,
        is_mandatory=False,
        condition=CONDITION_REQUIRES_PIXEL,
        requires_evidence=False,
        derived_from=DERIVED_PIXEL_LINK,
        requirement_note="Required because this account is marked as needing a Pixel for its operating workflow.",
    ),
    ChecklistItemDefinition(
        item_key="landing_page_verified",
        label="Landing page verified",
        category=ChecklistCategory.COMPLIANCE,
        is_mandatory=False,
        condition=CONDITION_HAS_LANDING_PAGE,
        requires_evidence=True,
        derived_from=None,
        requirement_note="Required because an active landing page is assigned to this account.",
    ),
    ChecklistItemDefinition(
        item_key="contact_policy_verified",
        label="Contact and policy pages verified",
        category=ChecklistCategory.COMPLIANCE,
        is_mandatory=False,
        condition=CONDITION_HAS_LANDING_PAGE,
        requires_evidence=False,
        derived_from=None,
        requirement_note="Required because an active landing page is assigned to this account.",
    ),
    ChecklistItemDefinition(
        item_key="browser_reference_assigned",
        label="Browser profile reference assigned",
        category=ChecklistCategory.OPERATIONS,
        is_mandatory=True,
        condition=None,
        requires_evidence=False,
        derived_from=DERIVED_BROWSER_LINK,
        requirement_note="Always required: an active browser-profile reference mapping must exist. The reference is an operational label, not a safety guarantee.",
    ),
    ChecklistItemDefinition(
        item_key="proxy_reference_reviewed",
        label="Proxy reference reviewed",
        category=ChecklistCategory.OPERATIONS,
        is_mandatory=False,
        condition=CONDITION_HAS_PROXY,
        requires_evidence=False,
        derived_from=None,
        requirement_note="Not mandatory. Reviewed for completeness when a proxy reference is assigned; it never makes an account ready on its own.",
    ),
    ChecklistItemDefinition(
        item_key="last_manual_review_completed",
        label="Manual review is current",
        category=ChecklistCategory.OPERATIONS,
        is_mandatory=True,
        condition=None,
        requires_evidence=False,
        derived_from=DERIVED_MANUAL_REVIEW,
        requirement_note="Always required: the account must have been manually reviewed within the configured policy interval.",
    ),
)

DEFAULT_CHECKLIST_BY_KEY: dict[str, ChecklistItemDefinition] = {
    definition.item_key: definition for definition in DEFAULT_CHECKLIST
}

#: Items that are never mandatory and never block readiness, only advise.
ADVISORY_ITEM_KEYS = frozenset({"proxy_reference_reviewed"})
