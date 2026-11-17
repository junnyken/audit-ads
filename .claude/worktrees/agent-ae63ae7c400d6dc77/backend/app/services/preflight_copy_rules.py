"""A6 §6.D `CopyRuleEngine` — the copy/language rules, plus the other draft-field-only rules
(budget, targeting, data-quality, and the "no landing page URL at all" case) that need no
network call and no other service's data. All of it operates on a `CampaignDraft` in memory and
returns `FindingDraft`s; nothing here writes anything.

Every phrase/pattern list below is the "fixed, typed, versioned internal rule registry" A6
guardrail 10 requires: reviewable in code review, bumped by hand (`RULE_VERSION`), and never
built from a caller-supplied expression. Nothing here is a user-authored regex.
"""
from __future__ import annotations

import re

from app.core.enums import FindingCategory, FindingSeverity
from app.models.preflight import CampaignDraft
from app.services.preflight_types import FindingDraft

RULE_VERSION = 1

#: Absolute/guaranteed-outcome claim patterns. Bounded, case-insensitive, no nested quantifiers
#: — each is a plain substring or a single fixed-width `\s+` gap, so none can backtrack
#: catastrophically (A6 guardrail 10).
_ABSOLUTE_CLAIM_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"đảm bảo\s+(hiệu quả|khỏi|thành công|kết quả)",
        r"cam kết\s+(hiệu quả|khỏi|thành công|kết quả)\s+100",
        r"chắc chắn\s+(khỏi|thành công|hiệu quả)",
        r"an toàn tuyệt đối",
        r"hiệu quả\s+100%",
        r"guaranteed\s+(cure|results?|income|success)",
        r"100%\s+(guaranteed|effective|safe)",
        r"risk[- ]free\s+guarantee",
    )
)

#: Sensitive categories that require a filled disclaimer before the copy is left unflagged.
_SENSITIVE_CATEGORY_HINTS: tuple[str, ...] = (
    "giảm cân",
    "sức khỏe",
    "thuốc",
    "điều trị",
    "trị liệu",
    "y tế",
    "tài chính",
    "đầu tư",
    "vay",
    "lãi suất",
    "weight loss",
    "cure",
    "treatment",
    "investment",
    "loan",
)

#: A disclaimer isn't a dedicated field in the A6 v1 schema (the mini-spec's own field list for
#: `CampaignDraft` never defines one either) — treated here as disclaimer-style language present
#: anywhere in `description`. Documented interpretation, not a silent scope decision.
_DISCLAIMER_HINTS: tuple[str, ...] = (
    "tham khảo ý kiến",
    "kết quả có thể khác nhau",
    "không thay thế",
    "hiệu quả tùy",
    "disclaimer",
    "results may vary",
    "consult a",
)

_EXCESSIVE_CAPS = re.compile(r"[A-ZÀ-Ỹ]{5,}")
_EXCESSIVE_SYMBOLS = re.compile(r"([!?*$])\1{2,}")

DEFAULT_BUDGET_CHANGE_THRESHOLD_PERCENT = 50


def _contains_any(haystack: str, needles: tuple[str, ...]) -> bool:
    lowered = haystack.lower()
    return any(needle.lower() in lowered for needle in needles)


