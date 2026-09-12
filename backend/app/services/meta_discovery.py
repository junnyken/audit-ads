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
    AccountType,
    AssetReconciliationStatus,
    BusinessAuthority,
    DiscoveryRunStatus,
    DiscoveryTrigger,
    EvaluationTrigger,
)
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.models.entities import AdAccount, BusinessManager, Pixel
from app.models.meta_discovery import (
    BusinessManagerDiscoveryRun,
    DiscoveredAdAccountObservation,
    DiscoveredPixelObservation,
)
from app.models.meta_operations import MetaConnection
from app.services.audit import AuditLogService
from app.services.base import require_active, snapshot
from app.services.extension_context import canonical_external_id
from app.services.health_service import AccountHealthEvaluationService
from app.services.meta_provider import AssetDiscovery, MetaBusinessProvider, MetaFailureCode
from app.services.registry import AdAccountRegistryService

#: Local aliases, purely so the decision trees below read as the rules they implement.
MATCHED = AssetReconciliationStatus.MATCHED
MISSING_IN_REGISTRY = AssetReconciliationStatus.MISSING_IN_REGISTRY
MISSING_FROM_LATEST = AssetReconciliationStatus.MISSING_FROM_LATEST_DISCOVERY
OUT_OF_SCOPE = AssetReconciliationStatus.OUT_OF_SCOPE
UNKNOWN = AssetReconciliationStatus.UNKNOWN


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

        # `succeeded` is reserved for a run that saw everything it was required to see. Anything
        # less is reported as such, however clean the individual requests looked.
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
        self, run: BusinessManagerDiscoveryRun, external_account_id: str
    ) -> AdAccount:
        """Register one observed ad account in the A1 registry, on an explicit request.

        One row at a time, never automatic. Discovery reads Meta; the registry is what this
        workspace has decided to track and is answerable for. Collapsing the two would turn every
        scan into a silent writer, and A10.1 deliberately shipped with no such path.

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

        business_manager = self._registry_business_manager(run)
        registry = AdAccountRegistryService(self.session, self.workspace_id, self.audit)
        account = registry.create(
            {
                "display_name": observation.display_name or canonical,
                "external_account_id": canonical,
                "account_type": AccountType.BUSINESS_MANAGER,
                "business_manager_id": business_manager.id,
            }
        )
        AccountHealthEvaluationService(
            self.session, self.workspace_id, self.audit, self.audit.actor_id
        ).evaluate_account_safe(
            account, trigger=EvaluationTrigger.ACCOUNT_MUTATION, trigger_reference_id=str(run.id)
        )
        # `registry.create` already writes `ad_account.created`. This second row is the
        # provenance: which run, which identity read it, and which edge produced it — the facts
        # that answer "where did this record come from" a month from now.
        self.audit.record(
            action="meta_discovery.ad_account_imported",
            entity_type="ad_account",
            entity_id=account.id,
            metadata={
                "discovery_run_id": str(run.id),
                "business_manager_reference": run.configured_business_manager_reference,
                "source_edge": observation.source_edge,
                "read_as": run.provider_actor_name,
            },
        )
        return account

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
                rows.append(self._row("ad_account", canonical, account.id, account.display_name, MATCHED))
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
                    self._row("ad_account", external_id, None, observation.display_name or "",
                              MISSING_IN_REGISTRY, f"Returned by {observation.source_edge}.")
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
                rows.append(self._row("pixel", canonical, pixel.id, pixel.name, MATCHED))
                continue
            rows.append(
                self._row("pixel", canonical, pixel.id, pixel.name, OUT_OF_SCOPE,
                          "Pixel Business Manager mapping is not recorded yet, so absence from "
                          "this Business Manager cannot be evaluated.")
            )

        for external_id, observation in observed.items():
            if external_id not in internal_ids:
                rows.append(
                    self._row("pixel", external_id, None, observation.display_name or "",
                              MISSING_IN_REGISTRY, f"Returned by {observation.source_edge}.")
                )
        return rows

    @staticmethod
    def _row(
        asset_type: str,
        external_id: str | None,
        internal_entity_id: uuid.UUID | None,
        display_name: str,
        status: AssetReconciliationStatus,
        detail: str | None = None,
    ) -> ReconciliationRow:
        return ReconciliationRow(
            asset_type=asset_type,
            external_id=external_id,
            internal_entity_id=internal_entity_id,
            display_name=display_name,
            status=status,
            detail=detail,
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
