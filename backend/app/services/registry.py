"""AdAccountRegistryService — the central system of record (A1 §E).

Every mutation here does three things in one transaction: change the row, write the audit
record, and recompute readiness. Splitting them would let the dashboard show a readiness state
that no longer matches the data behind it.
"""
from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import AccountStatus, AccountType, AssetType, ReadinessStatus
from app.core.errors import ConflictError, ValidationError
from app.models.entities import (
    AccountAssetLink,
    AdAccount,
    BusinessManager,
    PersonalAccountReference,
)
from app.services.audit import AuditLogService
from app.services.base import apply_sort, diff, get_or_404, paginate, require_active, snapshot
from app.services.checklist import ReadinessChecklistService
from app.services.rollup import ReadinessRollupService

SORTABLE = {"updated_at", "created_at", "display_name", "readiness_status", "last_manual_review_at"}


@dataclass
class AccountFilters:
    search: str | None = None
    status: str | None = None
    readiness_status: str | None = None
    account_type: str | None = None
    business_manager_id: uuid.UUID | None = None
    personal_account_reference_id: uuid.UUID | None = None
    country: str | None = None
    currency: str | None = None
    has_browser_reference: bool | None = None
    has_proxy_reference: bool | None = None
    archived: bool = False
    page: int = 1
    page_size: int = 25
    sort: str = "updated_at"
    sort_direction: str = "desc"


