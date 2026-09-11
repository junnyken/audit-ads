"""A6 §6.D `AccountContextRuleAdapter` — reads A1 readiness and A2 health through their existing
services (never a duplicate SQL path against `ad_accounts`/health tables, per A6 guardrail 3 and
the mini-spec's explicit instruction). Read-only: `ReadinessRollupService.evaluate` is always
called with `persist=False`, so this adapter can never move an account's readiness state.
"""
from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.core.enums import AccountStatus, FindingCategory, FindingSeverity, HealthStatus, ReadinessStatus
from app.models.entities import AdAccount
from app.services.audit import AuditLogService
from app.services.health_service import AccountHealthSnapshotService
from app.services.preflight_types import FindingDraft
from app.services.rollup import ReadinessRollupService

RULE_VERSION = 1


class AccountContextRuleAdapter:
    def __init__(self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService) -> None:
        self._session = session
        self._workspace_id = workspace_id
        self._audit = audit

    def evaluate(self, account: AdAccount | None) -> list[FindingDraft]:
        """`account` is None when the draft has no linked account at all — that case is already
        covered by `draft_missing_account_link` in `preflight_copy_rules`, so this adapter has
        nothing to add here and returns no findings rather than guessing."""
        if account is None:
            return []

        findings: list[FindingDraft] = []

        if account.status in (AccountStatus.RESTRICTED, AccountStatus.DISABLED):
            findings.append(
                FindingDraft(
                    category=FindingCategory.ACCOUNT_READINESS,
                    severity=FindingSeverity.BLOCKING,
                    rule_key="account_status_restricted_or_disabled",
                    rule_version=RULE_VERSION,
                    message=f"The linked account's status is {account.status.value}.",
                    recommended_action="Resolve the account's platform status before publishing.",
                    evidence_reference=f"ad_account:{account.id}",
                )
            )

        readiness = ReadinessRollupService(self._session, self._workspace_id, self._audit).evaluate(
            account, persist=False
        )
        if readiness.readiness_status == ReadinessStatus.UNKNOWN:
            findings.append(
                FindingDraft(
                    category=FindingCategory.ACCOUNT_READINESS,
                    severity=FindingSeverity.WARNING,
                    rule_key="account_readiness_unknown",
                    rule_version=RULE_VERSION,
                    message="Account readiness is unknown for the linked account.",
                    recommended_action="Complete the account readiness checklist.",
                    evidence_reference=f"ad_account:{account.id}",
                )
            )
        elif readiness.readiness_status != ReadinessStatus.OPERATIONALLY_READY:
            findings.append(
                FindingDraft(
                    category=FindingCategory.ACCOUNT_READINESS,
                    severity=FindingSeverity.WARNING,
                    rule_key="account_not_operationally_ready",
                    rule_version=RULE_VERSION,
                    message=f"Account readiness is {readiness.readiness_status}, not operationally ready.",
                    recommended_action="Review the account readiness checklist before publishing.",
                    evidence_reference=f"ad_account:{account.id}",
                )
            )

        snapshot = AccountHealthSnapshotService(
            self._session, self._workspace_id, self._audit
        ).get(account.id)
        health_status = snapshot.health_status if snapshot is not None else HealthStatus.UNKNOWN
        if health_status == HealthStatus.CRITICAL:
            findings.append(
                FindingDraft(
                    category=FindingCategory.ACCOUNT_HEALTH,
                    severity=FindingSeverity.BLOCKING,
                    rule_key="account_health_critical",
                    rule_version=RULE_VERSION,
                    message="Account health for the linked account is critical.",
                    recommended_action="Resolve the account's open critical health signals.",
                    evidence_reference=f"ad_account:{account.id}",
                )
            )
        elif health_status == HealthStatus.WARNING:
            findings.append(
                FindingDraft(
                    category=FindingCategory.ACCOUNT_HEALTH,
                    severity=FindingSeverity.WARNING,
                    rule_key="account_health_warning",
                    rule_version=RULE_VERSION,
                    message="Account health for the linked account is at warning level.",
                    recommended_action="Review the account's open health signals.",
                    evidence_reference=f"ad_account:{account.id}",
                )
            )

        return findings
