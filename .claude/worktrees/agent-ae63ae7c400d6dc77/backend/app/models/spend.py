"""S1 — spend observations read from Meta (read-only).

One additive table. No A1 table is altered: `AdAccount.currency`/`timezone` stay the values an
operator typed, and the values Meta returned live here beside them, so a disagreement between the
two is visible instead of being silently overwritten.

Append-only. A row is never updated after it is written except to set `archived_at` (rule 2); a
newer read is a newer row. A failed read is a row too, carrying its failure code — "nothing was
recorded" and "a read was attempted and refused" are different facts.

What is deliberately **not** here: any reader credential (rule 40 — `reader_source` names which
credential answered — `vault`, `business_specific`, `server_default` — never its value; since O4 the
one encrypted copy lives only in `meta_reader_credentials`), and anything describing a payment method
(`funding_source_details` is never requested; A1 excludes payment data from this product).

Money is stored as the raw strings Meta returned. Their units have not been verified against a
live response, so nothing here divides by 100, converts a currency or sums across currencies.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.core.enums import SpendObservationStatus, SpendObservationTrigger
from app.db.base import Archivable, Base, Timestamped, UUIDPrimaryKey
from app.models.entities import _enum


class AdAccountSpendObservation(UUIDPrimaryKey, Timestamped, Archivable, Base):
    __tablename__ = "ad_account_spend_observations"
    __table_args__ = (
        sa.Index("ix_spend_obs_ws_account_observed", "workspace_id", "ad_account_id", "observed_at"),
        sa.Index("ix_spend_obs_ws_status_observed", "workspace_id", "status", "observed_at"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    ad_account_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("ad_accounts.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    meta_connection_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(), sa.ForeignKey("meta_connections.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    #: The external id as it was read (canonical, without `act_`). Copied, because the registry
    #: record can be edited later and the observation must keep saying what was asked for.
    external_account_id: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    #: `business_specific` / `server_default` — a name, never a credential (rule 40).
    reader_source: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    provider_actor_external_id: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    provider_actor_name: Mapped[str | None] = mapped_column(sa.String(200), nullable=True)
    trigger: Mapped[SpendObservationTrigger] = mapped_column(
        _enum(SpendObservationTrigger, "spend_observation_trigger"), nullable=False
    )
    #: UTC, when the read happened. Used for freshness only — never to decide what a "day" is.
    observed_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    status: Mapped[SpendObservationStatus] = mapped_column(
        _enum(SpendObservationStatus, "spend_observation_status"), nullable=False
    )
    #: `MetaFailureCode` value, as text (same convention as discovery runs).
    failure_code: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    #: The transport's own safe sentence. Never a provider response body (rule 26).
    failure_summary: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)

    #: What Meta returned. Never written back onto `AdAccount`.
    observed_currency: Mapped[str | None] = mapped_column(sa.String(3), nullable=True)
    observed_timezone_name: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    #: Meta's numeric codes as the raw strings it sent. Not interpreted in S1.
    observed_account_status: Mapped[str | None] = mapped_column(sa.String(16), nullable=True)
    observed_disable_reason: Mapped[str | None] = mapped_column(sa.String(16), nullable=True)
    #: Raw strings, unit unverified. Never divided, converted or summed here.
    amount_spent_raw: Mapped[str | None] = mapped_column(sa.String(32), nullable=True)
    spend_cap_raw: Mapped[str | None] = mapped_column(sa.String(32), nullable=True)
    balance_raw: Mapped[str | None] = mapped_column(sa.String(32), nullable=True)

    #: `[{"date_start", "date_stop", "spend", "account_currency"}]`, one element per day exactly as
    #: Meta returned it. A day with no row has **no element** — never an inserted zero (rule 4).
    daily_json: Mapped[list | None] = mapped_column(sa.JSON(), nullable=True)
    #: The window that was requested, in the account's own local dates.
    window_since: Mapped[date | None] = mapped_column(sa.Date(), nullable=True)
    window_until: Mapped[date | None] = mapped_column(sa.Date(), nullable=True)
    safe_metadata_json: Mapped[dict | None] = mapped_column(sa.JSON(), nullable=True)