def _normalise_external_id(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


class AdAccountRegistryService:
    def __init__(self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit
        self.checklists = ReadinessChecklistService(session, workspace_id, audit)
        self.rollup = ReadinessRollupService(session, workspace_id, audit)

    # ---------------------------------------------------------------- reads
    def get(self, ad_account_id: uuid.UUID) -> AdAccount:
        return get_or_404(self.session, AdAccount, ad_account_id, self.workspace_id, label="Ad account")

    def _link_exists(self, asset_type: AssetType):
        return (
            sa.select(AccountAssetLink.id)
            .where(
                AccountAssetLink.ad_account_id == AdAccount.id,
                AccountAssetLink.asset_type == asset_type,
                AccountAssetLink.unlinked_at.is_(None),
            )
            .exists()
        )

    def list(self, filters: AccountFilters) -> tuple[Sequence[AdAccount], int]:
        stmt = sa.select(AdAccount).where(AdAccount.workspace_id == self.workspace_id)
        stmt = (
            stmt.where(AdAccount.archived_at.is_not(None))
            if filters.archived
            else stmt.where(AdAccount.archived_at.is_(None))
        )
        if filters.search:
            needle = f"%{filters.search.strip()}%"
            bm_match = (
                sa.select(BusinessManager.id)
                .where(BusinessManager.id == AdAccount.business_manager_id, BusinessManager.name.ilike(needle))
                .exists()
            )
            personal_match = (
                sa.select(PersonalAccountReference.id)
                .where(
                    PersonalAccountReference.id == AdAccount.personal_account_reference_id,
                    sa.or_(
                        PersonalAccountReference.label.ilike(needle),
                        PersonalAccountReference.display_name.ilike(needle),
                    ),
                )
                .exists()
            )
            stmt = stmt.where(
                sa.or_(
                    AdAccount.display_name.ilike(needle),
                    AdAccount.external_account_id.ilike(needle),
                    AdAccount.owner_label.ilike(needle),
                    sa.cast(AdAccount.tags, sa.String).ilike(needle),
                    bm_match,
                    personal_match,
                )
            )
        if filters.status:
            stmt = stmt.where(AdAccount.status == AccountStatus(filters.status))
        if filters.readiness_status:
            stmt = stmt.where(AdAccount.readiness_status == ReadinessStatus(filters.readiness_status))
        if filters.account_type:
            stmt = stmt.where(AdAccount.account_type == AccountType(filters.account_type))
        if filters.business_manager_id:
            stmt = stmt.where(AdAccount.business_manager_id == filters.business_manager_id)
        if filters.personal_account_reference_id:
            stmt = stmt.where(
                AdAccount.personal_account_reference_id == filters.personal_account_reference_id
            )
        if filters.country:
            stmt = stmt.where(AdAccount.country == filters.country.upper())
        if filters.currency:
            stmt = stmt.where(AdAccount.currency == filters.currency.upper())
        if filters.has_browser_reference is not None:
            condition = self._link_exists(AssetType.BROWSER_PROFILE)
            stmt = stmt.where(condition if filters.has_browser_reference else sa.not_(condition))
        if filters.has_proxy_reference is not None:
            condition = self._link_exists(AssetType.PROXY)
            stmt = stmt.where(condition if filters.has_proxy_reference else sa.not_(condition))

        stmt = apply_sort(stmt, AdAccount, filters.sort, filters.sort_direction, SORTABLE)
        return paginate(self.session, stmt, page=filters.page, page_size=filters.page_size)

    # ------------------------------------------------------------- mutations
    def _validate_ownership(self, payload: dict[str, Any]) -> None:
        account_type = payload.get("account_type")
        bm_id = payload.get("business_manager_id")
        personal_id = payload.get("personal_account_reference_id")
        if bm_id:
            require_active(
                get_or_404(self.session, BusinessManager, bm_id, self.workspace_id, label="Business Manager"),
                label="Business Manager",
            )
        if personal_id:
            require_active(
                get_or_404(
                    self.session,
                    PersonalAccountReference,
                    personal_id,
                    self.workspace_id,
                    label="Personal account reference",
                ),
                label="Personal account reference",
            )
        if account_type == AccountType.BUSINESS_MANAGER and personal_id and bm_id is None:
            raise ValidationError(
                "A business_manager account must reference a Business Manager.",
                details={"field": "business_manager_id"},
            )

    def _assert_external_id_unique(self, external_account_id: str | None, *, exclude_id: uuid.UUID | None = None) -> None:
        if not external_account_id:
            return
        stmt = sa.select(AdAccount.id).where(
            AdAccount.workspace_id == self.workspace_id,
            AdAccount.external_account_id == external_account_id,
        )
        if exclude_id:
            stmt = stmt.where(AdAccount.id != exclude_id)
        if self.session.execute(stmt).first() is not None:
            raise ConflictError(
                "Another account in this workspace already uses this external account ID.",
                details={"field": "external_account_id", "value": external_account_id},
            )

    def create(self, payload: dict[str, Any]) -> AdAccount:
        payload = dict(payload)
        payload["external_account_id"] = _normalise_external_id(payload.get("external_account_id"))
        self._validate_ownership(payload)
        self._assert_external_id_unique(payload["external_account_id"])

        account = AdAccount(workspace_id=self.workspace_id, **payload)
        self.session.add(account)
        self.session.flush()
        self.audit.record(
            action="ad_account.created",
            entity_type="ad_account",
            entity_id=account.id,
            after=snapshot(account),
        )
        self.checklists.initialise(account)
        self.rollup.evaluate(account)
        return account

    def update(self, account: AdAccount, payload: dict[str, Any]) -> AdAccount:
        require_active(account, label="Ad account")
        payload = dict(payload)
        if "external_account_id" in payload:
            payload["external_account_id"] = _normalise_external_id(payload["external_account_id"])
            self._assert_external_id_unique(payload["external_account_id"], exclude_id=account.id)
        merged = {
            "account_type": payload.get("account_type", account.account_type),
            "business_manager_id": payload.get("business_manager_id", account.business_manager_id),
            "personal_account_reference_id": payload.get(
                "personal_account_reference_id", account.personal_account_reference_id
            ),
        }
        self._validate_ownership(merged)

        before = snapshot(account)
        for key, value in payload.items():
            setattr(account, key, value)
        self.session.flush()
        after = snapshot(account)
        changed = diff(before, after)
        if changed:
            self.audit.record(
                action="ad_account.updated",
                entity_type="ad_account",
                entity_id=account.id,
                before={k: before.get(k) for k in changed},
                after=changed,
            )
        # Conditional requirements can change with the payload, so readiness is always re-run.
        self.checklists.initialise(account)
        self.rollup.evaluate(account)
        return account

    def record_manual_review(self, account: AdAccount, *, note: str) -> AdAccount:
        require_active(account, label="Ad account")
        before = snapshot(account)
        account.last_manual_review_at = datetime.now(UTC)
        self.session.flush()
        self.audit.record(
            action="ad_account.manual_review_recorded",
            entity_type="ad_account",
            entity_id=account.id,
            before={"last_manual_review_at": before.get("last_manual_review_at")},
            after={"last_manual_review_at": account.last_manual_review_at.isoformat()},
            metadata={"note": note},
        )
        self.rollup.evaluate(account)
        return account

    def archive(self, account: AdAccount) -> AdAccount:
        if account.archived_at is not None:
            raise ConflictError("This account is already archived.")
        before = snapshot(account)
        account.archived_at = datetime.now(UTC)
        self.session.flush()
        self.audit.record(
            action="ad_account.archived",
            entity_type="ad_account",
            entity_id=account.id,
            before=before,
            after=snapshot(account),
        )
        self.rollup.evaluate(account)
        return account

    def restore(self, account: AdAccount) -> AdAccount:
        if account.archived_at is None:
            raise ConflictError("This account is not archived.")
        before = snapshot(account)
        account.archived_at = None
        self.session.flush()
        self.audit.record(
            action="ad_account.restored",
            entity_type="ad_account",
            entity_id=account.id,
            before=before,
            after=snapshot(account),
        )
        self.rollup.evaluate(account)
        return account
