"""O3 — scheduled discovery and automatic import (Meta, read-only).

The dispatcher's `discovery_sweep_pass` is a loop over workspaces; everything it does to one
connection lives here, so the rules are in one place:

* **Who is swept.** A connection whose owner switched `auto_discovery_enabled` on, that is
  `production`, names a Business Manager, and has a configured reader credential
  (`spend_service.reader_for_connection` — the same predicate spend uses). `fake` and `sandbox`
  connections are excluded by the query itself, so fake inventory can never reach the registry.
  A switched-on connection that cannot be read is counted `not_configured` and costs no call.
* **What is read.** Exactly the discovery a person runs: `MetaDiscoveryService`, unchanged,
  through the one provider seam (`spend_service.provider_for_connection`). Read-only by
  construction — the transport beneath it has no write method.
* **What is written.** Only when `auto_import_enabled` is also on and the run is usable: each
  `missing_in_registry` ad account of *that* run goes through the same `import_ad_account` a
  person's click does, one SAVEPOINT per account. An account the registry holds **archived** is
  never re-imported and never restored (rule 2) — it is counted and reported. Absence never
  archives anything: it only feeds `account_not_returned_by_latest_discovery`, and only from a
  complete inventory.
* **Who acted.** The system. Every audit row carries `actor_id = NULL` and
  `metadata.actor = "system:discovery_sweep"` (`SystemAuditLogService`); runs carry
  `created_by = NULL` and `trigger = scheduled_sweep`.
* **What is said.** At most one summary alert per pass per connection
  (`AlertSourceType.DISCOVERY_SWEEP`, template `a3-v1-summary`) — and only when there is
  something new to say — instead of one message per imported account.
"""
from __future__ import annotations

import hashlib
import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.enums import (
    ACTIVE_ALERT_STATUSES,
    AlertSeverity,
    AlertSourceType,
    AlertStatus,
    AutoImportDecision,
    DeliveryReason,
    DiscoveryRunStatus,
    DiscoveryTrigger,
    EvaluationTrigger,
    MetaEnvironment,
)
from app.core.errors import ConflictError
from app.core.redaction import redact
from app.models.alerts import Alert
from app.models.entities import AdAccount, BusinessManager
from app.models.meta_discovery import BusinessManagerDiscoveryRun, DiscoveredAdAccountObservation
from app.models.meta_operations import MetaConnection
from app.services.alert_service import AlertPolicyService
from app.services.audit import AuditLogService
from app.services.base import snapshot as orm_snapshot
from app.services.extension_context import canonical_external_id
from app.services.health_service import AccountHealthEvaluationService
from app.services.meta_discovery import (
    MATCHED,
    MISSING_FROM_LATEST,
    MISSING_IN_REGISTRY,
    MetaDiscoveryService,
)
from app.services.meta_provider import MetaBusinessProvider, MetaFailureCode
from app.services.meta_real_provider import READER_BUSINESS_SPECIFIC
from app.services.notification_service import NotificationPlannerService
from app.services.notification_templates import SUMMARY_MAX_IDS
from app.services.spend_service import SpendReader, connection_business_id, reader_for_connection

logger = logging.getLogger(__name__)

#: Runs that read assets. A failed run read nothing that may be imported (§4b degradation table).
USABLE_RUN_STATUSES = frozenset(
    {DiscoveryRunStatus.SUCCEEDED, DiscoveryRunStatus.SUCCEEDED_WITH_WARNINGS}
)

SUMMARY_NEXT_STEP = (
    "Open the connection's workspace to review. An archived account Meta still returns is never "
    "restored automatically — restore it yourself if it belongs here. Nothing was archived."
)


# --------------------------------------------------------------------------- eligibility


def automation_eligibility(connection: MetaConnection, settings=None) -> tuple[bool, str | None]:
    """Whether the sweep could read this connection, and if not, the one reason why.

    `not_production` is the permanent refusal (fake data must never be discovered on a timer);
    the other two are configuration a release can fix. Never reads Meta.
    """
    settings = settings or get_settings()
    if connection.archived_at is not None:
        return False, "archived"
    if connection.environment != MetaEnvironment.PRODUCTION:
        return False, "not_production"
    if not connection_business_id(connection, settings):
        return False, "business_manager_not_configured"
    if reader_for_connection(connection, settings) is None:
        return False, "reader_not_configured"
    return True, None


