"""S1 — reading spend from Meta, storing it, and assembling spend facts from what was stored.

The only places that write `ad_account_spend_observations`. Three boundaries are kept here:

* **Who can be read** is decided once, by `resolve_spend_connection`: the account's Business
  Manager, a non-archived `production` connection reading that Business Manager, and a configured
  reader credential for it. Anything short of all three is `not_observable` — the product cannot
  read it, which is a different fact from "nobody has read it yet" (rule 28).
* **Reading** goes through a provider built for that connection — the real, read-only provider
  (`meta_real_provider.py`) — and nothing else. `provider_for_connection` is the single seam a
  test replaces; no test reaches the network.
* **Facts** are assembled from the database only (`build_spend_facts`), so health evaluation and
  every spend endpoint except `refresh` contact no advertising platform.

Nothing here writes `AdAccount.last_synced_at`, `currency` or `timezone`: a spend read must not
move readiness (rule 11's spirit — decided 2026-10-26, §6.6 of the audit).
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.enums import (
    MetaEnvironment,
    SpendObservationStatus,
    SpendObservationTrigger,
)
from app.core.redaction import redact
from app.models.entities import AdAccount
from app.models.meta_operations import MetaConnection
from app.models.spend import AdAccountSpendObservation
from app.services.extension_context import canonical_external_id
from app.services.meta_provider import (
    MetaBusinessProvider,
    MetaFailureCode,
    ProviderIdentity,
    SpendRead,
)
from app.services.meta_real_provider import READER_NONE, build_real_provider, resolve_reader
from app.services.spend_engine import ObservationView, SpendFacts, assemble

logger = logging.getLogger(__name__)

#: How far back observations are loaded to assemble facts. Two weeks of days plus margin.
SPEND_LOOKBACK_DAYS = 21
#: And at most this many rows, so an account read every few minutes cannot make a page slow.
SPEND_LOOKBACK_ROWS = 200


def connection_business_id(connection: MetaConnection, settings=None) -> str:
    """Which Business Manager a connection reads: its own reference, else the server setting.

    The single statement of that precedence; `meta_operations._business_id_for` delegates here.
    """
    settings = settings or get_settings()
    return (connection.business_manager_reference or "").strip() or (settings.meta_business_id or "").strip()


@dataclass(frozen=True)
class SpendReader:
    """The connection and named credential that can read one account. Never the credential."""

    connection: MetaConnection
    reader_source: str
    business_id: str


def _connections_by_business(session: Session, workspace_id: uuid.UUID, settings) -> dict[str, SpendReader]:
    """Business Manager id -> the one connection chosen to read it.

    Only `production` connections with a configured reader count: a fake or sandbox connection
    never reaches Meta, and spend that no platform reported must not appear as observed. When
    several qualify for one Business Manager (it has happened), a connection that names the
    Business Manager itself wins over one inheriting the server setting, then the oldest.
    """
    rows = session.execute(
        sa.select(MetaConnection)
        .where(
            MetaConnection.workspace_id == workspace_id,
            MetaConnection.archived_at.is_(None),
            MetaConnection.environment == MetaEnvironment.PRODUCTION,
        )
        .order_by(MetaConnection.created_at.asc(), MetaConnection.id.asc())
    ).scalars().all()
    chosen: dict[str, tuple[int, SpendReader]] = {}
    for connection in rows:
        business_id = connection_business_id(connection, settings)
        if not business_id:
            continue
        _, reader_source = resolve_reader(settings, business_id)
        if reader_source == READER_NONE:
            continue
        rank = 0 if (connection.business_manager_reference or "").strip() else 1
        current = chosen.get(business_id)
        if current is None or rank < current[0]:
            chosen[business_id] = (rank, SpendReader(connection, reader_source, business_id))
    return {key: value for key, (_, value) in chosen.items()}


def _account_business_id(account: AdAccount) -> str:
    bm = account.business_manager
    if bm is None or bm.archived_at is not None:
        return ""
    return (bm.external_id or "").strip()


def resolve_spend_connection(
    session: Session, workspace_id: uuid.UUID, account: AdAccount, settings=None
) -> SpendReader | None:
    """`None` means `not_observable`. Reads server configuration and the database, never Meta."""
    settings = settings or get_settings()
    if account.archived_at is not None or not canonical_external_id(account.external_account_id):
        return None
    business_id = _account_business_id(account)
    if not business_id:
        return None
    return _connections_by_business(session, workspace_id, settings).get(business_id)


def provider_for_connection(reader: SpendReader) -> MetaBusinessProvider:
    """The real, read-only provider for this connection's Business Manager.

    The one place a spend read gets its provider, and the seam tests replace — automated tests
    never build this, so they can never reach the network.
    """
    return build_real_provider(get_settings(), business_id=reader.business_id)


def _view(row: AdAccountSpendObservation) -> ObservationView:
    return ObservationView(
        id=str(row.id),
        observed_at=row.observed_at,
        status=row.status,
        failure_code=row.failure_code,
        failure_summary=row.failure_summary,
        currency=row.observed_currency,
        timezone_name=row.observed_timezone_name,
        account_status_raw=row.observed_account_status,
        disable_reason_raw=row.observed_disable_reason,
        amount_spent_raw=row.amount_spent_raw,
        spend_cap_raw=row.spend_cap_raw,
        balance_raw=row.balance_raw,
        daily=tuple(item for item in (row.daily_json or []) if isinstance(item, dict)),
        window_since=row.window_since,
        window_until=row.window_until,
        reader_source=row.reader_source,
        provider_actor_external_id=row.provider_actor_external_id,
        provider_actor_name=row.provider_actor_name,
        trigger=row.trigger.value if row.trigger else None,
        meta_connection_id=str(row.meta_connection_id),
    )


def recent_observations(
    session: Session, workspace_id: uuid.UUID, ad_account_id: uuid.UUID, *, now: datetime
) -> list[AdAccountSpendObservation]:
    return list(
        session.execute(
            sa.select(AdAccountSpendObservation)
            .where(
                AdAccountSpendObservation.workspace_id == workspace_id,
                AdAccountSpendObservation.ad_account_id == ad_account_id,
                AdAccountSpendObservation.archived_at.is_(None),
                AdAccountSpendObservation.observed_at >= now - timedelta(days=SPEND_LOOKBACK_DAYS),
            )
            .order_by(AdAccountSpendObservation.observed_at.desc())
            .limit(SPEND_LOOKBACK_ROWS)
        ).scalars().all()
    )


def latest_success_any_age(
    session: Session, workspace_id: uuid.UUID, ad_account_id: uuid.UUID
) -> AdAccountSpendObservation | None:
    """The newest successful read however old — so a very stale account still reports `stale`
    rather than `never_observed` once it falls outside the lookback."""
    return session.execute(
        sa.select(AdAccountSpendObservation)
        .where(
            AdAccountSpendObservation.workspace_id == workspace_id,
            AdAccountSpendObservation.ad_account_id == ad_account_id,
            AdAccountSpendObservation.archived_at.is_(None),
            AdAccountSpendObservation.status == SpendObservationStatus.SUCCEEDED,
        )
        .order_by(AdAccountSpendObservation.observed_at.desc())
        .limit(1)
    ).scalars().first()


def build_spend_facts(
    session: Session,
    workspace_id: uuid.UUID,
    account: AdAccount,
    *,
    now: datetime | None = None,
    reader: SpendReader | None | object = ...,
) -> SpendFacts:
    """Assemble spend facts for one account from stored observations. Never calls a provider."""
    settings = get_settings()
    now = now or datetime.now(UTC)
    if reader is ...:
        reader = resolve_spend_connection(session, workspace_id, account, settings)
    rows = recent_observations(session, workspace_id, account.id, now=now)
    if not any(row.status == SpendObservationStatus.SUCCEEDED for row in rows):
        older = latest_success_any_age(session, workspace_id, account.id)
        if older is not None:
            rows.append(older)
    return assemble(
        observable=reader is not None,
        observations=[_view(row) for row in rows],
        now=now,
        stale_after_hours=settings.spend_observation_stale_after_hours,
        reader_source=reader.reader_source if reader else None,
        meta_connection_id=str(reader.connection.id) if reader else None,
        registry_currency=account.currency,
        baseline_min_days=settings.spend_baseline_min_days,
        change_ratio_threshold=settings.spend_change_ratio_threshold,
        change_min_amounts=settings.spend_change_min_amount_json,
        cap_ratio_threshold=settings.spend_cap_ratio_threshold,
    )


def _iso_date(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        return None


class SpendObservationService:
    """Reads one account through a provider and records exactly one observation for it."""

    def __init__(self, session: Session, workspace_id: uuid.UUID) -> None:
        self.session = session
        self.workspace_id = workspace_id

    def read_and_record(
        self,
        account: AdAccount,
        reader: SpendReader,
        provider: MetaBusinessProvider,
        *,
        trigger: SpendObservationTrigger,
        identity: ProviderIdentity | None = None,
        now: datetime | None = None,
    ) -> tuple[AdAccountSpendObservation, SpendRead]:
        now = now or datetime.now(UTC)
        external_id = canonical_external_id(account.external_account_id) or ""
        try:
            read = provider.read_account_spend(external_id, now=now)
        except Exception as exc:  # noqa: BLE001 - a provider bug must still leave a record
            logger.exception("spend_read_failed", extra={"reason": type(exc).__name__})
            read = SpendRead(
                ok=False,
                failure_code=MetaFailureCode.UNKNOWN_ERROR,
                failure_summary="The spend read failed inside this product; see the process log.",
            )
        observation = AdAccountSpendObservation(
            workspace_id=self.workspace_id,
            ad_account_id=account.id,
            meta_connection_id=reader.connection.id,
            external_account_id=external_id[:120],
            reader_source=reader.reader_source,
            provider_actor_external_id=(identity.external_id if identity else None),
            provider_actor_name=((identity.name or None) if identity else None),
            trigger=trigger,
            observed_at=now,
            status=SpendObservationStatus.SUCCEEDED if read.ok else SpendObservationStatus.FAILED,
            failure_code=(read.failure_code.value if read.failure_code else None) if not read.ok else None,
            failure_summary=((read.failure_summary or "")[:500] or None) if not read.ok else None,
            observed_currency=read.currency[:3].upper() if read.currency else None,
            observed_timezone_name=(read.timezone_name or None) and read.timezone_name[:64],
            observed_account_status=(read.account_status_raw or None) and read.account_status_raw[:16],
            observed_disable_reason=(read.disable_reason_raw or None) and read.disable_reason_raw[:16],
            amount_spent_raw=read.amount_spent_raw,
            spend_cap_raw=read.spend_cap_raw,
            balance_raw=read.balance_raw,
            # Allowlisted fields only (`DailySpend.as_dict`), and through the redactor anyway — the
            # second gate every stored provider payload in this product passes.
            daily_json=redact([day.as_dict() for day in read.daily]) if read.ok or read.daily else None,
            window_since=_iso_date(read.window_since),
            window_until=_iso_date(read.window_until),
            safe_metadata_json=None,
        )
        self.session.add(observation)
        self.session.flush()
        logger.info(
            "spend_observation_recorded",
            extra={
                "status": observation.status.value,
                "failure_code": observation.failure_code,
                "trigger": trigger.value,
            },
        )
        return observation, read


@dataclass(frozen=True)
class DueAccount:
    account: AdAccount
    reader: SpendReader
    last_success_at: datetime | None
    last_attempt_at: datetime | None

    @property
    def never_observed(self) -> bool:
        return self.last_success_at is None


@dataclass
class SweepSelection:
    due: list[DueAccount]
    not_observable: int


def select_due_accounts(
    session: Session, workspace_id: uuid.UUID, *, cutoff: datetime, settings=None
) -> SweepSelection:
    """Every observable account whose spend is `never_observed` or `stale`, in read order.

    Not-observable accounts are counted, never due: there is nothing to read them with. Order is
    "never attempted first, then the oldest attempt", which puts never-observed accounts first and
    keeps one permanently failing account from starving every other account of its turn.
    """
    settings = settings or get_settings()
    accounts = list(
        session.execute(
            sa.select(AdAccount)
            .where(AdAccount.workspace_id == workspace_id, AdAccount.archived_at.is_(None))
            .order_by(AdAccount.created_at.asc(), AdAccount.id.asc())
        ).scalars().unique().all()
    )
    readers = _connections_by_business(session, workspace_id, settings)
    stats = {
        row.ad_account_id: (row.last_success, row.last_attempt)
        for row in session.execute(
            sa.select(
                AdAccountSpendObservation.ad_account_id,
                sa.func.max(
                    sa.case(
                        (
                            AdAccountSpendObservation.status == SpendObservationStatus.SUCCEEDED,
                            AdAccountSpendObservation.observed_at,
                        ),
                        else_=None,
                    )
                ).label("last_success"),
                sa.func.max(AdAccountSpendObservation.observed_at).label("last_attempt"),
            )
            .where(
                AdAccountSpendObservation.workspace_id == workspace_id,
                AdAccountSpendObservation.archived_at.is_(None),
            )
            .group_by(AdAccountSpendObservation.ad_account_id)
        ).all()
    }
    due: list[DueAccount] = []
    not_observable = 0
    for account in accounts:
        reader = None
        if canonical_external_id(account.external_account_id):
            reader = readers.get(_account_business_id(account))
        if reader is None:
            not_observable += 1
            continue
        last_success, last_attempt = stats.get(account.id, (None, None))
        if last_success is not None and last_success >= cutoff:
            continue
        due.append(DueAccount(account, reader, last_success, last_attempt))
    due.sort(
        key=lambda d: (
            d.last_attempt_at is not None,
            d.last_attempt_at or datetime.min.replace(tzinfo=UTC),
        )
    )
    return SweepSelection(due=due, not_observable=not_observable)
