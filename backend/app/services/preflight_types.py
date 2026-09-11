"""Shared types for A6 rule-producing modules (`preflight_copy_rules`, `preflight_landing_page`,
`preflight_account_context`). Kept separate from any one of them so none has to import another
just to share this dataclass.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.core.enums import FindingCategory, FindingSeverity


@dataclass(frozen=True)
class FindingDraft:
    """What one rule produced, before `PreflightFindingService` turns it into a row.

    Deliberately not an ORM object: a rule module has no database session and no opinion about
    `draft_id`/`workspace_id`/`evaluation_run_id` — the caller that persists these attaches them.
    """

    category: FindingCategory
    severity: FindingSeverity
    rule_key: str
    rule_version: int
    message: str
    recommended_action: str
    field_reference: str | None = None
    evidence_reference: str | None = None
