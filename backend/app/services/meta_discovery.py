"""MINI-SPEC A10.1 — configured Business Manager validation.

Step one of a discovery run, and a gate: asset discovery is only allowed to happen after the
configured BM has actually been read back. If it has not, the run stops here and records why,
because reading assets from a BM that could not be validated would produce an inventory nobody
can attribute to anything.

Every read goes through the provider, which goes through `_read_business_managers()`. Nothing in
this module talks to Meta directly — that is what let a third reader drift out of agreement with
the other two once already.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.enums import (
    ACTIVE_ALERT_STATUSES,
    AccountType,
    AlertSeverity,
    AlertSourceType,
    AlertStatus,
    AssetReconciliationStatus,
    BusinessAuthority,
    CoverageStatus,
    DeliveryReason,
    DiscoveryRunStatus,
    DiscoveryTrigger,
    EvaluationTrigger,
    IdentityBusinessRole,
)
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.redaction import redact
from app.models.alerts import Alert
from app.models.entities import (
    AdAccount,
    BusinessManager,
    PersonalAccountBusinessLink,
    PersonalAccountReference,
    Pixel,
    User,
    WorkspaceMember,
)
from app.models.meta_discovery import (
    BusinessManagerDiscoveryRun,
    DiscoveredAdAccountObservation,
    DiscoveredBusinessUserObservation,
    DiscoveredPixelObservation,
)
from app.models.meta_operations import MetaConnection
from app.services.alert_service import AlertPolicyService
from app.services.audit import AuditLogService
from app.services.base import get_or_404, require_active, snapshot
from app.services.extension_context import canonical_external_id
from app.services.health_service import AccountHealthEvaluationService
from app.services.meta_provider import AssetDiscovery, MetaBusinessProvider, MetaFailureCode
from app.services.notification_service import NotificationPlannerService
from app.services.registry import AdAccountRegistryService

#: Local aliases, purely so the decision trees below read as the rules they implement.
MATCHED = AssetReconciliationStatus.MATCHED
MISSING_IN_REGISTRY = AssetReconciliationStatus.MISSING_IN_REGISTRY
MISSING_FROM_LATEST = AssetReconciliationStatus.MISSING_FROM_LATEST_DISCOVERY
OUT_OF_SCOPE = AssetReconciliationStatus.OUT_OF_SCOPE
UNKNOWN = AssetReconciliationStatus.UNKNOWN


_TZ_COUNTRY_FALLBACK: dict[str, str] = {
    "Asia/Ho_Chi_Minh": "VN",
    "Asia/Saigon": "VN",
    "Asia/Bangkok": "TH",
    "Asia/Singapore": "SG",
    "Asia/Jakarta": "ID",
    "Asia/Manila": "PH",
    "Asia/Kuala_Lumpur": "MY",
    "Asia/Tokyo": "JP",
    "Asia/Seoul": "KR",
    "Asia/Hong_Kong": "HK",
    "Asia/Taipei": "TW",
    "America/New_York": "US",
    "America/Chicago": "US",
    "America/Denver": "US",
    "America/Los_Angeles": "US",
    "Europe/London": "GB",
    "Europe/Paris": "FR",
    "Europe/Berlin": "DE",
    "Australia/Sydney": "AU",
}


def _country_from_timezone(tz_name: str | None) -> str | None:
    if not tz_name:
        return None
    tz_clean = tz_name.strip()
    if tz_clean in _TZ_COUNTRY_FALLBACK:
        return _TZ_COUNTRY_FALLBACK[tz_clean]
    try:
        with open("/usr/share/zoneinfo/zone1970.tab", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("#") or not line.strip():
                    continue
                parts = line.strip().split("\t")
                if len(parts) >= 3 and parts[2] == tz_clean:
                    return parts[0].split(",")[0].strip()[:2] or None
    except OSError:
        pass
    return None


@dataclass(frozen=True)
class ReconciliationRow:
    """One comparison outcome. Derived, never persisted — rebuildable from the observations and
    the registry, which is why A10.1 stores no reconciliation table."""

    asset_type: str
    external_id: str | None
    internal_entity_id: uuid.UUID | None
    display_name: str
    status: AssetReconciliationStatus
    #: A safe sentence for the operator. Never a provider body, never an id it did not already
    #: have. `missing_from_latest_discovery` says only "not returned by the latest completed
    #: discovery" — never "deleted", "removed" or "lost".
    detail: str | None = None
    #: Which Graph edge produced the observation behind this row — `owned_ad_accounts` or
    #: `client_ad_accounts` for an ad account, `adspixels` for a Pixel. `None` for a row that
    #: exists only in the registry, because nothing observed it.
    #:
    #: O1.1. The fact was already stored on the observation; it reached the operator only as prose
    #: inside `detail` ("Returned by owned_ad_accounts."), which a filter cannot use and a
    #: translation would break. Carrying it as a field is what lets the UI offer an owned/client
    #: filter without parsing a sentence.
    source_edge: str | None = None


def _authority_of(*discoveries: AssetDiscovery) -> BusinessAuthority:
    """One authority per run, because authority is a fact about the Business Manager, not about
    an asset type.

    A non-empty inventory records `not_checked` — it proved its own authority and no call was
    spent — so in practice at most one asset type carries a checked answer, and this collapses
    them without having to pick a winner. `established` settles it; a checked-and-refused answer
    is recorded as such; only when nothing asked at all does this stay `not_checked`.
    """
    values = {discovery.authority for discovery in discoveries}
    if BusinessAuthority.ESTABLISHED in values:
        return BusinessAuthority.ESTABLISHED
    if BusinessAuthority.NOT_ESTABLISHED in values:
        return BusinessAuthority.NOT_ESTABLISHED
    return BusinessAuthority.NOT_CHECKED


def _coverage_payload(discovery: AssetDiscovery) -> dict:
    """Per-edge evidence, including edges that were never attempted.

    An edge nobody asked for produces no `EdgeOutcome` at all, so listing only what came back
    would silently drop the one fact that matters most when reviewing a `missing` conclusion
    later: that a required source was never read.
    """
    edges: dict[str, dict] = {}
    for outcome in discovery.edges:
        if outcome.truncated:
            status = "truncated"
        elif outcome.ok:
            status = "completed"
        else:
            status = "failed"
        edges[outcome.edge] = {
            "required": outcome.edge in discovery.required_edges,
            "status": status,
            "pages": outcome.pages_read,
            "items": outcome.items,
            "error_code": outcome.failure_code.value if outcome.failure_code else None,
        }
    for required in discovery.required_edges:
        edges.setdefault(
            required,
            {"required": True, "status": "not_attempted", "pages": 0, "items": 0, "error_code": None},
        )
    return {"edges": edges, "total_unique_assets": len(discovery.assets)}


class MetaDiscoveryService:
    """One discovery run at a time, for one connection.

    `business_id` is passed in rather than read from settings here so the caller decides — the
    route reads server configuration, and a test can supply its own without monkeypatching
    global state.
    """

    def __init__(
        self,
        session: Session,
        workspace_id: uuid.UUID,
        audit: AuditLogService,
        *,
        provider: MetaBusinessProvider,
        business_id: str,
    ) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.audit = audit
        self.provider = provider
        self.business_id = business_id.strip()

    def validate_configured_business_manager(
        self,
        connection: MetaConnection,
        *,
        trigger: DiscoveryTrigger = DiscoveryTrigger.MANUAL,
        actor_id: uuid.UUID | None = None,
    ) -> BusinessManagerDiscoveryRun:
        """Create a run and try to read the configured BM back. Two provider calls at most.

        Returns the run either way. A caller decides what to do next by looking at
        `run.status`; there is no exception path for "Meta said no", because that is an ordinary
        answer this product has vocabulary for.
        """
        now = datetime.now(UTC)
        run = BusinessManagerDiscoveryRun(
            workspace_id=self.workspace_id,
            meta_connection_id=connection.id,
            configured_business_manager_reference=self.business_id,
            trigger=trigger,
            status=DiscoveryRunStatus.RUNNING,
            provider_environment=connection.environment,
            started_at=now,
            created_by=actor_id,
        )
        self.session.add(run)
        self.session.flush()

        if not self.business_id:
            # No provider call at all: there is nothing to ask about. Meta will not name the
            # business behind a system user token, so an unconfigured id is a dead end, not
            # something to go discover.
            self._finish(
                run,
                status=DiscoveryRunStatus.FAILED,
                failure_code=MetaFailureCode.NOT_CONFIGURED,
                failure_summary="No Business Manager is configured on the server.",
            )
            return run

        capability = self.provider.check_capability()
        if not capability.list_business_managers:
            self._finish(
                run,
                status=DiscoveryRunStatus.FAILED,
                failure_code=capability.reason or MetaFailureCode.UNKNOWN_ERROR,
                failure_summary="The configured Business Manager could not be read.",
            )
            return run

        match = next(
            (
                business
                for business in self.provider.list_business_managers()
                if business.get("external_id") == self.business_id
            ),
            None,
        )
        if match is None:
            # The capability said a BM is readable, but not the one that is configured. Treating
            # that as success would attribute someone else's assets to this configuration.
            self._finish(
                run,
                status=DiscoveryRunStatus.FAILED,
                failure_code=MetaFailureCode.NOT_CONFIGURED,
                failure_summary="The provider did not return the configured Business Manager.",
            )
            return run

        run.configured_business_manager_name = match.get("name") or None
        self._finish(run, status=DiscoveryRunStatus.SUCCEEDED)
        return run

    def discover_assets(self, run: BusinessManagerDiscoveryRun) -> BusinessManagerDiscoveryRun:
        """Step two, gated on step one. Reads ad accounts and Pixels for the validated BM and
        stores what each edge returned.

        Refuses to run when validation did not succeed: assets read against a BM nobody could
        confirm cannot be attributed to anything.
        """
        if run.status != DiscoveryRunStatus.SUCCEEDED:
            raise ConflictError("Validate the configured Business Manager before reading assets.")

        # Recorded before the inventory it qualifies. What a run can see depends on which
        # identity asked, so an inventory without its reader is evidence about nothing in
        # particular.
        identity = self.provider.identify()
        run.provider_actor_external_id = identity.external_id
        run.provider_actor_name = identity.name or None

        accounts = self.provider.discover_ad_accounts(self.business_id)
        pixels = self.provider.discover_pixels(self.business_id)

        run.business_authority = _authority_of(accounts, pixels)
        run.ad_account_required_edges_json = list(accounts.required_edges)
        run.ad_account_coverage_json = _coverage_payload(accounts)
        run.ad_account_coverage_status = accounts.coverage_status
        run.pixel_required_edges_json = list(pixels.required_edges)
        run.pixel_coverage_json = _coverage_payload(pixels)
        run.pixel_coverage_status = pixels.coverage_status

        observed_at = datetime.now(UTC)
        for asset in accounts.assets:
            self.session.add(
                DiscoveredAdAccountObservation(
                    workspace_id=self.workspace_id,
                    business_manager_discovery_run_id=run.id,
                    provider_business_manager_id=self.business_id,
                    external_account_id=asset.external_id,
                    display_name=asset.name or None,
                    source_edge=asset.source_edge,
                    safe_metadata_json=dict(asset.safe_metadata) or None,
                    observed_at=observed_at,
                )
            )
        for asset in pixels.assets:
            self.session.add(
                DiscoveredPixelObservation(
                    workspace_id=self.workspace_id,
                    business_manager_discovery_run_id=run.id,
                    provider_business_manager_id=self.business_id,
                    external_pixel_id=asset.external_id,
                    display_name=asset.name or None,
                    source_edge=asset.source_edge,
                    safe_metadata_json=dict(asset.safe_metadata) or None,
                    observed_at=observed_at,
                )
            )
        users = (
            self.provider.discover_business_users(self.business_id)
            if hasattr(self.provider, "discover_business_users")
            else AssetDiscovery()
        )
        run.business_user_required_edges_json = list(users.required_edges)
        run.business_user_coverage_json = _coverage_payload(users)
        run.business_user_coverage_status = users.coverage_status
        for asset in users.assets:
            self.session.add(
                DiscoveredBusinessUserObservation(
                    workspace_id=self.workspace_id,
                    business_manager_discovery_run_id=run.id,
                    provider_business_manager_id=self.business_id,
                    external_user_id=asset.external_id,
                    display_name=asset.name or None,
                    role=(asset.safe_metadata or {}).get("role") or None,
                    source_edge=asset.source_edge,
                    safe_metadata_json=dict(asset.safe_metadata) or None,
                    observed_at=observed_at,
                )
            )

        # `succeeded` is reserved for a run that saw everything it was required to see. Anything
        # less is reported as such, however clean the individual requests looked.
        # Backfill BusinessManager currency/country when left blank by the operator
        if self.business_id and accounts.assets:
            bm_row = self.session.execute(
                sa.select(BusinessManager).where(
                    BusinessManager.workspace_id == self.workspace_id,
                    BusinessManager.external_id == self.business_id,
                    BusinessManager.archived_at.is_(None),
                )
            ).scalar_one_or_none()
            if bm_row is not None and (bm_row.currency is None or bm_row.country is None):
                for asset in accounts.assets:
                    meta = asset.safe_metadata or {}
                    c_val = (meta.get("currency") or "").strip()[:10] or None
                    tz_val = (meta.get("timezone_name") or "").strip()[:80] or None
                    cnt_val = _country_from_timezone(tz_val)
                    if bm_row.currency is None and c_val:
                        bm_row.currency = c_val
                    if bm_row.country is None and cnt_val:
                        bm_row.country = cnt_val
                    if bm_row.currency is not None and bm_row.country is not None:
                        break

        complete = accounts.complete and pixels.complete
        self._finish(
            run,
            status=(
                DiscoveryRunStatus.SUCCEEDED
                if complete
                else DiscoveryRunStatus.SUCCEEDED_WITH_WARNINGS
            ),
            failure_code=accounts.reason or pixels.reason,
            failure_summary=None if complete else "Some asset sources were not fully covered.",
            action="meta_discovery.assets_discovered",
        )
        return run

    # ------------------------------------------------------------------- import

    def import_ad_account(
        self,
        run: BusinessManagerDiscoveryRun,
        external_account_id: str,
        *,
        automatic: bool = False,
        extra_metadata: dict | None = None,
    ) -> AdAccount:
        """Register one observed ad account in the A1 registry.

        Two callers, one path. A person imports one row they are looking at
        (`POST …/discoveries/{run}/imports`); since O3 the discovery sweep also calls this, one
        account at a time inside its own SAVEPOINT, for a connection whose owner set
        `auto_import_enabled` — never for a fake connection, never from a failed run. Discovery
        still never writes the registry by itself: an import is this method, with its own audit
        row, whoever asked. `automatic=True` changes only the provenance row's action
        (`meta_discovery.ad_account_auto_imported`), so the record says the system did it.

        **Coverage and authority are not gates here**, and the asymmetry is the whole point. They
        gate conclusions about *absence*: "this account is gone" only means something against a
        full inventory read by an identity allowed to see it. Presence needs neither — the account
        was returned by Meta, which is evidence it exists, whatever else the run failed to read.
        Requiring complete coverage to import would block the first import of a Business Manager
        whose client edge happens to be refused, for no gain in truth.

        Nothing is fabricated on the way in: readiness and health start at `unknown`, exactly as
        they do for an account an operator types by hand. Having been seen in Meta is not evidence
        of being ready to run.
        """
        canonical = canonical_external_id(external_account_id)
        if not canonical:
            raise ValidationError(
                "An ad account id is required.", details={"field": "external_account_id"}
            )

        observation = self.session.execute(
            sa.select(DiscoveredAdAccountObservation).where(
                DiscoveredAdAccountObservation.business_manager_discovery_run_id == run.id,
                DiscoveredAdAccountObservation.external_account_id == canonical,
            )
        ).scalar_one_or_none()
        if observation is None:
            # Imports are only ever made from something this run actually returned. Accepting an
            # arbitrary id here would turn a read-only feature into a general account-creation
            # endpoint wearing discovery's evidence.
            raise NotFoundError("This ad account was not returned by that discovery run.")

        owner = observation.safe_metadata_json or {}
        obs_currency = (owner.get("currency") or "").strip()[:10] or None
        obs_timezone = (owner.get("timezone_name") or "").strip()[:80] or None
        obs_country = _country_from_timezone(obs_timezone)

        business_manager = self._registry_business_manager(run)
        if business_manager.currency is None and obs_currency:
            business_manager.currency = obs_currency
        if business_manager.country is None and obs_country:
            business_manager.country = obs_country

        registry = AdAccountRegistryService(self.session, self.workspace_id, self.audit)
        account = registry.create(
            {
                "display_name": observation.display_name or canonical,
                "external_account_id": canonical,
                "account_type": AccountType.BUSINESS_MANAGER,
                "business_manager_id": business_manager.id,
                "currency": obs_currency,
                "timezone": obs_timezone,
                "country": obs_country,
            }
        )
        # `registry.create` already writes `ad_account.created`. This second row is the
        # provenance: which run, which identity read it, which edge produced it, and — for a
        # client account, when Meta said — which Business Manager owns it. Written *before* the
        # health evaluation below so the notification planner can already see that this account
        # was imported automatically (O3's `auto_import_grace`).
        owner = observation.safe_metadata_json or {}
        self.audit.record(
            action=(
                "meta_discovery.ad_account_auto_imported"
                if automatic
                else "meta_discovery.ad_account_imported"
            ),
            entity_type="ad_account",
            entity_id=account.id,
            metadata={
                "discovery_run_id": str(run.id),
                "business_manager_reference": run.configured_business_manager_reference,
                "source_edge": observation.source_edge,
                "read_as": run.provider_actor_name,
                "trigger": run.trigger.value,
                "owner_business_reference": owner.get("owner_business_id"),
                "owner_business_name": owner.get("owner_business_name"),
                **(extra_metadata or {}),
            },
        )
        AccountHealthEvaluationService(
            self.session, self.workspace_id, self.audit, self.audit.actor_id
        ).evaluate_account_safe(
            account, trigger=EvaluationTrigger.ACCOUNT_MUTATION, trigger_reference_id=str(run.id)
        )
        return account

    def registry_account_any_state(self, external_account_id: str) -> AdAccount | None:
        """The registry row for this canonical id, **archived or not**.

        `reconcile_ad_accounts` loads only active rows, so an archived account Meta still returns
        shows as `missing_in_registry`. Importing it would hit the uniqueness guard every pass,
        and restoring it would be the system undoing a person's decision (rule 2). The sweep asks
        here first and reports it instead. Matched by exact canonical id only (rule 31): the
        stored value may carry an `act_` prefix or different case, never a different number.
        """
        canonical = canonical_external_id(external_account_id)
        if not canonical:
            return None
        candidates = self.session.execute(
            sa.select(AdAccount).where(
                AdAccount.workspace_id == self.workspace_id,
                sa.func.lower(AdAccount.external_account_id).in_([canonical, f"act_{canonical}"]),
            )
        ).scalars().all()
        for account in candidates:
            if canonical_external_id(account.external_account_id) == canonical:
                return account
        return None

    def _registry_business_manager(self, run: BusinessManagerDiscoveryRun) -> BusinessManager:
        """The registry row for the Business Manager this run read, created if absent.

        Created rather than demanded: the run has already proved this Business Manager exists and
        proved which one the account came from. Making an operator retype an id they cannot get
        wrong is the friction that left the Business Managers page empty while eight accounts sat
        in a discovery result.

        An existing row is reused by external id, so importing a second account does not produce
        a second Business Manager.
        """
        reference = canonical_external_id(run.configured_business_manager_reference)
        if not reference:
            raise ConflictError("This discovery run did not record a Business Manager.")

        existing = self.session.execute(
            sa.select(BusinessManager).where(
                BusinessManager.workspace_id == self.workspace_id,
                BusinessManager.external_id == reference,
            )
        ).scalar_one_or_none()
        if existing is not None:
            require_active(existing, label="Business Manager")
            return existing

        business_manager = BusinessManager(
            workspace_id=self.workspace_id,
            external_id=reference,
            name=run.configured_business_manager_name or reference,
        )
        self.session.add(business_manager)
        self.session.flush()
        self.audit.record(
            action="business_manager.created",
            entity_type="business_manager",
            entity_id=business_manager.id,
            after=snapshot(business_manager),
            metadata={"created_from_discovery_run_id": str(run.id)},
        )
        return business_manager

    # ------------------------------------------------------------- reconciliation

    def reconcile_ad_accounts(self, run: BusinessManagerDiscoveryRun) -> list[ReconciliationRow]:
        """Compare the run's observations with the registry, by exact canonical id only.

        Derived at read time rather than stored: the spec calls a reconciliation result
        rebuildable from observations plus registry state, and something rebuildable is one less
        copy that can go stale against the two sources it summarises.
        """
        observed = {
            observation.external_account_id: observation
            for observation in self.session.execute(
                sa.select(DiscoveredAdAccountObservation).where(
                    DiscoveredAdAccountObservation.business_manager_discovery_run_id == run.id
                )
            ).scalars()
        }
        accounts = (
            self.session.execute(
                sa.select(AdAccount).where(
                    AdAccount.workspace_id == self.workspace_id,
                    AdAccount.archived_at.is_(None),
                )
            )
            .scalars()
            .all()
        )
        configured = canonical_external_id(run.configured_business_manager_reference)
        rows: list[ReconciliationRow] = []
        internal_ids: set[str] = set()

        for account in accounts:
            canonical = canonical_external_id(account.external_account_id)
            if not canonical:
                rows.append(self._row("ad_account", None, account.id, account.display_name, UNKNOWN,
                                      "The internal record has no usable external account id."))
                continue
            internal_ids.add(canonical)

            # Exact identity wins before any scope reasoning: the account was demonstrably
            # returned by this run, so it is present whatever the internal mapping says.
            if canonical in observed:
                rows.append(
                    self._row(
                        "ad_account", canonical, account.id, account.display_name, MATCHED,
                        source_edge=observed[canonical].source_edge,
                    )
                )
                continue

            business_manager = (
                self.session.get(BusinessManager, account.business_manager_id)
                if account.business_manager_id
                else None
            )
            mapped = canonical_external_id(business_manager.external_id) if business_manager else None
            if not mapped:
                rows.append(self._row("ad_account", canonical, account.id, account.display_name, OUT_OF_SCOPE,
                                      "No proven Business Manager mapping for this record."))
                continue
            if mapped != configured:
                rows.append(self._row("ad_account", canonical, account.id, account.display_name, OUT_OF_SCOPE,
                                      "Mapped to a different Business Manager."))
                continue
            if not run.ad_accounts_complete:
                # Absence only means something against a full inventory.
                rows.append(self._row("ad_account", canonical, account.id, account.display_name, UNKNOWN,
                                      f"Coverage was {run.ad_account_coverage_status.value}."))
                continue
            rows.append(
                self._row("ad_account", canonical, account.id, account.display_name, MISSING_FROM_LATEST,
                          "Not returned by the latest completed discovery.")
            )

        for external_id, observation in observed.items():
            if external_id not in internal_ids:
                rows.append(
                    # `detail` used to repeat "Returned by <edge>." Since O1.1 the edge is a
                    # structured field, and a UI reading both printed the same fact twice — once
                    # translated, once raw. One fact, one place: `detail` stays empty here.
                    self._row("ad_account", external_id, None, observation.display_name or "",
                              MISSING_IN_REGISTRY, None,
                              source_edge=observation.source_edge)
                )
        return rows

    def reconcile_pixels(self, run: BusinessManagerDiscoveryRun) -> list[ReconciliationRow]:
        """Deliberately asymmetric, and this is a schema limit rather than a policy choice.

        A registry Pixel has no Business Manager relationship to prove, so its absence from a
        discovery of *this* BM is not evidence of anything: it may simply belong elsewhere.
        Meta → registry still works, because a returned Pixel is a fact about this BM.
        Lifting this needs a Pixel↔BM ownership model, not a foreign key added in passing.
        """
        observed = {
            observation.external_pixel_id: observation
            for observation in self.session.execute(
                sa.select(DiscoveredPixelObservation).where(
                    DiscoveredPixelObservation.business_manager_discovery_run_id == run.id
                )
            ).scalars()
        }
        pixels = (
            self.session.execute(
                sa.select(Pixel).where(
                    Pixel.workspace_id == self.workspace_id, Pixel.archived_at.is_(None)
                )
            )
            .scalars()
            .all()
        )
        rows: list[ReconciliationRow] = []
        internal_ids: set[str] = set()

        for pixel in pixels:
            canonical = canonical_external_id(pixel.external_pixel_id)
            if not canonical:
                rows.append(self._row("pixel", None, pixel.id, pixel.name, UNKNOWN,
                                      "The internal record has no usable external Pixel id."))
                continue
            internal_ids.add(canonical)
            if canonical in observed:
                rows.append(
                    self._row(
                        "pixel", canonical, pixel.id, pixel.name, MATCHED,
                        source_edge=observed[canonical].source_edge,
                    )
                )
                continue
            rows.append(
                self._row("pixel", canonical, pixel.id, pixel.name, OUT_OF_SCOPE,
                          "Pixel Business Manager mapping is not recorded yet, so absence from "
                          "this Business Manager cannot be evaluated.")
            )

        for external_id, observation in observed.items():
            if external_id not in internal_ids:
                rows.append(
                    # `detail` used to repeat "Returned by <edge>." Since O1.1 the edge is a
                    # structured field, and a UI reading both printed the same fact twice — once
                    # translated, once raw. One fact, one place: `detail` stays empty here.
                    self._row("pixel", external_id, None, observation.display_name or "",
                              MISSING_IN_REGISTRY, None,
                              source_edge=observation.source_edge)
                )
        return rows



    # ------------------------------------------------------- F3 business_users
    def reconcile_business_users(self, run: BusinessManagerDiscoveryRun) -> list[dict]:
        """F3. Compare observed `business_users` (`id`, `name`, `role`) with internal Facebook
        profiles (`PersonalAccountReference`) and BM links (`PersonalAccountBusinessLink`).

        Rule 31: Never auto-link by display name. Name or unconfirmed-BM-link matches are returned
        only as `suggested_identity` so the operator can confirm with 1 click.
        """
        observations = list(
            self.session.execute(
                sa.select(DiscoveredBusinessUserObservation)
                .where(
                    DiscoveredBusinessUserObservation.business_manager_discovery_run_id == run.id
                )
                .order_by(
                    DiscoveredBusinessUserObservation.display_name.asc().nulls_last(),
                    DiscoveredBusinessUserObservation.external_user_id.asc(),
                )
            ).scalars()
        )
        observed_by_id = {obs.external_user_id: obs for obs in observations}

        configured = canonical_external_id(run.configured_business_manager_reference)
        bm = (
            self.session.execute(
                sa.select(BusinessManager).where(
                    BusinessManager.workspace_id == self.workspace_id,
                    BusinessManager.external_id == configured,
                    BusinessManager.archived_at.is_(None),
                )
            ).scalar_one_or_none()
            if configured
            else None
        )

        bm_links: list[PersonalAccountBusinessLink] = []
        if bm is not None:
            bm_links = list(
                self.session.execute(
                    sa.select(PersonalAccountBusinessLink).where(
                        PersonalAccountBusinessLink.workspace_id == self.workspace_id,
                        PersonalAccountBusinessLink.business_manager_id == bm.id,
                        PersonalAccountBusinessLink.unlinked_at.is_(None),
                    )
                ).scalars()
            )

        identities = {
            row.id: row
            for row in self.session.execute(
                sa.select(PersonalAccountReference).where(
                    PersonalAccountReference.workspace_id == self.workspace_id,
                    PersonalAccountReference.archived_at.is_(None),
                )
            ).scalars()
        }
        member_ids = [i.owner_member_id for i in identities.values() if i.owner_member_id]
        member_names: dict[uuid.UUID, str] = {}
        if member_ids:
            for member_id, full_name, email in self.session.execute(
                sa.select(WorkspaceMember.id, User.full_name, User.email)
                .join(User, User.id == WorkspaceMember.user_id)
                .where(
                    WorkspaceMember.workspace_id == self.workspace_id,
                    WorkspaceMember.id.in_(member_ids),
                )
            ).all():
                member_names[member_id] = full_name or email

        links_by_ext_user_id = {
            link.external_business_user_id: link
            for link in bm_links
            if link.external_business_user_id and link.personal_account_reference_id in identities
        }
        already_confirmed_identity_ids = {
            link.personal_account_reference_id for link in links_by_ext_user_id.values()
        }
        unconfirmed_bm_links = [
            link
            for link in bm_links
            if not link.external_business_user_id
            and link.personal_account_reference_id in identities
        ]

        rows: list[dict] = []
        for obs in observations:
            obs_role = (obs.role or "UNKNOWN").upper()
            link = links_by_ext_user_id.get(obs.external_user_id)
            if link is not None:
                identity = identities[link.personal_account_reference_id]
                demoted = link.role == IdentityBusinessRole.ADMIN and obs_role != "ADMIN"
                rows.append(
                    {
                        "external_user_id": obs.external_user_id,
                        "display_name": obs.display_name or "",
                        "role": obs_role,
                        "status": "admin_demoted" if demoted else "linked",
                        "is_admin_drift": demoted,
                        "source_edge": obs.source_edge,
                        "detail": (
                            f"Hồ sơ nội bộ ghi nhận quyền ADMIN nhưng Meta trả về quyền {obs_role}."
                            if demoted
                            else "Đã xác nhận nối với hồ sơ Facebook nội bộ."
                        ),
                        "linked_identity": {
                            "id": str(identity.id),
                            "label": identity.label,
                            "owner_member_name": member_names.get(identity.owner_member_id),
                            "two_factor_method": identity.two_factor_method.value,
                            "link_id": str(link.id),
                            "recorded_role": link.role.value,
                        },
                        "suggested_identity": None,
                    }
                )
                continue

            suggested: dict | None = None
            obs_name_norm = (obs.display_name or "").strip().lower()
            if obs_name_norm:
                for cand in identities.values():
                    if cand.id in already_confirmed_identity_ids:
                        continue
                    cand_label = (cand.label or "").strip().lower()
                    cand_display = (cand.display_name or "").strip().lower()
                    cand_holder = (member_names.get(cand.owner_member_id) or "").strip().lower()
                    if obs_name_norm in {cand_label, cand_display, cand_holder} - {""}:
                        suggested = {
                            "id": str(cand.id),
                            "label": cand.label,
                            "owner_member_name": member_names.get(cand.owner_member_id),
                            "match_reason": "name_match",
                        }
                        break
            if suggested is None and len(unconfirmed_bm_links) == 1:
                only_link = unconfirmed_bm_links[0]
                cand = identities[only_link.personal_account_reference_id]
                if cand.id not in already_confirmed_identity_ids:
                    suggested = {
                        "id": str(cand.id),
                        "label": cand.label,
                        "owner_member_name": member_names.get(cand.owner_member_id),
                        "match_reason": "existing_bm_link",
                    }

            rows.append(
                {
                    "external_user_id": obs.external_user_id,
                    "display_name": obs.display_name or "",
                    "role": obs_role,
                    "status": "unlinked",
                    "is_admin_drift": obs_role == "ADMIN",
                    "source_edge": obs.source_edge,
                    "detail": "Chưa xác nhận nối với hồ sơ Facebook nội bộ.",
                    "linked_identity": None,
                    "suggested_identity": suggested,
                }
            )

        if run.business_users_complete:
            reported_missing: set[str] = set()
            for link in bm_links:
                if (
                    link.role == IdentityBusinessRole.ADMIN
                    and link.external_business_user_id
                    and link.external_business_user_id not in observed_by_id
                    and link.personal_account_reference_id in identities
                ):
                    identity = identities[link.personal_account_reference_id]
                    reported_missing.add(link.external_business_user_id)
                    rows.append(
                        {
                            "external_user_id": link.external_business_user_id,
                            "display_name": identity.label,
                            "role": "ADMIN",
                            "status": "missing_from_latest_discovery",
                            "is_admin_drift": True,
                            "source_edge": "business_users",
                            "detail": "Quản trị viên (ADMIN) đã xác nhận nối nhưng không còn trong lần quét đầy đủ mới nhất.",
                            "linked_identity": {
                                "id": str(identity.id),
                                "label": identity.label,
                                "owner_member_name": member_names.get(identity.owner_member_id),
                                "two_factor_method": identity.two_factor_method.value,
                                "link_id": str(link.id),
                                "recorded_role": link.role.value,
                            },
                            "suggested_identity": None,
                        }
                    )

            prev_complete_run_id = self.session.execute(
                sa.select(BusinessManagerDiscoveryRun.id)
                .where(
                    BusinessManagerDiscoveryRun.workspace_id == self.workspace_id,
                    BusinessManagerDiscoveryRun.meta_connection_id == run.meta_connection_id,
                    BusinessManagerDiscoveryRun.id != run.id,
                    BusinessManagerDiscoveryRun.archived_at.is_(None),
                    BusinessManagerDiscoveryRun.business_user_coverage_status
                    == CoverageStatus.COMPLETE,
                )
                .order_by(BusinessManagerDiscoveryRun.started_at.desc())
                .limit(1)
            ).scalar_one_or_none()
            if prev_complete_run_id is not None:
                prev_admins = list(
                    self.session.execute(
                        sa.select(DiscoveredBusinessUserObservation).where(
                            DiscoveredBusinessUserObservation.business_manager_discovery_run_id
                            == prev_complete_run_id,
                            sa.func.upper(DiscoveredBusinessUserObservation.role) == "ADMIN",
                        )
                    ).scalars()
                )
                for prev_admin in prev_admins:
                    if prev_admin.external_user_id in reported_missing:
                        continue
                    curr = observed_by_id.get(prev_admin.external_user_id)
                    if curr is None:
                        reported_missing.add(prev_admin.external_user_id)
                        rows.append(
                            {
                                "external_user_id": prev_admin.external_user_id,
                                "display_name": prev_admin.display_name or "",
                                "role": "ADMIN",
                                "status": "missing_from_latest_discovery",
                                "is_admin_drift": True,
                                "source_edge": prev_admin.source_edge,
                                "detail": "Quản trị viên (ADMIN) có mặt ở lần quét đầy đủ trước nhưng không còn trong lần quét này.",
                                "linked_identity": None,
                                "suggested_identity": None,
                            }
                        )
                    elif (curr.role or "").upper() != "ADMIN":
                        for r in rows:
                            if r["external_user_id"] == prev_admin.external_user_id:
                                r["status"] = "admin_demoted"
                                r["is_admin_drift"] = True
                                r["detail"] = (
                                    f"Tài khoản từng giữ quyền ADMIN ở lần quét trước nhưng hiện tại là {(curr.role or 'UNKNOWN').upper()}."
                                )
        return rows


    def confirm_business_user_link(
        self,
        run: BusinessManagerDiscoveryRun,
        *,
        external_user_id: str,
        personal_account_reference_id: uuid.UUID,
        role: IdentityBusinessRole | None = None,
        actor_id: uuid.UUID | None = None,
    ) -> dict:
        """F3. Operator-confirmed link between an observed Meta `business_user` and an internal
        `PersonalAccountReference`. Never triggered automatically (Rule 31)."""
        canonical_user = canonical_external_id(external_user_id) or external_user_id.strip()
        if not canonical_user:
            raise ValidationError(
                "external_user_id is required.", details={"field": "external_user_id"}
            )
        observation = self.session.execute(
            sa.select(DiscoveredBusinessUserObservation).where(
                DiscoveredBusinessUserObservation.business_manager_discovery_run_id == run.id,
                DiscoveredBusinessUserObservation.external_user_id == canonical_user,
            )
        ).scalar_one_or_none()
        if observation is None:
            raise NotFoundError("This business_user was not returned by the selected discovery run.")

        identity = get_or_404(
            self.session,
            PersonalAccountReference,
            personal_account_reference_id,
            self.workspace_id,
            label="Facebook account",
        )
        require_active(identity, label="Facebook account")
        bm = self._registry_business_manager(run)

        obs_role_upper = (observation.role or "").strip().upper()
        if role is not None:
            resolved_role = role
        elif obs_role_upper == "ADMIN":
            resolved_role = IdentityBusinessRole.ADMIN
        elif obs_role_upper in {"EMPLOYEE", "FINANCE_ANALYST", "FINANCE_EDITOR"}:
            resolved_role = IdentityBusinessRole.EMPLOYEE
        else:
            resolved_role = IdentityBusinessRole.UNKNOWN

        conflicting = self.session.execute(
            sa.select(PersonalAccountBusinessLink).where(
                PersonalAccountBusinessLink.workspace_id == self.workspace_id,
                PersonalAccountBusinessLink.business_manager_id == bm.id,
                PersonalAccountBusinessLink.external_business_user_id == canonical_user,
                PersonalAccountBusinessLink.personal_account_reference_id != identity.id,
                PersonalAccountBusinessLink.unlinked_at.is_(None),
            )
        ).scalar_one_or_none()
        if conflicting is not None:
            raise ConflictError(
                "This Business Manager user is already linked to another Facebook account profile."
            )

        existing = self.session.execute(
            sa.select(PersonalAccountBusinessLink).where(
                PersonalAccountBusinessLink.workspace_id == self.workspace_id,
                PersonalAccountBusinessLink.business_manager_id == bm.id,
                PersonalAccountBusinessLink.personal_account_reference_id == identity.id,
                PersonalAccountBusinessLink.unlinked_at.is_(None),
            )
        ).scalar_one_or_none()
        now = datetime.now(UTC)
        if existing is not None:
            existing.external_business_user_id = canonical_user
            existing.role = resolved_role
            link = existing
        else:
            link = PersonalAccountBusinessLink(
                workspace_id=self.workspace_id,
                personal_account_reference_id=identity.id,
                business_manager_id=bm.id,
                role=resolved_role,
                note=f"Confirmed from discovery run {run.id}",
                external_business_user_id=canonical_user,
                linked_at=now,
                linked_by=actor_id,
            )
            self.session.add(link)
        self.session.flush()
        self.audit.record(
            action="personal_account_reference.business_user_confirmed",
            entity_type="personal_account_reference",
            entity_id=identity.id,
            after={
                "link_id": str(link.id),
                "business_manager_id": str(bm.id),
                "external_business_user_id": canonical_user,
                "role": resolved_role.value,
                "discovery_run_id": str(run.id),
            },
        )
        return {
            "link_id": str(link.id),
            "business_manager_id": str(bm.id),
            "personal_account_reference_id": str(identity.id),
            "personal_account_label": identity.label,
            "external_business_user_id": canonical_user,
            "role": resolved_role.value,
        }

    def evaluate_business_user_drift_alert(
        self, run: BusinessManagerDiscoveryRun, connection: MetaConnection
    ) -> Alert | None:
        """F3. Early-warning alert when a Business Manager has an unlinked user ("người lạ vào BM")
        or a removed/demoted Admin ("admin bị gỡ"). Auto-resolves when all observed users are
        confirmed and no Admin access drift remains."""
        if run.status not in {
            DiscoveryRunStatus.SUCCEEDED,
            DiscoveryRunStatus.SUCCEEDED_WITH_WARNINGS,
        }:
            return None
        if run.business_user_coverage_status == CoverageStatus.NOT_ATTEMPTED:
            return None

        rows = self.reconcile_business_users(run)
        unlinked_users = [r for r in rows if r["status"] == "unlinked"]
        removed_admins = [
            r
            for r in rows
            if r["status"] in {"missing_from_latest_discovery", "admin_demoted"}
        ]

        bm_ref = (
            canonical_external_id(run.configured_business_manager_reference)
            or (run.configured_business_manager_reference or "").strip()
            or str(connection.id)
        )
        alert_key = f"bm_user_drift:{connection.id}:{bm_ref}"
        existing = self.session.execute(
            sa.select(Alert).where(
                Alert.workspace_id == self.workspace_id,
                Alert.active_key == alert_key,
                Alert.status.in_(list(ACTIVE_ALERT_STATUSES)),
            )
        ).scalar_one_or_none()

        now = datetime.now(UTC)
        if not unlinked_users and not removed_admins:
            if existing is not None and run.business_users_complete:
                before = snapshot(existing)
                existing.status = AlertStatus.RESOLVED
                existing.active_key = None
                existing.resolved_at = now
                existing.resolved_by = None
                existing.resolution_reason = (
                    "All observed Business Manager users are linked and no Admin drift remains."
                )
                self.session.flush()
                self.audit.record(
                    action="alert.auto_resolved",
                    entity_type="alert",
                    entity_id=existing.id,
                    before=before,
                    after=snapshot(existing),
                )
            return existing

        has_admin_drift = bool(removed_admins) or any(
            (u.get("role") or "").upper() == "ADMIN" for u in unlinked_users
        )
        severity = AlertSeverity.CRITICAL if has_admin_drift else AlertSeverity.WARNING
        bm_label = run.configured_business_manager_name or bm_ref
        title = f"Cảnh báo quyền truy cập BM — {bm_label}"[:200]

        parts: list[str] = []
        if unlinked_users:
            names = ", ".join(
                f"{u['display_name'] or u['external_user_id']} ({u['external_user_id']}, quyền {u['role']})"
                for u in unlinked_users[:5]
            )
            parts.append(f"Người chưa xác nhận trong BM ({len(unlinked_users)}): {names}.")
        if removed_admins:
            names = ", ".join(
                f"{a['display_name'] or a['external_user_id']} ({a['external_user_id']})"
                for a in removed_admins[:5]
            )
            parts.append(f"Quản trị viên bị gỡ hoặc hạ quyền ({len(removed_admins)}): {names}.")
        summary = " ".join(parts)

        snapshot_payload = redact(
            {
                "rule_key": "bm_user_access_drift",
                "meta_connection_id": str(connection.id),
                "connection_label": connection.label,
                "discovery_run_id": str(run.id),
                "business_manager_reference": bm_ref,
                "business_manager_name": run.configured_business_manager_name,
                "unlinked_users": [
                    {
                        "external_user_id": u["external_user_id"],
                        "display_name": u["display_name"],
                        "role": u["role"],
                    }
                    for u in unlinked_users[:10]
                ],
                "removed_admins": [
                    {
                        "external_user_id": a["external_user_id"],
                        "display_name": a["display_name"],
                        "role": a["role"],
                        "status": a["status"],
                    }
                    for a in removed_admins[:10]
                ],
                "recommended_next_step": (
                    "Kiểm tra ngay mục Người trong BM trên hệ thống và Business Settings trên Meta: "
                    "gỡ tài khoản lạ hoặc bấm Xác nhận nối nếu là nhân sự nội bộ."
                ),
            }
        )

        policy = AlertPolicyService(self.session, self.workspace_id, self.audit).get_or_create()
        planner = NotificationPlannerService(self.session, self.workspace_id, self.audit)

        if existing is None:
            alert = Alert(
                workspace_id=self.workspace_id,
                ad_account_id=None,
                source_type=AlertSourceType.DISCOVERY_SWEEP,
                source_entity_type="business_manager_user_drift",
                source_entity_id=str(run.id),
                alert_key=alert_key,
                active_key=alert_key,
                category="bm_access",
                severity=severity,
                status=AlertStatus.OPEN,
                title=title,
                summary=summary,
                source_snapshot_json=snapshot_payload,
                first_observed_at=run.completed_at or now,
                last_observed_at=now,
            )
            self.session.add(alert)
            self.session.flush()
            self.audit.record(
                action="alert.created",
                entity_type="alert",
                entity_id=alert.id,
                after=snapshot(alert),
                metadata={"source_type": alert.source_type.value, "severity": alert.severity.value},
            )
            planner.plan(alert, policy, None, reason=DeliveryReason.INITIAL)
            return alert

        escalated = severity == AlertSeverity.CRITICAL and existing.severity != AlertSeverity.CRITICAL
        existing.title = title
        existing.summary = summary
        existing.source_entity_id = str(run.id)
        existing.source_snapshot_json = snapshot_payload
        existing.last_observed_at = now
        if escalated:
            existing.severity = AlertSeverity.CRITICAL
        self.session.flush()
        if escalated:
            planner.plan(existing, policy, None, reason=DeliveryReason.ESCALATED)
        return existing

    @staticmethod
    def _row(
        asset_type: str,
        external_id: str | None,
        internal_entity_id: uuid.UUID | None,
        display_name: str,
        status: AssetReconciliationStatus,
        detail: str | None = None,
        source_edge: str | None = None,
    ) -> ReconciliationRow:
        return ReconciliationRow(
            asset_type=asset_type,
            external_id=external_id,
            internal_entity_id=internal_entity_id,
            display_name=display_name,
            status=status,
            detail=detail,
            source_edge=source_edge,
        )

    # ------------------------------------------------------------------ internals

    def _finish(
        self,
        run: BusinessManagerDiscoveryRun,
        *,
        status: DiscoveryRunStatus,
        failure_code: MetaFailureCode | None = None,
        failure_summary: str | None = None,
        action: str = "meta_discovery.business_manager_validated",
    ) -> None:
        run.status = status
        run.failure_code = failure_code.value if failure_code else None
        run.failure_summary = failure_summary
        run.completed_at = datetime.now(UTC)
        self.session.flush()
        self.audit.record(
            action=action,
            entity_type="business_manager_discovery_run",
            entity_id=run.id,
            after={
                "status": run.status.value,
                "business_manager_reference": run.configured_business_manager_reference,
                "business_manager_name": run.configured_business_manager_name,
                "failure_code": run.failure_code,
                "environment": run.provider_environment.value,
            },
        )
