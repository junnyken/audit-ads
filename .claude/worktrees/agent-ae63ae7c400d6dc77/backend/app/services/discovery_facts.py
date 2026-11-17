"""O3 — the discovery fact one health rule reads: "was this account returned by the latest
discovery of its Business Manager, and could that discovery have seen it?"

Assembled from stored runs and observations only — never from Meta — so "Recalculate health"
still contacts no advertising platform. It mirrors the reconcile order in
`MetaDiscoveryService.reconcile_ad_accounts` exactly, because the rule it feeds
(`account_not_returned_by_latest_discovery`) is that reconcile's `missing_from_latest_discovery`
branch made visible on the account, and two orders would be two answers.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.enums import CoverageStatus, DiscoveryRunStatus, MetaEnvironment
from app.models.entities import AdAccount
from app.models.meta_discovery import BusinessManagerDiscoveryRun, DiscoveredAdAccountObservation
from app.services.extension_context import canonical_external_id
from app.services.meta_provider import FAKE_IDENTITY_EXTERNAL_ID


@dataclass(frozen=True)
class DiscoveryFacts:
    """The latest usable discovery run of the account's Business Manager, inside the window.

    `None` on `HealthFacts.discovery` means there is no such run (never discovered, only fake or
    failed runs, or the latest is older than `discovery_stale_after_hours`), and the rule is then
    silent — no run is not "returned", and it is not "not returned" either (rule 4).
    """

    run_id: str
    completed_at: datetime
    business_manager_reference: str
    read_as: str | None
    coverage_status: CoverageStatus
    returned: bool

    @property
    def complete(self) -> bool:
        return self.coverage_status == CoverageStatus.COMPLETE


def build_discovery_facts(
    session: Session,
    workspace_id: uuid.UUID,
    account: AdAccount,
    *,
    now: datetime,
    settings=None,
) -> DiscoveryFacts | None:
    """Two queries at most. Only `production` runs count: a fake run's inventory is not evidence
    about a real account, in either direction."""
    settings = settings or get_settings()
    if account.archived_at is not None:
        return None
    canonical = canonical_external_id(account.external_account_id)
    if not canonical:
        return None
    business_manager = account.business_manager
    if business_manager is None or business_manager.archived_at is not None:
        return None
    reference = canonical_external_id(business_manager.external_id)
    if not reference:
        return None

    cutoff = now - timedelta(hours=settings.discovery_stale_after_hours)
    run = session.execute(
        sa.select(BusinessManagerDiscoveryRun)
        .where(
            BusinessManagerDiscoveryRun.workspace_id == workspace_id,
            BusinessManagerDiscoveryRun.archived_at.is_(None),
            BusinessManagerDiscoveryRun.provider_environment == MetaEnvironment.PRODUCTION,
            BusinessManagerDiscoveryRun.configured_business_manager_reference == reference,
            # A run that failed validation read no assets; it says nothing about presence.
            BusinessManagerDiscoveryRun.status.in_(
                [DiscoveryRunStatus.SUCCEEDED, DiscoveryRunStatus.SUCCEEDED_WITH_WARNINGS]
            ),
            BusinessManagerDiscoveryRun.ad_account_coverage_status != CoverageStatus.NOT_ATTEMPTED,
            BusinessManagerDiscoveryRun.completed_at.is_not(None),
            BusinessManagerDiscoveryRun.completed_at >= cutoff,
            # A `production` connection with no reader credential is read by the fake provider
            # in the router; its run carries the connection's environment. Not evidence.
            sa.or_(
                BusinessManagerDiscoveryRun.provider_actor_external_id.is_(None),
                BusinessManagerDiscoveryRun.provider_actor_external_id != FAKE_IDENTITY_EXTERNAL_ID,
            ),
        )
        .order_by(BusinessManagerDiscoveryRun.completed_at.desc(), BusinessManagerDiscoveryRun.id.desc())
        .limit(1)
    ).scalar_one_or_none()
    if run is None:
        return None
    returned = (
        session.execute(
            sa.select(DiscoveredAdAccountObservation.id).where(
                DiscoveredAdAccountObservation.business_manager_discovery_run_id == run.id,
                DiscoveredAdAccountObservation.external_account_id == canonical,
            ).limit(1)
        ).first()
        is not None
    )
    return DiscoveryFacts(
        run_id=str(run.id),
        completed_at=run.completed_at,
        business_manager_reference=reference,
        read_as=run.provider_actor_name or run.provider_actor_external_id,
        coverage_status=run.ad_account_coverage_status,
        returned=returned,
    )