def serialize_automation(connection: MetaConnection, settings=None) -> dict:
    eligible, reason = automation_eligibility(connection, settings)
    return {
        "auto_discovery_enabled": bool(connection.auto_discovery_enabled),
        "auto_import_enabled": bool(connection.auto_import_enabled),
        "enabled_by": str(connection.automation_enabled_by) if connection.automation_enabled_by else None,
        "enabled_at": connection.automation_enabled_at.isoformat() if connection.automation_enabled_at else None,
        "eligible": eligible,
        "ineligible_reason": reason,
    }


# ----------------------------------------------------------------------------- selection


@dataclass(frozen=True)
class DueConnection:
    connection: MetaConnection
    reader: SpendReader
    last_completed_at: datetime | None

    @property
    def never_discovered(self) -> bool:
        return self.last_completed_at is None


@dataclass
class ConnectionSelection:
    due: list[DueConnection]
    not_configured: int


def select_due_connections(
    session: Session, workspace_id: uuid.UUID, *, cutoff: datetime, settings=None
) -> ConnectionSelection:
    """Automatic connections whose latest run (any trigger, any outcome) finished before
    `cutoff`, never-discovered first, then oldest. A failing connection is therefore retried once
    per window, not on every pass — a refused token is not hammered."""
    settings = settings or get_settings()
    rows = session.execute(
        sa.select(MetaConnection)
        .where(
            MetaConnection.workspace_id == workspace_id,
            MetaConnection.archived_at.is_(None),
            # Structural, not a later check: a fake or sandbox connection is never even loaded.
            MetaConnection.environment == MetaEnvironment.PRODUCTION,
            MetaConnection.auto_discovery_enabled.is_(True),
        )
        .order_by(MetaConnection.created_at.asc(), MetaConnection.id.asc())
    ).scalars().all()
    if not rows:
        return ConnectionSelection(due=[], not_configured=0)
    latest = dict(
        session.execute(
            sa.select(
                BusinessManagerDiscoveryRun.meta_connection_id,
                sa.func.max(BusinessManagerDiscoveryRun.completed_at),
            )
            .where(
                BusinessManagerDiscoveryRun.workspace_id == workspace_id,
                BusinessManagerDiscoveryRun.archived_at.is_(None),
                BusinessManagerDiscoveryRun.meta_connection_id.in_([row.id for row in rows]),
            )
            .group_by(BusinessManagerDiscoveryRun.meta_connection_id)
        ).all()
    )
    due: list[DueConnection] = []
    not_configured = 0
    for connection in rows:
        reader = reader_for_connection(connection, settings)
        if reader is None:
            not_configured += 1
            continue
        last = latest.get(connection.id)
        if last is not None and last >= cutoff:
            continue
        due.append(DueConnection(connection, reader, last))
    due.sort(
        key=lambda d: (
            d.last_completed_at is not None,
            d.last_completed_at or datetime.min.replace(tzinfo=UTC),
        )
    )
    return ConnectionSelection(due=due, not_configured=not_configured)


def budget_key(reader: SpendReader) -> str:
    """Which rate-limit budget a read spends. A Business Manager with its own credential has its
    own budget; every connection on the server default shares one. `rate_limited` stops the rest
    of the pass for that budget only."""
    if reader.reader_source == READER_BUSINESS_SPECIFIC:
        return f"business:{reader.business_id}"
    return "server_default"


# ------------------------------------------------------------------------------- outcome


