"""MINI-SPEC A10.1 domain model — read-only discovery of a configured Business Manager.

Three additive tables. No A1 table is altered, and nothing here ever writes back to Meta: these
rows are *observations* — what the provider returned, when, and through which edge.

**Why coverage is stored, not just counts.** `missing_from_latest_discovery` is only meaningful
against a full inventory, so the run records the outcome of every edge it read
(`*_edges_json`) and a derived completeness flag per asset type. A run that had an edge refused,
or that stopped at the page cap, is `succeeded_with_warnings`: it finished, it is not complete,
and it may not license the conclusion that anything is absent.

No token is a column here, for the same reason it is not one in `meta_operations.py`. The
Business Manager id is stored, and that is deliberate: unlike a token it is not a secret — it is
visible to anyone who opens Business Settings.
"""
from __future__ import annotations

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.core.enums import (
    CoverageStatus,
    DiscoveryRunStatus,
    DiscoveryTrigger,
    MetaEnvironment,
)
from app.db.base import Archivable, Base, Timestamped, UUIDPrimaryKey
from app.models.entities import _enum


class BusinessManagerDiscoveryRun(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """One operator-requested read of a configured Business Manager.

    `provider_environment` is captured at run time rather than read from the connection later:
    a connection can be edited afterwards, and an observation must keep saying which environment
    actually produced it.
    """

    __tablename__ = "business_manager_discovery_runs"
    __table_args__ = (
        sa.Index("ix_bm_discovery_ws_conn_created", "workspace_id", "meta_connection_id", "created_at"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    meta_connection_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("meta_connections.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    #: The BM this run was pointed at, copied from server configuration at run time.
    configured_business_manager_reference: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    #: What Meta called it, when the validation read succeeded. `None` means not established —
    #: never a placeholder name.
    configured_business_manager_name: Mapped[str | None] = mapped_column(sa.String(200), nullable=True)

    trigger: Mapped[DiscoveryTrigger] = mapped_column(
        _enum(DiscoveryTrigger, "discovery_trigger"), nullable=False, default=DiscoveryTrigger.MANUAL
    )
    status: Mapped[DiscoveryRunStatus] = mapped_column(
        _enum(DiscoveryRunStatus, "discovery_run_status"),
        nullable=False,
        default=DiscoveryRunStatus.RUNNING,
    )
    provider_environment: Mapped[MetaEnvironment] = mapped_column(
        _enum(MetaEnvironment, "meta_environment"), nullable=False, default=MetaEnvironment.FAKE
    )

    started_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)

    #: The edges this run was required to cover, stored per run rather than read from today's
    #: constant. Adding an edge later must invalidate old coverage, not silently reinterpret an
    #: old run as though the new edge had always been read.
    ad_account_required_edges_json: Mapped[list | None] = mapped_column(sa.JSON(), nullable=True)
    pixel_required_edges_json: Mapped[list | None] = mapped_column(sa.JSON(), nullable=True)

    #: Per-edge evidence: `{"<edge>": {"required", "status", "pages", "items", "error_code"},
    #: ..., "total_unique_assets": n}`. Never a raw provider body. A single boolean would answer
    #: "was it complete" but not "which edge was never attempted", which is the question anyone
    #: reviewing a `missing` conclusion weeks later actually needs.
    ad_account_coverage_json: Mapped[dict | None] = mapped_column(sa.JSON(), nullable=True)
    pixel_coverage_json: Mapped[dict | None] = mapped_column(sa.JSON(), nullable=True)

    #: Materialised for querying and filtering. `not_attempted` is distinct from seeing nothing.
    ad_account_coverage_status: Mapped[CoverageStatus] = mapped_column(
        _enum(CoverageStatus, "coverage_status"),
        nullable=False,
        default=CoverageStatus.NOT_ATTEMPTED,
    )
    pixel_coverage_status: Mapped[CoverageStatus] = mapped_column(
        _enum(CoverageStatus, "coverage_status"),
        nullable=False,
        default=CoverageStatus.NOT_ATTEMPTED,
    )

    #: A `MetaFailureCode` value, stored as text so the model layer does not import a service —
    #: the same convention `meta_operations.py` already uses for batch item failures.
    failure_code: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    failure_summary: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)

    created_by: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid(), nullable=True)

    @property
    def ad_accounts_complete(self) -> bool:
        """Derived, never stored. A separately settable boolean could drift away from the
        coverage it claims to summarise, and this is the flag that licenses concluding an
        internal account has gone missing."""
        return self.ad_account_coverage_status == CoverageStatus.COMPLETE

    @property
    def pixels_complete(self) -> bool:
        return self.pixel_coverage_status == CoverageStatus.COMPLETE


class DiscoveredAdAccountObservation(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """One ad account as one run saw it. `external_account_id` is stored canonicalised, so it
    can be compared with `AdAccount.external_account_id` without either side guessing about the
    `act_` prefix Meta uses inconsistently."""

    __tablename__ = "discovered_ad_account_observations"
    __table_args__ = (
        sa.Index(
            "ix_disc_acct_ws_run_ext",
            "workspace_id",
            "business_manager_discovery_run_id",
            "external_account_id",
        ),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    business_manager_discovery_run_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(),
        sa.ForeignKey("business_manager_discovery_runs.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    provider_business_manager_id: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    external_account_id: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    display_name: Mapped[str | None] = mapped_column(sa.String(200), nullable=True)
    #: Which Graph edge returned it — `owned_ad_accounts` or `client_ad_accounts`. Kept because
    #: the two are different relationships to the BM, and because a run that read only one of
    #: them saw only part of the picture.
    source_edge: Mapped[str] = mapped_column(sa.String(60), nullable=False)
    #: Allowlisted fields only (currency, timezone, account status reference).
    safe_metadata_json: Mapped[dict | None] = mapped_column(sa.JSON(), nullable=True)
    observed_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)


class DiscoveredPixelObservation(UUIDPrimaryKey, Timestamped, Archivable, Base):
    """One Pixel as one run saw it."""

    __tablename__ = "discovered_pixel_observations"
    __table_args__ = (
        sa.Index(
            "ix_disc_pixel_ws_run_ext",
            "workspace_id",
            "business_manager_discovery_run_id",
            "external_pixel_id",
        ),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    business_manager_discovery_run_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(),
        sa.ForeignKey("business_manager_discovery_runs.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    provider_business_manager_id: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    external_pixel_id: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    display_name: Mapped[str | None] = mapped_column(sa.String(200), nullable=True)
    source_edge: Mapped[str] = mapped_column(sa.String(60), nullable=False)
    safe_metadata_json: Mapped[dict | None] = mapped_column(sa.JSON(), nullable=True)
    observed_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