class CopyRuleEngine:
    def evaluate(
        self,
        draft: CampaignDraft,
        *,
        budget_change_threshold_percent: float = DEFAULT_BUDGET_CHANGE_THRESHOLD_PERCENT,
    ) -> list[FindingDraft]:
        findings: list[FindingDraft] = []
        combined_copy = " ".join(
            part for part in (draft.primary_copy, draft.headline, draft.description) if part
        )

        findings.extend(self._copy_language_findings(draft, combined_copy))
        findings.extend(self._landing_page_and_data_quality_findings(draft))
        findings.extend(
            self._budget_and_targeting_findings(draft, budget_change_threshold_percent)
        )
        return findings

    # -- copy_language --------------------------------------------------------------------

    def _copy_language_findings(self, draft: CampaignDraft, combined_copy: str) -> list[FindingDraft]:
        findings: list[FindingDraft] = []

        if not draft.primary_copy or not draft.primary_copy.strip():
            # Interpretation: only `primary_copy` is required. `headline` is nullable in the
            # A6 schema by design, so an empty headline is not itself a defect — deviates from
            # the mini-spec's literal "primary copy or headline is empty" wording; documented.
            findings.append(
                FindingDraft(
                    category=FindingCategory.COPY_LANGUAGE,
                    severity=FindingSeverity.BLOCKING,
                    rule_key="copy_empty_required_field",
                    rule_version=RULE_VERSION,
                    message="Primary copy is empty.",
                    recommended_action="Write the primary ad copy before evaluating this draft.",
                    field_reference="primary_copy",
                )
            )

        if any(p.search(combined_copy) for p in _ABSOLUTE_CLAIM_PATTERNS):
            findings.append(
                FindingDraft(
                    category=FindingCategory.COPY_LANGUAGE,
                    severity=FindingSeverity.BLOCKING,
                    rule_key="copy_absolute_claim_detected",
                    rule_version=RULE_VERSION,
                    message="Copy contains an absolute or guaranteed-outcome claim.",
                    recommended_action="Remove or soften the absolute claim (e.g. drop \"guaranteed\"/\"100%\").",
                    field_reference="primary_copy",
                )
            )

        if _contains_any(combined_copy, _SENSITIVE_CATEGORY_HINTS) and not _contains_any(
            draft.description or "", _DISCLAIMER_HINTS
        ):
            findings.append(
                FindingDraft(
                    category=FindingCategory.COPY_LANGUAGE,
                    severity=FindingSeverity.WARNING,
                    rule_key="copy_missing_disclaimer_for_flagged_category",
                    rule_version=RULE_VERSION,
                    message=(
                        "Copy references a sensitive category (health, finance, weight loss) "
                        "without disclaimer-style language in the description."
                    ),
                    recommended_action="Add a disclaimer to the description for this category.",
                    field_reference="description",
                )
            )

        if _EXCESSIVE_CAPS.search(combined_copy) or _EXCESSIVE_SYMBOLS.search(combined_copy):
            findings.append(
                FindingDraft(
                    category=FindingCategory.COPY_LANGUAGE,
                    severity=FindingSeverity.WARNING,
                    rule_key="copy_excessive_caps_or_symbols",
                    rule_version=RULE_VERSION,
                    message="Copy uses excessive capitalisation or repeated symbols.",
                    recommended_action="Rewrite using normal sentence case and punctuation.",
                    field_reference="primary_copy",
                )
            )

        return findings

    # -- landing_page (missing URL only) & data_quality ------------------------------------

    def _landing_page_and_data_quality_findings(self, draft: CampaignDraft) -> list[FindingDraft]:
        findings: list[FindingDraft] = []

        if draft.ad_account_id is None:
            findings.append(
                FindingDraft(
                    category=FindingCategory.DATA_QUALITY,
                    severity=FindingSeverity.BLOCKING,
                    rule_key="draft_missing_account_link",
                    rule_version=RULE_VERSION,
                    message="Draft is not linked to a registered ad account.",
                    recommended_action="Link this draft to a registered account before evaluating it.",
                    field_reference="ad_account_id",
                )
            )

        # Interpretation: "when the objective requires one" is read as "any objective was
        # declared at all" — the schema has no fixed objective enum requiring a stricter rule
        # (A6 audit-before-build gap, documented rather than guessed at silently).
        if (not draft.landing_page_url or not draft.landing_page_url.strip()) and draft.objective:
            findings.append(
                FindingDraft(
                    category=FindingCategory.LANDING_PAGE,
                    severity=FindingSeverity.BLOCKING,
                    rule_key="landing_page_missing",
                    rule_version=RULE_VERSION,
                    message="No landing page URL was provided for this campaign objective.",
                    recommended_action="Add a landing page URL.",
                    field_reference="landing_page_url",
                )
            )

        return findings

    # -- budget_change / targeting_completeness --------------------------------------------

    def _budget_and_targeting_findings(
        self, draft: CampaignDraft, threshold_percent: float
    ) -> list[FindingDraft]:
        findings: list[FindingDraft] = []

        if draft.budget_change_percent is not None and abs(
            float(draft.budget_change_percent)
        ) > threshold_percent:
            findings.append(
                FindingDraft(
                    category=FindingCategory.BUDGET_CHANGE,
                    severity=FindingSeverity.WARNING,
                    rule_key="budget_change_exceeds_threshold",
                    rule_version=RULE_VERSION,
                    message=(
                        f"Budget change of {draft.budget_change_percent}% exceeds the "
                        f"{threshold_percent}% threshold."
                    ),
                    recommended_action="Confirm the budget change is intentional before publishing.",
                    field_reference="budget_change_percent",
                )
            )

        if not draft.targeting_summary or not draft.targeting_summary.strip():
            findings.append(
                FindingDraft(
                    category=FindingCategory.TARGETING_COMPLETENESS,
                    severity=FindingSeverity.WARNING,
                    rule_key="targeting_summary_missing",
                    rule_version=RULE_VERSION,
                    message="Targeting summary is empty.",
                    recommended_action="Describe the intended audience in the targeting summary.",
                    field_reference="targeting_summary",
                )
            )

        return findings