@dataclass
class ConnectionSweepOutcome:
    connection: MetaConnection
    run: BusinessManagerDiscoveryRun | None = None
    failed_in_product: bool = False
    rate_limited: bool = False
    already_in_registry: int = 0
    #: `(ad_account_id, external_id, owner_business_reference)`
    imported: list[tuple[str, str, str | None]] = field(default_factory=list)
    #: `(external_id, owner_business_reference)` — new, but import is switched off.
    awaiting_import: list[tuple[str, str | None]] = field(default_factory=list)
    archived_returned: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)
    pixels_new: list[str] = field(default_factory=list)
    not_returned: list[str] = field(default_factory=list)
    summary_alert: Alert | None = None

    @property
    def status(self) -> str:
        if self.run is None:
            return "failed"
        if self.run.status == DiscoveryRunStatus.SUCCEEDED:
            return "succeeded"
        if self.run.status == DiscoveryRunStatus.SUCCEEDED_WITH_WARNINGS:
            return "warnings"
        return "failed"

    def counters(self) -> dict[str, int]:
        return {
            "imported": len(self.imported),
            "already_in_registry": self.already_in_registry,
            "archived_returned": len(self.archived_returned),
            "conflicts": len(self.conflicts),
            "awaiting_import": len(self.awaiting_import),
            "pixels_new": len(self.pixels_new),
            "not_returned_complete": len(self.not_returned),
        }

    def fingerprint(self) -> str:
        """The standing conditions a summary reports, minus imports (which are new by nature).
        Equal fingerprints mean the previous summary already says this; nothing new is sent."""
        material = {
            "awaiting_import": sorted(external_id for external_id, _ in self.awaiting_import),
            "archived_returned": sorted(self.archived_returned),
            "not_returned": sorted(self.not_returned),
            "pixels_new": sorted(self.pixels_new),
        }
        if not any(material.values()):
            return ""
        encoded = json.dumps(material, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(encoded.encode()).hexdigest()


# ------------------------------------------------------------------------------- service


class DiscoverySweepService:
    """One workspace's share of a discovery-sweep pass. `audit` is a `SystemAuditLogService`."""

    def __init__(
        self,
        session: Session,
        workspace_id: uuid.UUID,
        audit: AuditLogService,
        *,
        settings=None,
    ) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit
        self.settings = settings or get_settings()

    def sweep_connection(
        self, due: DueConnection, provider: MetaBusinessProvider
    ) -> ConnectionSweepOutcome:
        outcome = ConnectionSweepOutcome(connection=due.connection)
        try:
            with self.session.begin_nested():
                self._sweep(due, provider, outcome)
        except Exception as exc:  # noqa: BLE001 - one connection must not end the pass
            # A provider answers with failure codes; an exception is a defect in this product.
            # The connection's SAVEPOINT is rolled back (its run too) and the pass carries on.
            logger.exception(
                "discovery_sweep_connection_failed",
                extra={"meta_connection_id": str(due.connection.id), "error_type": type(exc).__name__},
            )
            outcome = ConnectionSweepOutcome(connection=due.connection, failed_in_product=True)
            return outcome
        try:
            with self.session.begin_nested():
                outcome.summary_alert = self._summary_alert(outcome)
        except Exception as exc:  # noqa: BLE001 - alerting degrades alerting only (rule 21)
            logger.exception(
                "discovery_sweep_summary_failed",
                extra={"meta_connection_id": str(due.connection.id), "error_type": type(exc).__name__},
            )
            outcome.summary_alert = None
        return outcome

    # ---------------------------------------------------------------- internals
    def _sweep(
        self, due: DueConnection, provider: MetaBusinessProvider, outcome: ConnectionSweepOutcome
    ) -> None:
        service = MetaDiscoveryService(
            self.session,
            self.workspace_id,
            self.audit,
            provider=provider,
            business_id=due.reader.business_id,
        )
        run = service.validate_configured_business_manager(
            due.connection, trigger=DiscoveryTrigger.SCHEDULED_SWEEP, actor_id=None
        )
        if run.status == DiscoveryRunStatus.SUCCEEDED:
            service.discover_assets(run)
        outcome.run = run
        outcome.rate_limited = run.failure_code == MetaFailureCode.RATE_LIMITED.value
        if run.status not in USABLE_RUN_STATUSES:
            # Validation failed: nothing was read, so nothing may be imported or concluded.
            return

        imported_ids: set[uuid.UUID] = set()
        for row in service.reconcile_ad_accounts(run):
            if row.status == MATCHED:
                outcome.already_in_registry += 1
            elif row.status == MISSING_FROM_LATEST and row.external_id:
                # Only reachable from a complete inventory (reconcile's own order). Signal only.
                outcome.not_returned.append(row.external_id)
            elif row.status == MISSING_IN_REGISTRY and row.external_id:
                account_id = self._decide(service, run, row.external_id, due.connection, outcome)
                if account_id is not None:
                    imported_ids.add(account_id)
        outcome.pixels_new = [
            row.external_id
            for row in service.reconcile_pixels(run)
            if row.status == MISSING_IN_REGISTRY and row.external_id
        ]
        self._evaluate_business_manager_accounts(run, skip=imported_ids)

    def _owner_reference(self, run: BusinessManagerDiscoveryRun, external_id: str) -> str | None:
        metadata = self.session.execute(
            sa.select(DiscoveredAdAccountObservation.safe_metadata_json).where(
                DiscoveredAdAccountObservation.business_manager_discovery_run_id == run.id,
                DiscoveredAdAccountObservation.external_account_id == external_id,
            )
        ).scalar_one_or_none() or {}
        owner = metadata.get("owner_business_id")
        # A client account's owner is worth naming; the hub owning its own account is not news.
        if owner and owner != canonical_external_id(run.configured_business_manager_reference):
            return str(owner)
        return None

    def _decide(
        self,
        service: MetaDiscoveryService,
        run: BusinessManagerDiscoveryRun,
        external_id: str,
        connection: MetaConnection,
        outcome: ConnectionSweepOutcome,
    ) -> uuid.UUID | None:
        owner = self._owner_reference(run, external_id)
        existing = service.registry_account_any_state(external_id)
        if existing is not None and existing.archived_at is not None:
            # Reconcile reads active rows only, so Meta returning an archived account shows as
            # `missing_in_registry`. Never imported again, never restored — a person decides
            # (rule 2).
            outcome.archived_returned.append(external_id)
            return None
        if existing is not None:
            outcome.already_in_registry += 1
            return None
        if not connection.auto_import_enabled:
            outcome.awaiting_import.append((external_id, owner))
            return None
        try:
            with self.session.begin_nested():
                account = service.import_ad_account(
                    run,
                    external_id,
                    automatic=True,
                    extra_metadata={"decision": AutoImportDecision.IMPORTED.value},
                )
        except (ConflictError, IntegrityError):
            # A uniqueness race (another pass, or a person importing the same account at the same
            # moment). This account's SAVEPOINT is gone; every other account carries on.
            outcome.conflicts.append(external_id)
            return None
        outcome.imported.append((str(account.id), external_id, owner))
        return account.id

    def _evaluate_business_manager_accounts(
        self, run: BusinessManagerDiscoveryRun, *, skip: set[uuid.UUID]
    ) -> None:
        """Re-evaluate the registry accounts of this run's Business Manager, so
        `account_not_returned_by_latest_discovery` opens or closes with the run that decides it.
        Reads stored facts only; each evaluation in its own SAVEPOINT (rule 15)."""
        reference = canonical_external_id(run.configured_business_manager_reference)
        if not reference:
            return
        accounts = self.session.execute(
            sa.select(AdAccount)
            .join(BusinessManager, BusinessManager.id == AdAccount.business_manager_id)
            .where(
                AdAccount.workspace_id == self.workspace_id,
                AdAccount.archived_at.is_(None),
                BusinessManager.archived_at.is_(None),
                sa.func.lower(BusinessManager.external_id) == reference,
            )
            .order_by(AdAccount.created_at.asc(), AdAccount.id.asc())
        ).scalars().all()
        evaluation = AccountHealthEvaluationService(self.session, self.workspace_id, self.audit, None)
        for account in accounts:
            if account.id in skip:
                continue  # just imported: `import_ad_account` evaluated it already
            evaluation.evaluate_account_safe(
                account, trigger=EvaluationTrigger.DISCOVERY_SWEEP, trigger_reference_id=str(run.id)
            )

    # ------------------------------------------------------------------ summary alert
    def _active_summaries(self, connection: MetaConnection) -> list[Alert]:
        return list(
            self.session.execute(
                sa.select(Alert).where(
                    Alert.workspace_id == self.workspace_id,
                    Alert.source_type == AlertSourceType.DISCOVERY_SWEEP,
                    Alert.alert_key.like(f"discovery_sweep:{connection.id}:%"),
                    Alert.status.in_(list(ACTIVE_ALERT_STATUSES)),
                )
            ).scalars().all()
        )

    def _close_summary(self, alert: Alert, *, reason: str, by: str) -> None:
        before = orm_snapshot(alert)
        alert.status = AlertStatus.RESOLVED
        alert.active_key = None
        alert.resolved_at = datetime.now(UTC)
        alert.resolved_by = None
        alert.resolution_reason = reason
        self.session.flush()
        self.audit.record(
            action="alert.resolved",
            entity_type="alert",
            entity_id=alert.id,
            before=before,
            after=orm_snapshot(alert),
            metadata={"resolved_by": by},
        )

    def _summary_alert(self, outcome: ConnectionSweepOutcome) -> Alert | None:
        """At most one alert per pass per connection, and only when something is new.

        "New" is either an import, or a set of standing conditions (awaiting import, archived but
        returned, not returned by a complete discovery, new Pixels) different from what the
        connection's current summary already says. An unchanged condition is not re-announced
        every day; a summary whose conditions have all cleared is closed by its source.
        """
        run = outcome.run
        if run is None or run.status not in USABLE_RUN_STATUSES:
            return None
        connection = outcome.connection
        fingerprint = outcome.fingerprint()
        previous = self._active_summaries(connection)
        if not outcome.imported:
            if not fingerprint:
                for alert in previous:
                    if (alert.source_snapshot_json or {}).get("fingerprint"):
                        self._close_summary(
                            alert,
                            reason="The conditions this summary reported are no longer present.",
                            by="source_condition",
                        )
                return None
            if any((alert.source_snapshot_json or {}).get("fingerprint") == fingerprint for alert in previous):
                return None
        for alert in previous:
            self._close_summary(
                alert, reason="Superseded by a newer discovery sweep summary.", by="newer_summary"
            )

        counters = outcome.counters()
        new_accounts = [
            {"external_id": external_id, "owner_business_reference": owner}
            for _, external_id, owner in outcome.imported
        ] + [
            {"external_id": external_id, "owner_business_reference": owner}
            for external_id, owner in outcome.awaiting_import
        ]
        parts = [
            f"{label} {counters[key]}"
            for key, label in (
                ("imported", "imported"),
                ("awaiting_import", "new but not imported"),
                ("archived_returned", "archived here but still returned"),
                ("not_returned_complete", "not returned by this complete discovery"),
                ("pixels_new", "new Pixels"),
                ("conflicts", "import conflicts"),
            )
            if counters[key]
        ]
        reader = run.provider_actor_name or run.provider_actor_external_id or "an unknown identity"
        summary = (
            f"Scheduled discovery of {connection.label}: {', '.join(parts)}. Read as {reader}; "
            f"ad account coverage {run.ad_account_coverage_status.value}."
        )
        now = datetime.now(UTC)
        alert = Alert(
            workspace_id=self.workspace_id,
            ad_account_id=None,
            source_type=AlertSourceType.DISCOVERY_SWEEP,
            source_entity_type="business_manager_discovery_run",
            source_entity_id=str(run.id),
            alert_key=f"discovery_sweep:{connection.id}:{run.id}",
            active_key=f"discovery_sweep:{connection.id}:{run.id}",
            category="discovery",
            # §9 8.3: the existing policy's `warning` level — Telegram when warnings are on, and
            # deferred, never discarded, in quiet hours. No new policy column.
            severity=AlertSeverity.WARNING,
            status=AlertStatus.OPEN,
            title=f"Discovery sweep — {connection.label}"[:200],
            summary=summary,
            source_snapshot_json=redact(
                {
                    "meta_connection_id": str(connection.id),
                    "connection_label": connection.label,
                    "discovery_run_id": str(run.id),
                    "business_manager_reference": run.configured_business_manager_reference,
                    "business_manager_name": run.configured_business_manager_name,
                    "read_as": reader,
                    "ad_account_coverage_status": run.ad_account_coverage_status.value,
                    "counters": counters,
                    "new_accounts": new_accounts[:SUMMARY_MAX_IDS],
                    "archived_returned": outcome.archived_returned[:SUMMARY_MAX_IDS],
                    "fingerprint": fingerprint,
                    "recommended_next_step": SUMMARY_NEXT_STEP,
                }
            ),
            first_observed_at=run.completed_at or now,
            last_observed_at=now,
        )
        self.session.add(alert)
        self.session.flush()
        self.audit.record(
            action="alert.created",
            entity_type="alert",
            entity_id=alert.id,
            after=orm_snapshot(alert),
            metadata={"source_type": alert.source_type.value, "severity": alert.severity.value},
        )
        policy = AlertPolicyService(self.session, self.workspace_id, self.audit).get_or_create()
        NotificationPlannerService(self.session, self.workspace_id, self.audit).plan(
            alert, policy, None, reason=DeliveryReason.INITIAL
        )
        return alert
