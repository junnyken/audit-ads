"""AssetLinkService — time-bounded account↔asset mappings (A1 §A).

Unlinking never deletes: it stamps `unlinked_at` so "which Page was on this account in July"
stays answerable. For browser-profile and proxy references only one link may be active at a
time; re-assigning closes the previous link and records both halves in the audit trail.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import SINGLE_ACTIVE_ASSET_TYPES, AssetType
from app.core.errors import ConflictError, NotFoundError
from app.models.entities import (
    AccountAssetLink,
    AdAccount,
    BrowserProfileReference,
    Page,
    PaymentProfileReference,
    Pixel,
    ProxyReference,
)
from app.services.audit import AuditLogService
from app.services.base import get_or_404, require_active, snapshot
from app.services.readiness import AccountLinkFacts

ASSET_MODELS: dict[AssetType, type] = {
    AssetType.PAGE: Page,
    AssetType.PIXEL: Pixel,
    AssetType.PAYMENT_PROFILE: PaymentProfileReference,
    AssetType.BROWSER_PROFILE: BrowserProfileReference,
    AssetType.PROXY: ProxyReference,
}


def gather_link_facts(session: Session, ad_account_id: uuid.UUID) -> AccountLinkFacts:
    rows = session.execute(
        sa.select(AccountAssetLink.asset_type)
        .where(
            AccountAssetLink.ad_account_id == ad_account_id,
            AccountAssetLink.unlinked_at.is_(None),
        )
        .distinct()
    ).scalars().all()
    active = set(rows)
    return AccountLinkFacts(
        has_active_page_link=AssetType.PAGE in active,
        has_active_pixel_link=AssetType.PIXEL in active,
        has_active_browser_link=AssetType.BROWSER_PROFILE in active,
        has_active_proxy_link=AssetType.PROXY in active,
        has_active_payment_link=AssetType.PAYMENT_PROFILE in active,
    )


class AssetLinkService:
    def __init__(self, session: Session, workspace_id: uuid.UUID, audit: AuditLogService) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit

    def list_links(self, ad_account_id: uuid.UUID, *, include_inactive: bool = True) -> list[AccountAssetLink]:
        stmt = sa.select(AccountAssetLink).where(
            AccountAssetLink.ad_account_id == ad_account_id,
            AccountAssetLink.workspace_id == self.workspace_id,
        )
        if not include_inactive:
            stmt = stmt.where(AccountAssetLink.unlinked_at.is_(None))
        return list(
            self.session.execute(stmt.order_by(AccountAssetLink.linked_at.desc())).scalars().all()
        )

    def resolve_asset(self, asset_type: AssetType, asset_id: uuid.UUID):
        model = ASSET_MODELS.get(asset_type)
        if model is None:  # pragma: no cover - enum guarded
            raise NotFoundError(f"Unsupported asset type '{asset_type}'.")
        asset = get_or_404(self.session, model, asset_id, self.workspace_id, label=model.__name__)
        return require_active(asset, label=model.__name__)

    def link(
        self,
        account: AdAccount,
        *,
        asset_type: AssetType,
        asset_id: uuid.UUID,
        actor_id: uuid.UUID | None,
        note: str = "",
    ) -> AccountAssetLink:
        self.resolve_asset(asset_type, asset_id)
        now = datetime.now(UTC)

        existing_same = self.session.execute(
            sa.select(AccountAssetLink).where(
                AccountAssetLink.ad_account_id == account.id,
                AccountAssetLink.asset_type == asset_type,
                AccountAssetLink.asset_id == asset_id,
                AccountAssetLink.unlinked_at.is_(None),
            )
        ).scalar_one_or_none()
        if existing_same is not None:
            raise ConflictError(
                "This asset is already linked to the account.",
                details={"link_id": str(existing_same.id)},
            )

        if asset_type in SINGLE_ACTIVE_ASSET_TYPES:
            for previous in self.session.execute(
                sa.select(AccountAssetLink).where(
                    AccountAssetLink.ad_account_id == account.id,
                    AccountAssetLink.asset_type == asset_type,
                    AccountAssetLink.unlinked_at.is_(None),
                )
            ).scalars().all():
                self._close(previous, actor_id=actor_id, reason="replaced_by_new_active_mapping")

        link = AccountAssetLink(
            workspace_id=self.workspace_id,
            ad_account_id=account.id,
            asset_type=asset_type,
            asset_id=asset_id,
            linked_at=now,
            linked_by=actor_id,
            note=note or "",
        )
        self.session.add(link)
        self.session.flush()
        self.audit.record(
            action="asset_link.created",
            entity_type="account_asset_link",
            entity_id=link.id,
            after=snapshot(link),
            metadata={"ad_account_id": str(account.id), "asset_type": asset_type.value},
        )
        return link

    def update_note(self, link: AccountAssetLink, note: str) -> AccountAssetLink:
        before = snapshot(link)
        link.note = note
        self.session.flush()
        self.audit.record(
            action="asset_link.updated",
            entity_type="account_asset_link",
            entity_id=link.id,
            before=before,
            after=snapshot(link),
        )
        return link

    def unlink(self, link: AccountAssetLink, *, actor_id: uuid.UUID | None) -> AccountAssetLink:
        if link.unlinked_at is not None:
            raise ConflictError("This link is already closed.", details={"link_id": str(link.id)})
        return self._close(link, actor_id=actor_id, reason="operator_unlinked")

    def _close(self, link: AccountAssetLink, *, actor_id: uuid.UUID | None, reason: str) -> AccountAssetLink:
        before = snapshot(link)
        link.unlinked_at = datetime.now(UTC)
        link.unlinked_by = actor_id
        self.session.flush()
        self.audit.record(
            action="asset_link.unlinked",
            entity_type="account_asset_link",
            entity_id=link.id,
            before=before,
            after=snapshot(link),
            metadata={"reason": reason},
        )
        return link
