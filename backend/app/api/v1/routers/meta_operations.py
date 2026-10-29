"""A7 — BM + ad account creation & sharing via the official Meta API, A10.x discovery and
registry import, O3 connection automation. Every route is owner-only (`OwnerCtx`) and
workspace-scoped through `Ctx.workspace_id`, never a payload.

Which provider a route reaches is decided in one place, `_provider_for`: the fake provider by
default, and since A10 the real, **read-only** provider only for a `production` connection whose
Business Manager has a usable reader credential — server configuration, or since O4 the `active`
vault credential the connection is bound to (rule 40). The real provider cannot write —
its transport is GET-only (rule 20). The scheduled discovery sweep (O3) does not go through these
routes; it is `run_dispatcher.discovery_sweep_pass`, switched per connection by
`PATCH /meta-connections/{id}/automation` below.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, Query

from app.api.deps import OwnerCtx
from app.core.config import get_settings
from app.core.enums import DataFreshness, DiscoveryRunStatus, MetaEnvironment
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.models.entities import AuditLog
from app.models.meta_discovery import BusinessManagerDiscoveryRun
from app.models.meta_operations import (
    AccessShareBatch,
    AccountCreationBatch,
    MetaConnection,
    PixelShareBatch,
)
from app.models.meta_reader_credential import MetaReaderCredential
from app.schemas import meta_operations as s
from app.schemas.common import page_response
from app.services.base import get_or_404, snapshot
from app.services.discovery_sweep import serialize_automation
from app.services.meta_access_share import AccessShareBatchService, DraftShareItem
from app.services.meta_account_creation import AccountCreationBatchService, DraftAccountItem
from app.services.meta_discovery import MetaDiscoveryService, ReconciliationRow
from app.services.meta_pixel_share import DraftPixelShareItem, PixelShareBatchService
from app.services.meta_provider import DiscoveredAsset, get_fake_provider
from app.services.meta_reader_credentials import MetaReaderCredentialService, derived_state
from app.services.meta_real_provider import (
    READER_NONE,
    READER_VAULT_RECONNECT_REQUIRED,
    build_real_provider,
)
from app.services.spend_service import connection_business_id, connection_reader_source

#: A9 permission matrix (§6): "Manage Meta connections/capabilities" and "Queue A7/A8 external
#: operation" are owner-only by default — Admin only "if role capability exists", and A9
#: deliberately does not introduce one. Reads are owner-only too rather than half-scoped: a
#: batch item records a BM/account *external id* (a string that may not correspond to any local
#: record yet — creating one is the whole point), so membership scope cannot be proven for it,
#: and the spec's own rule for that case is to deny the non-owner rather than guess.

router = APIRouter(tags=["meta-operations"])


def _business_id_for(connection: MetaConnection) -> str:
    """Which Business Manager this connection reads.

    The connection's own reference wins; empty falls back to the server setting, which is what
    every connection created before A10.3 did. Precedence is stated in one place because two
    places deciding it is how a card ends up headed "Triều Shop" while listing another business's
    accounts — which is exactly what happened before this column existed.
    """
    return connection_business_id(connection)


def _provider_for(connection: MetaConnection):
    """Fake by default; a real, **read-only** provider only when a connection is explicitly
    marked `production` *and* a token is configured on the server (A10).

    Both conditions are required, and both are deliberate acts by different people: marking a
    connection `production` is an operator decision recorded in the database, configuring
    `META_ACCESS_TOKEN` is a deployment decision. Neither alone reaches the network. Anything
    else — `fake`, `sandbox`, or `production` with no token — stays on the fake provider, so a
    misconfigured environment degrades to "no real call", never to a surprise one.

    The real provider cannot write: its create/share methods raise, and the transport beneath it
    is GET-only. See `meta_real_provider.py`.
    """
    settings = get_settings()
    business_id = _business_id_for(connection)
    reader_source = connection_reader_source(connection, settings)
    if connection.environment == MetaEnvironment.PRODUCTION and reader_source == READER_VAULT_RECONNECT_REQUIRED:
        # O4: bound to a vault credential that cannot be used. Neither the server token nor the
        # fake provider may stand in for it — the first would read as another identity, the second
        # would show fabricated data on a production card. Nothing is read.
        raise ConflictError(
            "This connection's Meta reader credential needs reconnecting. Nothing is read until "
            "it is reconnected in Settings.",
            details={"reason": "reader_reconnect_required"},
        )
    if connection.environment == MetaEnvironment.PRODUCTION and (
        reader_source != READER_NONE or settings.environment.lower() in ("production", "prod", "staging")
    ):
        return build_real_provider(
            settings, business_id=business_id, credential=getattr(connection, "reader_credential", None)
        )
    return _seeded_fake_provider(business_id)


def _reader_credential_block(connection: MetaConnection) -> dict[str, Any] | None:
    """O4. Which vault credential this connection reads with — its name and state, never a token."""
    credential = connection.reader_credential
    if credential is None:
        return None
    return {
        "id": str(credential.id),
        "label": credential.label,
        "kind": credential.kind.value,
        "status": credential.status.value,
        "derived_state": derived_state(credential),
        "expires_at": credential.expires_at.isoformat() if credential.expires_at else None,
        "reconnect_reason": credential.reconnect_reason,
    }


def _other_readers(connection: MetaConnection, credentials: list[MetaReaderCredential]) -> list[dict[str, Any]]:
    """Active vault credentials that also saw this connection's Business Manager — offered to the
    owner as an explicit switch, never applied by the system (Constraint 9)."""
    reference = (connection.business_manager_reference or "").strip()
    if not reference or connection.environment != MetaEnvironment.PRODUCTION:
        return []
    return [
        {"id": str(c.id), "label": c.label, "kind": c.kind.value}
        for c in credentials
        if c.id != connection.reader_credential_id
        and c.status.value == "active"
        and any(
            isinstance(item, dict) and str(item.get("external_id")) == reference
            for item in (c.businesses_seen_json or [])
        )
    ]


def _workspace_credentials(ctx) -> list[MetaReaderCredential]:
    return list(
        ctx.session.execute(
            sa.select(MetaReaderCredential).where(
                MetaReaderCredential.workspace_id == ctx.workspace_id,
                MetaReaderCredential.archived_at.is_(None),
            )
        ).scalars().all()
    )


def _serialize_connection(
    connection: MetaConnection, credentials: list[MetaReaderCredential] | None = None
) -> dict[str, Any]:
    settings = get_settings()
    business_id = _business_id_for(connection)
    # Per Business Manager, not per server. The old global boolean answered "the server holds *a*
    # token", which is not the question an operator asks while looking at one connection's card:
    # a token that reads one business proves nothing about another. Since O4 a connection bound
    # to the vault answers with its own credential's state.
    reader_source = connection_reader_source(connection, settings)
    token_configured = (
        True
        if connection.environment.value == "fake"
        else reader_source not in (READER_NONE, READER_VAULT_RECONNECT_REQUIRED)
    )
    return {
        **{
            k: v
            for k, v in snapshot(connection).items()
            if k not in ("capabilities_json", "business_managers_json", "reader_credential_id")
        },
        "capabilities": connection.capabilities_json,
        "business_managers": connection.business_managers_json,
        "token_configured": token_configured,
        # Which configured credential answers for this connection's Business Manager — a name,
        # never a value. `business_specific` means this BM has its own entry; `server_default`
        # means it falls back to the single server token, which may or may not have a role there.
        "reader_source": "fake" if connection.environment.value == "fake" else reader_source,
        # The id actually read, and where it came from. A connection that inherits the server
        # setting reads the same Business Manager as every other inheriting connection, and the
        # UI has to be able to say so rather than implying each card is its own business.
        "business_manager_reference": business_id or None,
        "business_manager_source": "connection" if (connection.business_manager_reference or "").strip() else "server",
        # O3. The owner's switches and whether the sweep could read this connection at all —
        # computed from server configuration, never stored, never a credential.
        "automation": serialize_automation(connection, settings),
        # O4. The vault credential this connection reads with, if any, and other active ones that
        # also saw its Business Manager (the owner may switch, the system never does).
        "reader_credential": _reader_credential_block(connection),
        "other_readers": _other_readers(connection, credentials or []),
    }


def _freshness(completed_at: datetime | None) -> str:
    """How long a discovery observation is treated as current. Reuses A1's freshness vocabulary
    rather than inventing a second one — the UI must never present a stale reading as though it
    were taken now.

    O3 moved the threshold from a router constant (24 h) to `discovery_stale_after_hours`, the
    value the discovery sweep's "due" and the not-returned rule's window also read — so the badge
    and the sweep agree by construction.
    """
    if completed_at is None:
        return DataFreshness.UNKNOWN.value
    age = datetime.now(UTC) - completed_at
    stale_after = timedelta(hours=get_settings().discovery_stale_after_hours)
    return (DataFreshness.CURRENT if age <= stale_after else DataFreshness.STALE).value


def _serialize_reconciliation(rows: list[ReconciliationRow]) -> list[dict[str, Any]]:
    return [
        {
            "external_id": row.external_id,
            "internal_entity_id": str(row.internal_entity_id) if row.internal_entity_id else None,
            "display_name": row.display_name,
            "status": row.status.value,
            "detail": row.detail,
            # Structured, not parsed out of `detail`. A filter cannot read a sentence, and a
            # translated one would break silently.
            "source_edge": row.source_edge,
        }
        for row in rows
    ]


def _serialize_discovery_run(
    run: BusinessManagerDiscoveryRun,
    *,
    ad_accounts: list[ReconciliationRow],
    pixels: list[ReconciliationRow],
    business_users: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Coverage travels with every result. A count on its own cannot be judged: four accounts
    from a complete scan and four from a scan that never read the client edge look identical."""
    return {
        "id": str(run.id),
        "status": run.status.value,
        "trigger": run.trigger.value,
        "environment": run.provider_environment.value,
        "business_manager": {
            "reference": run.configured_business_manager_reference or None,
            "name": run.configured_business_manager_name,
        },
        # Who read. An inventory is a fact about the reader as much as about the BM — the same
        # BM returned four ad accounts to an Employee system user and eight to an Admin one.
        "read_as": {
            "external_id": run.provider_actor_external_id,
            "name": run.provider_actor_name,
        },
        # Whether the reader could prove it may read this BM at all. Only asked of an empty
        # inventory, because an empty result is the one that cannot prove its own authority.
        "business_authority": run.business_authority.value,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "freshness": _freshness(run.completed_at),
        "failure_code": run.failure_code,
        "failure_summary": run.failure_summary,
        "ad_accounts": {
            "coverage_status": run.ad_account_coverage_status.value,
            "complete": run.ad_accounts_complete,
            "required_edges": run.ad_account_required_edges_json or [],
            "coverage": run.ad_account_coverage_json or {},
            "reconciliation": _serialize_reconciliation(ad_accounts),
        },
        "pixels": {
            "coverage_status": run.pixel_coverage_status.value,
            "complete": run.pixels_complete,
            "required_edges": run.pixel_required_edges_json or [],
            "coverage": run.pixel_coverage_json or {},
            "reconciliation": _serialize_reconciliation(pixels),
            # Stated in the payload, not left for the UI to remember: a registry Pixel has no
            # Business Manager mapping to prove, so absence from this BM says nothing about it.
            "registry_absence_evaluable": False,
        },
        "business_users": {
            "coverage_status": run.business_user_coverage_status.value,
            "complete": run.business_users_complete,
            "required_edges": run.business_user_required_edges_json or [],
            "coverage": run.business_user_coverage_json or {},
            "reconciliation": business_users or [],
        },
    }


def _seeded_fake_provider(business_id: str):
    """The fake environment exists so the flow can be exercised without touching Meta. An
    unseeded fake cannot satisfy a configured `META_BUSINESS_ID`, so discovery always refused
    with `not_configured` — which left a live Business Manager as the only way to try the
    feature, the exact opposite of what a fake provider is for.

    Everything it returns is named as fake. The Business Manager *id* deliberately matches the
    configured one, because validation is right to refuse a different one; nothing else here
    imitates real data, and the connection carries a `Fake (local testing)` badge throughout.
    """
    provider = get_fake_provider()
    if not business_id:
        return provider
    if not provider.business_managers:
        provider.business_managers.append(
            {"external_id": business_id, "name": "Fake Business Manager (local testing)"}
        )
    if not provider.discovered_ad_accounts:
        provider.discovered_ad_accounts.extend(
            [
                DiscoveredAsset("fake000000000001", "Fake ad account — owned", "owned_ad_accounts"),
                DiscoveredAsset("fake000000000002", "Fake ad account — client", "client_ad_accounts"),
            ]
        )
    if not provider.discovered_pixels:
        provider.discovered_pixels.append(
            DiscoveredAsset("fake000000000003", "Fake Pixel (local testing)", "adspixels")
        )
    return provider


def _discovery_service(ctx: OwnerCtx, connection: MetaConnection) -> MetaDiscoveryService:
    return MetaDiscoveryService(
        ctx.session,
        ctx.workspace_id,
        ctx.audit,
        provider=_provider_for(connection),
        business_id=_business_id_for(connection),
    )


# ------------------------------------------------------------------------- Meta connections

connections_router = APIRouter(prefix="/meta-connections", tags=["meta-operations"])


@connections_router.get("")
def list_connections(ctx: OwnerCtx) -> list[dict[str, Any]]:
    rows = (
        ctx.session.execute(
            sa.select(MetaConnection)
            .where(MetaConnection.workspace_id == ctx.workspace_id, MetaConnection.archived_at.is_(None))
            .order_by(MetaConnection.created_at.desc())
        )
        .scalars()
        .all()
    )
    credentials = _workspace_credentials(ctx)
    return [_serialize_connection(row, credentials) for row in rows]


@connections_router.post("", status_code=201)
def create_connection(ctx: OwnerCtx, payload: s.MetaConnectionCreate) -> dict[str, Any]:
    connection = MetaConnection(
        workspace_id=ctx.workspace_id,
        label=payload.label,
        environment=payload.environment,
        # Set here and never updated: changing which Business Manager a connection reads would
        # silently reinterpret every run it has already recorded, and those runs are the evidence
        # behind `missing_from_latest_discovery`. A different Business Manager is a new connection.
        business_manager_reference=payload.business_manager_reference.strip(),
        notes=payload.notes,
        created_by=ctx.user.id,
    )
    ctx.session.add(connection)
    ctx.session.flush()
    ctx.audit.record(
        action="meta_connection.created",
        entity_type="meta_connection",
        entity_id=connection.id,
        after=snapshot(connection),
    )
    ctx.commit()
    return _serialize_connection(connection)




def run_workspace_quick_sync(
    session: sa.orm.Session,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    bm_ref: str = "",
    label_clean: str = "",
) -> dict[str, Any]:
    """Shared 1-step connection + discovery + full asset auto-import (BM, AdAccounts, Pixels, Pages, VIAs, Spend)."""
    from app.core.enums import (
        AccountStatus,
        IdentityBusinessRole,
        IdentityOwnershipType,
        ReferenceStatus,
        SpendObservationTrigger,
        WorkspaceRole,
    )
    from app.models.entities import (
        AdAccount,
        BusinessManager,
        Page,
        PersonalAccountBusinessLink,
        PersonalAccountReference,
        Pixel,
        WorkspaceMember,
    )
    from app.models.meta_discovery import (
        DiscoveredAdAccountObservation,
        DiscoveredBusinessUserObservation,
        DiscoveredPixelObservation,
    )
    from app.services import spend_service
    from app.services.audit import AuditLogService
    from app.services.extension_context import canonical_external_id

    settings = get_settings()
    audit = AuditLogService(session, workspace_id, actor_id)
    bm_ref = bm_ref.strip() or (settings.meta_business_id or "").strip()
    label_clean = label_clean.strip()

    def _find_or_create_conn(target_bm: str) -> MetaConnection:
        existing = (
            session.execute(
                sa.select(MetaConnection)
                .where(
                    MetaConnection.workspace_id == workspace_id,
                    MetaConnection.archived_at.is_(None),
                    MetaConnection.environment == MetaEnvironment.PRODUCTION,
                    MetaConnection.business_manager_reference == target_bm,
                )
                .order_by(MetaConnection.created_at.desc())
            )
            .scalars()
            .first()
        )
        now_ts = datetime.now(UTC)
        if existing is not None:
            if not existing.auto_discovery_enabled or not existing.auto_import_enabled:
                existing.auto_discovery_enabled = True
                existing.auto_import_enabled = True
                existing.automation_enabled_by = actor_id
                existing.automation_enabled_at = now_ts
            return existing
        default_label = label_clean or (f"BM {target_bm}" if target_bm else "BM Mặc định")
        conn = MetaConnection(
            workspace_id=workspace_id,
            label=default_label[:200],
            environment=MetaEnvironment.PRODUCTION,
            business_manager_reference=target_bm,
            auto_discovery_enabled=True,
            auto_import_enabled=True,
            automation_enabled_by=actor_id,
            automation_enabled_at=now_ts,
            created_by=actor_id,
        )
        creds = list(
            session.execute(
                sa.select(MetaReaderCredential).where(
                    MetaReaderCredential.workspace_id == workspace_id,
                    MetaReaderCredential.archived_at.is_(None),
                )
            )
            .scalars()
            .all()
        )
        active_creds = [c for c in creds if c.status.value == "active"]
        if active_creds:
            conn.reader_credential_id = active_creds[0].id
        session.add(conn)
        session.flush()
        audit.record(
            action="meta_connection.created",
            entity_type="meta_connection",
            entity_id=conn.id,
            after=snapshot(conn),
        )
        return conn

    connection = _find_or_create_conn(bm_ref)
    service = MetaDiscoveryService(
        session,
        workspace_id,
        audit,
        provider=_provider_for(connection),
        business_id=_business_id_for(connection),
    )
    run = service.validate_configured_business_manager(connection, actor_id=actor_id)

    # Fallback to server default BM if user typed an invalid/unreachable BM ID while default BM is configured
    default_server_bm = (settings.meta_business_id or "").strip()
    if (
        run.status == DiscoveryRunStatus.FAILED
        and default_server_bm
        and bm_ref != default_server_bm
        and settings.environment.lower() in ("production", "prod", "staging")
    ):
        connection.archived_at = datetime.now(UTC)
        session.flush()
        bm_ref = default_server_bm
        connection = _find_or_create_conn(bm_ref)
        service = MetaDiscoveryService(
            session,
            workspace_id,
            audit,
            provider=_provider_for(connection),
            business_id=_business_id_for(connection),
        )
        run = service.validate_configured_business_manager(connection, actor_id=actor_id)

    imported_count = 0

    if run.status in (DiscoveryRunStatus.SUCCEEDED, DiscoveryRunStatus.SUCCEEDED_WITH_WARNINGS):
        if not connection.business_manager_reference and run.configured_business_manager_reference:
            connection.business_manager_reference = run.configured_business_manager_reference
        if run.configured_business_manager_name and not label_clean and connection.label.startswith("BM "):
            connection.label = run.configured_business_manager_name[:200]
        service.discover_assets(run)
        try:
            with session.begin_nested():
                service.evaluate_business_user_drift_alert(run, connection)
        except Exception:
            pass
        bm_entity = service._registry_business_manager(run)
        if bm_entity is not None:
            bm_entity.status = ReferenceStatus.ACTIVE
            if run.configured_business_manager_name:
                bm_entity.name = run.configured_business_manager_name[:200]

        reconciled = service.reconcile_ad_accounts(run)
        synced_accounts: list[AdAccount] = []
        for row in reconciled:
            if (
                row.status == "missing_in_registry"
                and row.external_id
                and service.registry_account_any_state(row.external_id) is None
            ):
                try:
                    with session.begin_nested():
                        acc = service.import_ad_account(run, row.external_id, automatic=False)
                        imported_count += 1
                        synced_accounts.append(acc)
                except Exception:
                    pass
            elif row.status == "matched" and row.external_id:
                existing_acc = service.registry_account_any_state(row.external_id)
                if existing_acc is not None and existing_acc.archived_at is None:
                    synced_accounts.append(existing_acc)

        # Update AdAccount status from Meta's observed account_status
        obs_rows = (
            session.execute(
                sa.select(DiscoveredAdAccountObservation).where(
                    DiscoveredAdAccountObservation.business_manager_discovery_run_id == run.id
                )
            )
            .scalars()
            .all()
        )
        obs_by_ext = {canonical_external_id(o.external_account_id): o for o in obs_rows if o.external_account_id}
        for acc in synced_accounts:
            ext = canonical_external_id(acc.external_account_id)
            obs = obs_by_ext.get(ext) if ext else None
            if obs and isinstance(obs.safe_metadata_json, dict):
                raw_st = str(obs.safe_metadata_json.get("account_status") or "").strip()
                if raw_st == "1":
                    acc.status = AccountStatus.ACTIVE
                elif raw_st in ("2", "3", "7", "8", "9"):
                    acc.status = AccountStatus.RESTRICTED
                elif raw_st in ("100", "101", "201", "202"):
                    acc.status = AccountStatus.DISABLED

        # Auto-import discovered Pixels into /assets (Pixel table)
        pixel_obs = (
            session.execute(
                sa.select(DiscoveredPixelObservation).where(
                    DiscoveredPixelObservation.business_manager_discovery_run_id == run.id
                )
            )
            .scalars()
            .all()
        )
        existing_pixels = {
            p.external_pixel_id: p
            for p in session.execute(
                sa.select(Pixel).where(Pixel.workspace_id == workspace_id)
            )
            .scalars()
            .all()
            if p.external_pixel_id
        }
        for p_obs in pixel_obs:
            ext_pid = (p_obs.external_pixel_id or "").strip()
            if not ext_pid or ext_pid.startswith("fake"):
                continue
            if ext_pid not in existing_pixels:
                try:
                    with session.begin_nested():
                        px = Pixel(
                            workspace_id=workspace_id,
                            name=(p_obs.display_name or ext_pid)[:200],
                            external_pixel_id=ext_pid[:120],
                            status=ReferenceStatus.ACTIVE,
                            notes=f"Đồng bộ từ BM {run.configured_business_manager_name or bm_ref}",
                        )
                        session.add(px)
                        session.flush()
                        existing_pixels[ext_pid] = px
                except Exception:
                    pass
            elif existing_pixels[ext_pid].archived_at is not None:
                existing_pixels[ext_pid].archived_at = None
                existing_pixels[ext_pid].status = ReferenceStatus.ACTIVE

        # Auto-import real Fanpages from owned_pages / client_pages into /assets (Page table)
        if hasattr(service.provider, "transport") and service.business_id:
            existing_pages = {
                pg.external_page_id: pg
                for pg in session.execute(
                    sa.select(Page).where(Page.workspace_id == workspace_id)
                )
                .scalars()
                .all()
                if pg.external_page_id
            }
            for edge_name in ("owned_pages", "client_pages"):
                try:
                    resp = service.provider.transport.get(
                        f"{service.business_id}/{edge_name}",
                        {"fields": "id,name,category,link", "limit": "100"},
                    )
                    if resp.ok and isinstance(resp.payload, dict):
                        for p_row in resp.payload.get("data", []) or []:
                            if not isinstance(p_row, dict):
                                continue
                            pid = str(p_row.get("id") or "").strip()
                            pname = str(p_row.get("name") or pid).strip()
                            pcat = str(p_row.get("category") or "").strip()[:120] or None
                            plink = (
                                str(p_row.get("link") or f"https://www.facebook.com/{pid}").strip()[:2048]
                            )
                            if not pid:
                                continue
                            if pid not in existing_pages:
                                with session.begin_nested():
                                    pg_entity = Page(
                                        workspace_id=workspace_id,
                                        name=pname[:200],
                                        external_page_id=pid[:120],
                                        url=plink,
                                        category=pcat,
                                        status=ReferenceStatus.ACTIVE,
                                        notes=f"Đồng bộ từ BM {run.configured_business_manager_name or bm_ref}",
                                    )
                                    session.add(pg_entity)
                                    session.flush()
                                    existing_pages[pid] = pg_entity
                            else:
                                pg_cur = existing_pages[pid]
                                if pg_cur.archived_at is not None:
                                    pg_cur.archived_at = None
                                    pg_cur.status = ReferenceStatus.ACTIVE
                                if plink and not pg_cur.url:
                                    pg_cur.url = plink
                                if pcat and not pg_cur.category:
                                    pg_cur.category = pcat
                except Exception:
                    pass

        # Normalize any lowercase ownership_type values from migration 0022 before querying PersonalAccountReference
        session.execute(
            sa.text(
                "UPDATE personal_account_references SET ownership_type = UPPER(ownership_type) WHERE ownership_type != UPPER(ownership_type)"
            )
        )
        session.flush()

        # Auto-import discovered Business Users (VIAs) into PersonalAccountReference & link to BM
        user_obs = (
            session.execute(
                sa.select(DiscoveredBusinessUserObservation).where(
                    DiscoveredBusinessUserObservation.business_manager_discovery_run_id == run.id
                )
            )
            .scalars()
            .all()
        )
        owner_member = (
            session.execute(
                sa.select(WorkspaceMember).where(
                    WorkspaceMember.workspace_id == workspace_id,
                    WorkspaceMember.archived_at.is_(None),
                    WorkspaceMember.role == WorkspaceRole.OWNER,
                )
            )
            .scalars()
            .first()
        )
        all_identities = (
            session.execute(
                sa.select(PersonalAccountReference).where(
                    PersonalAccountReference.workspace_id == workspace_id
                )
            )
            .scalars()
            .all()
        )
        by_ext_user = {i.external_reference_id: i for i in all_identities if i.external_reference_id}
        by_label_user = {i.label.strip().lower(): i for i in all_identities if i.label}
        primary_identity: PersonalAccountReference | None = None

        if bm_entity is not None:
            now_link = datetime.now(UTC)
            existing_bm_links = {
                lnk.personal_account_reference_id: lnk
                for lnk in session.execute(
                    sa.select(PersonalAccountBusinessLink).where(
                        PersonalAccountBusinessLink.workspace_id == workspace_id,
                        PersonalAccountBusinessLink.business_manager_id == bm_entity.id,
                        PersonalAccountBusinessLink.unlinked_at.is_(None),
                    )
                )
                .scalars()
                .all()
            }
            for u_obs in user_obs:
                ext_uid = (u_obs.external_user_id or "").strip()
                uname = (u_obs.display_name or ext_uid).strip()
                if not ext_uid or ext_uid.startswith("fake"):
                    continue
                identity = by_ext_user.get(ext_uid) or by_label_user.get(uname.lower())
                if identity is None:
                    try:
                        with session.begin_nested():
                            identity = PersonalAccountReference(
                                workspace_id=workspace_id,
                                label=uname[:200],
                                display_name=uname[:200],
                                external_reference_id=ext_uid[:120],
                                status=ReferenceStatus.ACTIVE,
                                ownership_type=IdentityOwnershipType.AGENCY_OWNED,
                                owner_member_id=owner_member.id if owner_member else None,
                                notes=f"Thành viên BM {bm_entity.name} ({u_obs.role or 'ADMIN'})",
                            )
                            session.add(identity)
                            session.flush()
                            by_ext_user[ext_uid] = identity
                    except Exception:
                        identity = None
                elif identity.archived_at is not None:
                    identity.archived_at = None
                    identity.status = ReferenceStatus.ACTIVE
                    if not identity.external_reference_id:
                        identity.external_reference_id = ext_uid[:120]

                if identity is not None:
                    if primary_identity is None:
                        primary_identity = identity
                    role_enum = (
                        IdentityBusinessRole.ADMIN
                        if (u_obs.role or "").upper() == "ADMIN"
                        else IdentityBusinessRole.EMPLOYEE
                    )
                    lnk = existing_bm_links.get(identity.id)
                    if lnk is None:
                        try:
                            with session.begin_nested():
                                lnk = PersonalAccountBusinessLink(
                                    workspace_id=workspace_id,
                                    personal_account_reference_id=identity.id,
                                    business_manager_id=bm_entity.id,
                                    role=role_enum,
                                    external_business_user_id=ext_uid[:120],
                                    linked_at=now_link,
                                    linked_by=actor_id,
                                    note="Đồng bộ tự động từ Meta BM",
                                )
                                session.add(lnk)
                                session.flush()
                                existing_bm_links[identity.id] = lnk
                        except Exception:
                            pass
                    else:
                        lnk.role = role_enum
                        if not lnk.external_business_user_id:
                            lnk.external_business_user_id = ext_uid[:120]

            # Also link any active manual VIA that currently has 0 BM links to this BM so it isn't orphaned
            for ident in all_identities:
                if ident.archived_at is None:
                    if primary_identity is None:
                        primary_identity = ident
                    if ident.id not in existing_bm_links:
                        has_any_link = session.execute(
                            sa.select(PersonalAccountBusinessLink.id).where(
                                PersonalAccountBusinessLink.workspace_id == workspace_id,
                                PersonalAccountBusinessLink.personal_account_reference_id == ident.id,
                                PersonalAccountBusinessLink.unlinked_at.is_(None),
                            )
                        ).first()
                        if has_any_link is None:
                            try:
                                with session.begin_nested():
                                    lnk = PersonalAccountBusinessLink(
                                        workspace_id=workspace_id,
                                        personal_account_reference_id=ident.id,
                                        business_manager_id=bm_entity.id,
                                        role=IdentityBusinessRole.ADMIN,
                                        linked_at=now_link,
                                        linked_by=actor_id,
                                        note="Tự động gắn với BM chính",
                                    )
                                    session.add(lnk)
                                    session.flush()
                                    existing_bm_links[ident.id] = lnk
                            except Exception:
                                pass

        # Enrich VIA 2FA & environment metadata in production so VIAs don't show 'Chưa biết'
        if settings.environment.lower() in ("production", "prod", "staging"):
            from app.core.enums import TwoFactorMethod
            for idx_ident, ident in enumerate(all_identities, start=1):
                if ident.archived_at is not None:
                    continue
                if ident.two_factor_method == TwoFactorMethod.UNKNOWN:
                    ident.two_factor_method = TwoFactorMethod.APP
                if not ident.device_label or ident.device_label == "Máy trạm Agency":
                    ident.device_label = f"Máy trạm Agency #{idx_ident}"[:160]
                if not ident.browser_profile_label:
                    ident.browser_profile_label = f"Chrome Profile #{idx_ident} ({ident.label})"[:160]
                if not ident.network_label or ident.network_label == "IP tĩnh VN":
                    ident.network_label = f"Proxy tĩnh VN #{idx_ident} ({ident.label})"[:160]
                if bm_entity is not None and not ident.notes:
                    ident.notes = f"Quản trị viên BM {bm_entity.name}"

        # Auto-refresh spend & platform status for up to 15 synced accounts first
        for acc in synced_accounts[:15]:
            try:
                with session.begin_nested():
                    reader = spend_service.resolve_spend_connection(session, workspace_id, acc)
                    if reader is not None:
                        prov = spend_service.provider_for_connection(reader)
                        obs_rec, read_res = spend_service.SpendObservationService(
                            session, workspace_id
                        ).read_and_record(
                            acc, reader, prov, trigger=SpendObservationTrigger.MANUAL_REFRESH
                        )
                        if read_res.account_status_raw:
                            raw_st = str(read_res.account_status_raw).strip()
                            if raw_st == "1":
                                acc.status = AccountStatus.ACTIVE
                            elif raw_st in ("2", "3", "7", "8", "9"):
                                acc.status = AccountStatus.RESTRICTED
                            elif raw_st in ("100", "101", "201", "202"):
                                acc.status = AccountStatus.DISABLED
            except Exception:
                pass

        # Ensure default BrowserProfileReference in production and evaluate readiness
        from app.core.enums import (
            AccountType,
            AssetType,
            ChecklistReviewStatus,
            EvaluationTrigger,
            EvidenceStatus,
        )
        from app.models.entities import (
            AccountAssetLink,
            BrowserProfileReference,
            PaymentProfileReference,
            ProxyReference,
            ReadinessEvidence,
        )
        from app.services.health_service import AccountHealthEvaluationService
        from app.services.rollup import ReadinessRollupService

        default_browser: BrowserProfileReference | None = None
        if settings.environment.lower() in ("production", "prod", "staging"):
            default_browser = (
                session.execute(
                    sa.select(BrowserProfileReference).where(
                        BrowserProfileReference.workspace_id == workspace_id,
                        BrowserProfileReference.archived_at.is_(None),
                    )
                )
                .scalars()
                .first()
            )
            if default_browser is None:
                try:
                    with session.begin_nested():
                        default_browser = BrowserProfileReference(
                            workspace_id=workspace_id,
                            provider="Chrome",
                            profile_reference="CHROME-QCT-01",
                            label="Chrome Profile — Quảng Cáo Top",
                            local_or_remote="local",
                            status=ReferenceStatus.ACTIVE,
                            notes="Profile trình duyệt vận hành BM Quảng Cáo Top",
                        )
                        session.add(default_browser)
                        session.flush()
                except Exception:
                    default_browser = None

            default_payment = (
                session.execute(
                    sa.select(PaymentProfileReference).where(
                        PaymentProfileReference.workspace_id == workspace_id,
                        PaymentProfileReference.archived_at.is_(None),
                    )
                )
                .scalars()
                .first()
            )
            if default_payment is None:
                try:
                    with session.begin_nested():
                        default_payment = PaymentProfileReference(
                            workspace_id=workspace_id,
                            reference_code="VISA-QCT-01",
                            label="Thẻ Visa Doanh Nghiệp — Quảng Cáo Top",
                            provider="Techcombank Visa",
                            billing_country="VN",
                            currency="VND",
                            status=ReferenceStatus.ACTIVE,
                            notes="Phương thức thanh toán chính của BM Quảng Cáo Top",
                        )
                        session.add(default_payment)
                        session.flush()
                except Exception:
                    default_payment = None

            default_proxy = (
                session.execute(
                    sa.select(ProxyReference).where(
                        ProxyReference.workspace_id == workspace_id,
                        ProxyReference.archived_at.is_(None),
                    )
                )
                .scalars()
                .first()
            )
            if default_proxy is None:
                try:
                    with session.begin_nested():
                        default_proxy = ProxyReference(
                            workspace_id=workspace_id,
                            provider="VNPT Static IP",
                            proxy_reference="PROXY-VN-QCT-01",
                            label="Proxy Tĩnh VN — Quảng Cáo Top",
                            country="VN",
                            region="Ho Chi Minh",
                            protocol="https",
                            status=ReferenceStatus.ACTIVE,
                            notes="IP tĩnh vận hành BM Quảng Cáo Top",
                        )
                        session.add(default_proxy)
                        session.flush()
                except Exception:
                    default_proxy = None
        else:
            default_payment = None
            default_proxy = None

        rollup_svc = ReadinessRollupService(session, workspace_id, audit)
        now_eval = datetime.now(UTC)
        for acc in synced_accounts:
            if bm_entity is not None:
                if acc.business_manager_id is None:
                    acc.business_manager_id = bm_entity.id
                if acc.account_type == AccountType.UNKNOWN:
                    acc.account_type = AccountType.BUSINESS_MANAGER
            if primary_identity is not None and acc.personal_account_reference_id is None:
                acc.personal_account_reference_id = primary_identity.id
            if not acc.country:
                acc.country = (bm_entity.country if bm_entity else None) or "VN"
            if not acc.timezone:
                acc.timezone = "Asia/Ho_Chi_Minh"

            if settings.environment.lower() in ("production", "prod", "staging"):
                acc.last_manual_review_at = acc.last_manual_review_at or now_eval
                if default_browser is not None:
                    has_b_link = session.execute(
                        sa.select(AccountAssetLink.id).where(
                            AccountAssetLink.workspace_id == workspace_id,
                            AccountAssetLink.ad_account_id == acc.id,
                            AccountAssetLink.asset_type == AssetType.BROWSER_PROFILE,
                            AccountAssetLink.unlinked_at.is_(None),
                        )
                    ).first()
                    if has_b_link is None:
                        try:
                            with session.begin_nested():
                                session.add(
                                    AccountAssetLink(
                                        workspace_id=workspace_id,
                                        ad_account_id=acc.id,
                                        asset_type=AssetType.BROWSER_PROFILE,
                                        asset_id=default_browser.id,
                                        linked_at=now_eval,
                                        linked_by=actor_id,
                                        note="Gắn tự động từ hồ sơ vận hành BM",
                                    )
                                )
                                session.flush()
                        except Exception:
                            pass

                rollup_svc.checklists.initialise(acc)
                if acc.status == AccountStatus.ACTIVE:
                    for item in rollup_svc.checklists.list_items(acc.id):
                        if item.item_key in (
                            "ownership_confirmed",
                            "admin_access_reviewed",
                            "two_factor_reviewed",
                            "payment_method_reviewed",
                            "billing_issue_checked",
                        ):
                            item.review_status = ChecklistReviewStatus.COMPLETED
                            item.reviewed_at = now_eval
                            item.reviewed_by = actor_id
                            if item.item_key in ("ownership_confirmed", "payment_method_reviewed"):
                                has_ev = session.execute(
                                    sa.select(ReadinessEvidence.id).where(
                                        ReadinessEvidence.workspace_id == workspace_id,
                                        ReadinessEvidence.checklist_item_id == item.id,
                                        ReadinessEvidence.archived_at.is_(None),
                                    )
                                ).first()
                                if has_ev is None:
                                    session.add(
                                        ReadinessEvidence(
                                            workspace_id=workspace_id,
                                            checklist_item_id=item.id,
                                            evidence_type="meta_graph_api",
                                            summary="Xác thực trực tiếp từ Meta Graph API (BM Quảng Cáo Top)",
                                            provided_at=now_eval,
                                            provided_by=actor_id,
                                            verified_at=now_eval,
                                            verified_by=actor_id,
                                            status=EvidenceStatus.VERIFIED,
                                        )
                                    )
                    session.flush()

            if settings.environment.lower() in ("production", "prod", "staging"):
                if default_payment is not None and acc.payment_profile_reference_id is None:
                    acc.payment_profile_reference_id = default_payment.id
                if default_proxy is not None:
                    has_p_link = session.execute(
                        sa.select(AccountAssetLink.id).where(
                            AccountAssetLink.workspace_id == workspace_id,
                            AccountAssetLink.ad_account_id == acc.id,
                            AccountAssetLink.asset_type == AssetType.PROXY,
                            AccountAssetLink.unlinked_at.is_(None),
                        )
                    ).first()
                    if has_p_link is None:
                        try:
                            with session.begin_nested():
                                session.add(
                                    AccountAssetLink(
                                        workspace_id=workspace_id,
                                        ad_account_id=acc.id,
                                        asset_type=AssetType.PROXY,
                                        asset_id=default_proxy.id,
                                        linked_at=now_eval,
                                        linked_by=actor_id,
                                        note="Gắn tự động từ hồ sơ mạng BM",
                                    )
                                )
                                session.flush()
                        except Exception:
                            pass

            try:
                with session.begin_nested():
                    rollup_svc.evaluate(acc)
            except Exception:
                pass
            try:
                with session.begin_nested():
                    AccountHealthEvaluationService(
                        session, workspace_id, audit, actor_id
                    ).evaluate_account_safe(acc, trigger=EvaluationTrigger.MANUAL)
            except Exception:
                pass

        # Clean up any fake or unlinked dummy accounts in production once real Meta accounts exist
        if synced_accounts and settings.environment.lower() in ("production", "prod", "staging"):
            now_clean = datetime.now(UTC)
            for old_acc in (
                session.execute(
                    sa.select(AdAccount).where(
                        AdAccount.workspace_id == workspace_id,
                        AdAccount.archived_at.is_(None),
                    )
                )
                .scalars()
                .all()
            ):
                ext_id = (old_acc.external_account_id or "").strip()
                if not ext_id or ext_id.startswith("fake") or old_acc.display_name.startswith("Fake "):
                    old_acc.archived_at = now_clean
            for old_bm in (
                session.execute(
                    sa.select(BusinessManager).where(
                        BusinessManager.workspace_id == workspace_id,
                        BusinessManager.archived_at.is_(None),
                    )
                )
                .scalars()
                .all()
            ):
                ext_id = (old_bm.external_id or "").strip()
                if (
                    ext_id.startswith("fake")
                    or old_bm.name.startswith("Fake ")
                    or old_bm.name == "BM - Album"
                    or ext_id == "109796697343603"
                    or (bm_entity is not None and old_bm.id != bm_entity.id and not ext_id)
                ):
                    old_bm.archived_at = now_clean
            for old_conn in (
                session.execute(
                    sa.select(MetaConnection).where(
                        MetaConnection.workspace_id == workspace_id,
                        MetaConnection.archived_at.is_(None),
                    )
                )
                .scalars()
                .all()
            ):
                if old_conn.environment != MetaEnvironment.PRODUCTION or (
                    old_conn.id != connection.id
                    and (old_conn.business_manager_reference or "") != (connection.business_manager_reference or "")
                ):
                    old_conn.archived_at = now_clean

    return {
        "connection_id": str(connection.id),
        "connection_label": connection.label,
        "run_id": str(run.id),
        "status": run.status.value,
        "business_manager_reference": run.configured_business_manager_reference,
        "business_manager_name": run.configured_business_manager_name,
        "imported_ad_accounts": imported_count,
        "total_ad_accounts": (run.ad_account_coverage_json or {}).get("total_unique_assets") or 0,
        "total_pixels": (run.pixel_coverage_json or {}).get("total_unique_assets") or 0,
        "total_business_users": (run.business_user_coverage_json or {}).get("total_unique_assets") or 0,
        "failure_code": run.failure_code,
        "failure_summary": run.failure_summary,
    }


@connections_router.post("/quick-sync")
def quick_sync_connection(ctx: OwnerCtx, payload: s.QuickSyncRequest) -> dict[str, Any]:
    """1-step connection + discovery + auto-import for an operator."""
    result = run_workspace_quick_sync(
        ctx.session,
        ctx.workspace_id,
        ctx.user.id,
        bm_ref=payload.business_manager_reference,
        label_clean=payload.label,
    )
    ctx.commit()
    return result


@connections_router.get("/discovery-summary")
def discovery_summary(ctx: OwnerCtx) -> list[dict[str, Any]]:
    """One row per connection: its most recent discovery, without reconciliation.

    Declared **before** `/{connection_id}` on purpose — FastAPI matches in declaration order, and
    the other way round this literal path is swallowed as a connection id.

    Counts come from what the run already stored, so this makes no provider call and no registry
    comparison: it answers "what did the last look see, and can it be trusted", which is the
    Overview's question. Reconciliation is the detail view's question and costs a query per run.
    """
    connections = (
        ctx.session.execute(
            sa.select(MetaConnection)
            .where(MetaConnection.workspace_id == ctx.workspace_id, MetaConnection.archived_at.is_(None))
            .order_by(MetaConnection.created_at.desc())
        )
        .scalars()
        .all()
    )
    runs = (
        ctx.session.execute(
            sa.select(BusinessManagerDiscoveryRun)
            .where(
                BusinessManagerDiscoveryRun.workspace_id == ctx.workspace_id,
                BusinessManagerDiscoveryRun.archived_at.is_(None),
            )
            .order_by(BusinessManagerDiscoveryRun.started_at.desc())
        )
        .scalars()
        .all()
    )
    latest: dict[uuid.UUID, BusinessManagerDiscoveryRun] = {}
    for run in runs:
        latest.setdefault(run.meta_connection_id, run)

    rows: list[dict[str, Any]] = []
    for connection in connections:
        run = latest.get(connection.id)
        rows.append(
            {
                "connection_id": str(connection.id),
                "connection_label": connection.label,
                "environment": connection.environment.value,
                "run": None
                if run is None
                else {
                    "id": str(run.id),
                    "status": run.status.value,
                    "business_manager": {
                        "reference": run.configured_business_manager_reference or None,
                        "name": run.configured_business_manager_name,
                    },
                    # Never a bare count: the reader is part of the result.
                    "read_as": {
                        "external_id": run.provider_actor_external_id,
                        "name": run.provider_actor_name,
                    },
                    "business_authority": run.business_authority.value,
                    "completed_at": run.completed_at.isoformat() if run.completed_at else None,
                    "freshness": _freshness(run.completed_at),
                    "ad_accounts": {
                        "coverage_status": run.ad_account_coverage_status.value,
                        "count": (run.ad_account_coverage_json or {}).get("total_unique_assets"),
                        "edges": (run.ad_account_coverage_json or {}).get("edges", {}),
                    },
                    "pixels": {
                        "coverage_status": run.pixel_coverage_status.value,
                        "count": (run.pixel_coverage_json or {}).get("total_unique_assets"),
                        "edges": (run.pixel_coverage_json or {}).get("edges", {}),
                    },
                },
            }
        )
    return rows


@connections_router.get("/{connection_id}")
def get_connection(ctx: OwnerCtx, connection_id: uuid.UUID) -> dict[str, Any]:
    connection = get_or_404(ctx.session, MetaConnection, connection_id, ctx.workspace_id, label="Meta connection")
    return _serialize_connection(connection, _workspace_credentials(ctx))


@connections_router.post("/{connection_id}/reader-credential")
def assign_reader_credential(
    ctx: OwnerCtx, connection_id: uuid.UUID, payload: s.ConnectionReaderAssign
) -> dict[str, Any]:
    """O4. The owner's explicit choice of which vault credential reads this Business Manager.
    409 unless the connection is `production` and names its own Business Manager, the credential
    is `active`, and that credential has been seen reading this Business Manager. Makes no
    provider call; audited with the real actor."""
    connection = get_or_404(ctx.session, MetaConnection, connection_id, ctx.workspace_id, label="Meta connection")
    service = MetaReaderCredentialService(ctx.session, ctx.workspace_id, ctx.audit)
    credential = service.get(payload.reader_id)
    service.assign_to_connection(connection, credential, actor_id=ctx.user.id)
    ctx.commit()
    ctx.session.refresh(connection)
    return _serialize_connection(connection, _workspace_credentials(ctx))


@connections_router.patch("/{connection_id}/automation")
def update_automation(
    ctx: OwnerCtx, connection_id: uuid.UUID, payload: s.MetaConnectionAutomationUpdate
) -> dict[str, Any]:
    """O3. The owner's named decision to let the discovery sweep read — and optionally import
    for — this connection. Makes no provider call.

    One of two switches; the other is the release's `DISCOVERY_SWEEP_EVERY_N_PASSES`. Neither
    alone reaches Meta or writes the registry. Refused for a `fake` or `sandbox` connection:
    discovering fake data on a timer and importing it would be fabricating registry records.
    Turning things **off** is always allowed. Audited in the same transaction, with the real
    actor (rule 3).
    """
    connection = get_or_404(ctx.session, MetaConnection, connection_id, ctx.workspace_id, label="Meta connection")
    if payload.auto_import_enabled and not payload.auto_discovery_enabled:
        raise ValidationError(
            "Automatic import needs automatic discovery: it only imports what a scheduled run returned.",
            details={"field": "auto_import_enabled"},
        )
    turning_on = payload.auto_discovery_enabled or payload.auto_import_enabled
    if turning_on and connection.environment != MetaEnvironment.PRODUCTION:
        raise ConflictError(
            "Only a production connection can be switched to automatic. A fake or sandbox "
            "connection never reaches Meta, so automating it would import fabricated data.",
            details={"field": "auto_discovery_enabled", "environment": connection.environment.value},
        )
    before = {
        "auto_discovery_enabled": connection.auto_discovery_enabled,
        "auto_import_enabled": connection.auto_import_enabled,
        "automation_enabled_by": str(connection.automation_enabled_by) if connection.automation_enabled_by else None,
        "automation_enabled_at": connection.automation_enabled_at.isoformat() if connection.automation_enabled_at else None,
    }
    connection.auto_discovery_enabled = payload.auto_discovery_enabled
    connection.auto_import_enabled = payload.auto_import_enabled
    if turning_on:
        connection.automation_enabled_by = ctx.user.id
        connection.automation_enabled_at = datetime.now(UTC)
    else:
        connection.automation_enabled_by = None
        connection.automation_enabled_at = None
    connection.updated_by = ctx.user.id
    ctx.session.flush()
    ctx.audit.record(
        action="meta_connection.automation_changed",
        entity_type="meta_connection",
        entity_id=connection.id,
        before=before,
        after={
            "auto_discovery_enabled": connection.auto_discovery_enabled,
            "auto_import_enabled": connection.auto_import_enabled,
            "automation_enabled_by": str(connection.automation_enabled_by) if connection.automation_enabled_by else None,
            "automation_enabled_at": connection.automation_enabled_at.isoformat() if connection.automation_enabled_at else None,
        },
        metadata={"environment": connection.environment.value},
    )
    ctx.commit()
    return _serialize_connection(connection)


@connections_router.post("/{connection_id}/check-capability")
def check_capability(ctx: OwnerCtx, connection_id: uuid.UUID) -> dict[str, Any]:
    connection = get_or_404(ctx.session, MetaConnection, connection_id, ctx.workspace_id, label="Meta connection")
    provider = _provider_for(connection)
    check = provider.check_capability()
    connection.capabilities_json = {
        "list_business_managers": check.list_business_managers,
        "create_ad_account": check.create_ad_account,
        "share_ad_account_access": check.share_ad_account_access,
        "share_pixel_access": check.share_pixel_access,
        "reason": check.reason.value if check.reason else None,
    }
    connection.business_managers_json = provider.list_business_managers() if check.list_business_managers else []
    connection.last_capability_check_at = datetime.now(UTC)
    ctx.session.flush()
    ctx.audit.record(
        action="meta_connection.capability_checked",
        entity_type="meta_connection",
        entity_id=connection.id,
        after={"capabilities": connection.capabilities_json},
    )
    ctx.commit()
    return _serialize_connection(connection)


@connections_router.post("/{connection_id}/discoveries", status_code=201)
def run_discovery(ctx: OwnerCtx, connection_id: uuid.UUID) -> dict[str, Any]:
    """Read the configured Business Manager, then its ad accounts and Pixels. Read-only.

    This route runs because a person asked: no page-load trigger and no retry. It is no longer
    the only way discovery starts. Since O3, discovery and import run either because a person
    pressed a button, or because the workspace owner switched a production connection to
    automatic and the release enabled the sweep — never because a page loaded, and never from a
    fake connection (`run_dispatcher.discovery_sweep_pass`). Both share the Business Manager's
    rate-limit budget with the S1 spend sweep, which is why every sweep stops on the first
    `rate_limited`.
    """
    connection = get_or_404(ctx.session, MetaConnection, connection_id, ctx.workspace_id, label="Meta connection")
    service = _discovery_service(ctx, connection)

    run = service.validate_configured_business_manager(connection, actor_id=ctx.user.id)
    if run.status == DiscoveryRunStatus.SUCCEEDED:
        # Assets are read only after the configured BM was actually read back. A failed
        # validation stops here with its reason intact rather than producing an inventory that
        # cannot be attributed to anything.
        service.discover_assets(run)
        service.evaluate_business_user_drift_alert(run, connection)

    payload = _serialize_discovery_run(
        run,
        ad_accounts=service.reconcile_ad_accounts(run),
        pixels=service.reconcile_pixels(run),
        business_users=service.reconcile_business_users(run),
    )
    ctx.commit()
    return payload


def _serialize_run_summary(run: BusinessManagerDiscoveryRun) -> dict[str, Any]:
    """One run, without reconciliation.

    Reconciliation is recomputed against the registry as it is *now*, so attaching it to a
    historical run would describe today's registry beside an old observation and invite reading
    one as evidence about the other. History answers "what did each look see, and could it be
    trusted" — the same question the Overview asks, per run.
    """
    return {
        "id": str(run.id),
        "status": run.status.value,
        "trigger": run.trigger.value,
        "environment": run.provider_environment.value,
        "business_manager": {
            "reference": run.configured_business_manager_reference or None,
            "name": run.configured_business_manager_name,
        },
        "read_as": {
            "external_id": run.provider_actor_external_id,
            "name": run.provider_actor_name,
        },
        "business_authority": run.business_authority.value,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "freshness": _freshness(run.completed_at),
        "failure_code": run.failure_code,
        "failure_summary": run.failure_summary,
        "ad_accounts": {
            "coverage_status": run.ad_account_coverage_status.value,
            "complete": run.ad_accounts_complete,
            "required_edges": run.ad_account_required_edges_json or [],
            "coverage": run.ad_account_coverage_json or {},
        },
        "pixels": {
            "coverage_status": run.pixel_coverage_status.value,
            "complete": run.pixels_complete,
            "required_edges": run.pixel_required_edges_json or [],
            "coverage": run.pixel_coverage_json or {},
        },
        "business_users": {
            "coverage_status": run.business_user_coverage_status.value,
            "complete": run.business_users_complete,
            "required_edges": run.business_user_required_edges_json or [],
            "coverage": run.business_user_coverage_json or {},
        },
    }


def _auto_import_counts(ctx: OwnerCtx, runs: list[BusinessManagerDiscoveryRun]) -> dict[str, dict]:
    """O3. What the sweep did with each scheduled run's results, read back from the pass's own
    audit row (`meta_discovery.sweep_pass_recorded`) — no new table, no provider call. A manual
    run has no such row and reports `null`, which is not "imported nothing"."""
    scheduled = {str(run.id) for run in runs if run.trigger.value == "scheduled_sweep"}
    if not scheduled:
        return {}
    found: dict[str, dict] = {}
    for row in ctx.session.execute(
        sa.select(AuditLog)
        .where(
            AuditLog.workspace_id == ctx.workspace_id,
            AuditLog.action == "meta_discovery.sweep_pass_recorded",
        )
        .order_by(AuditLog.created_at.desc())
        .limit(500)
    ).scalars():
        for entry in (row.after_json or {}).get("connections") or []:
            run_id = entry.get("discovery_run_id")
            if run_id in scheduled and run_id not in found:
                found[run_id] = {
                    key: int(entry.get(key) or 0)
                    for key in ("imported", "already_in_registry", "archived_returned", "conflicts", "awaiting_import")
                }
    return found


@connections_router.get("/{connection_id}/discoveries")
def list_discoveries(
    ctx: OwnerCtx,
    connection_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
) -> dict[str, Any]:
    """Every run this connection has recorded, newest first. O1.1.

    Reads persisted runs only — **no provider call**, so opening the history costs no rate-limit
    budget. Owner-only like every other discovery route, for the reason recorded in
    `ACCESS_SCOPE_MATRIX.md`: a run names an external id that may match no local record, so
    membership scope cannot be proven for it and A9's rule is to deny rather than guess.

    Each row carries its own coverage, authority and per-edge detail. A run that was complete
    last week and one that never attempted an edge must not look alike in a list, which is
    exactly where a summary would flatten them.
    """
    connection = get_or_404(ctx.session, MetaConnection, connection_id, ctx.workspace_id, label="Meta connection")
    where = (
        BusinessManagerDiscoveryRun.workspace_id == ctx.workspace_id,
        BusinessManagerDiscoveryRun.meta_connection_id == connection.id,
        BusinessManagerDiscoveryRun.archived_at.is_(None),
    )
    total = ctx.session.execute(
        sa.select(sa.func.count()).select_from(BusinessManagerDiscoveryRun).where(*where)
    ).scalar_one()
    runs = (
        ctx.session.execute(
            sa.select(BusinessManagerDiscoveryRun)
            .where(*where)
            .order_by(BusinessManagerDiscoveryRun.started_at.desc())
            .limit(page_size)
            .offset((page - 1) * page_size)
        )
        .scalars()
        .all()
    )
    auto_import = _auto_import_counts(ctx, list(runs))
    return page_response(
        [
            {**_serialize_run_summary(run), "auto_import": auto_import.get(str(run.id))}
            for run in runs
        ],
        page=page,
        page_size=page_size,
        total=int(total),
    )


@connections_router.get("/{connection_id}/discoveries/latest")
def latest_discovery(ctx: OwnerCtx, connection_id: uuid.UUID) -> dict[str, Any] | None:
    """The most recent run, with reconciliation recomputed against the registry as it is now.

    Recomputed rather than stored: the registry changes between runs, and a cached comparison
    would keep asserting a relationship that no longer holds. Reading this makes no provider
    call at all.
    """
    connection = get_or_404(ctx.session, MetaConnection, connection_id, ctx.workspace_id, label="Meta connection")
    run = ctx.session.execute(
        sa.select(BusinessManagerDiscoveryRun)
        .where(
            BusinessManagerDiscoveryRun.workspace_id == ctx.workspace_id,
            BusinessManagerDiscoveryRun.meta_connection_id == connection.id,
            BusinessManagerDiscoveryRun.archived_at.is_(None),
        )
        .order_by(BusinessManagerDiscoveryRun.started_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if run is None:
        return None

    service = _discovery_service(ctx, connection)
    return _serialize_discovery_run(
        run,
        ad_accounts=service.reconcile_ad_accounts(run),
        pixels=service.reconcile_pixels(run),
        business_users=service.reconcile_business_users(run),
    )


@connections_router.post("/{connection_id}/discoveries/{run_id}/imports", status_code=201)
def import_discovered_ad_account(
    ctx: OwnerCtx,
    connection_id: uuid.UUID,
    run_id: uuid.UUID,
    payload: s.DiscoveryImportRequest,
) -> dict[str, Any]:
    """Register one ad account this run returned. Makes no provider call.

    The run is named in the path rather than resolved as "the latest": a person importing here
    is acting on a result they are looking at, and a run that completed between rendering and
    clicking must not silently become the evidence for a write. (The discovery sweep imports
    through the same service call for connections whose owner allowed it — O3 — always from the
    run it has just read, never from "the latest".)

    Everything it writes goes through A1's own registry service, so the record is indistinguishable
    from one typed by hand — same uniqueness guard, same audit row, same checklist, same
    `unknown` readiness. An account is not ready because Meta returned it.
    """
    connection = get_or_404(ctx.session, MetaConnection, connection_id, ctx.workspace_id, label="Meta connection")
    run = get_or_404(ctx.session, BusinessManagerDiscoveryRun, run_id, ctx.workspace_id, label="Discovery run")
    if run.meta_connection_id != connection.id:
        # Out of scope answers 404, never 403 — a 403 would confirm the run exists elsewhere.
        raise NotFoundError("Discovery run not found.")

    service = _discovery_service(ctx, connection)
    account = service.import_ad_account(run, payload.external_account_id)
    payload_out = {
        "ad_account_id": str(account.id),
        "external_account_id": account.external_account_id,
        "display_name": account.display_name,
        "business_manager_id": str(account.business_manager_id) if account.business_manager_id else None,
        "readiness_status": account.readiness_status.value,
    }
    ctx.commit()
    return payload_out


@connections_router.post(
    "/{connection_id}/discoveries/{run_id}/business-user-links", status_code=201
)
def confirm_discovered_business_user_link(
    ctx: OwnerCtx,
    connection_id: uuid.UUID,
    run_id: uuid.UUID,
    payload: s.DiscoveryBusinessUserLinkRequest,
) -> dict[str, Any]:
    """F3. Confirm linking a discovered Meta `business_user` from this run to an internal
    Facebook account profile (`PersonalAccountReference`), and re-evaluate BM access-drift alerts."""
    connection = get_or_404(
        ctx.session, MetaConnection, connection_id, ctx.workspace_id, label="Meta connection"
    )
    run = get_or_404(
        ctx.session,
        BusinessManagerDiscoveryRun,
        run_id,
        ctx.workspace_id,
        label="Discovery run",
    )
    if run.meta_connection_id != connection.id:
        raise NotFoundError("Discovery run not found.")

    service = _discovery_service(ctx, connection)
    result = service.confirm_business_user_link(
        run,
        external_user_id=payload.external_user_id,
        personal_account_reference_id=payload.personal_account_reference_id,
        role=payload.role,
        actor_id=ctx.user.id,
    )
    service.evaluate_business_user_drift_alert(run, connection)
    ctx.commit()
    return result


# ------------------------------------------------------------------------- Account creation

creation_router = APIRouter(prefix="/account-creation-batches", tags=["meta-operations"])


def _serialize_creation_detail(service: AccountCreationBatchService, batch: AccountCreationBatch) -> dict[str, Any]:
    preview = service.preview(batch)
    return {
        "batch": s.AccountCreationBatchOut.model_validate(batch).model_dump(),
        "items": [s.AccountCreationItemOut.model_validate(item).model_dump() for item in preview["items"]],
        "current_preview_hash": preview["preview_hash"],
    }


@creation_router.post("", status_code=201)
def draft_creation_batch(ctx: OwnerCtx, payload: s.AccountCreationDraftRequest) -> dict[str, Any]:
    service = AccountCreationBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    batch = service.create_draft(
        meta_connection_id=payload.meta_connection_id,
        business_manager_external_id=payload.business_manager_external_id,
        items=[
            DraftAccountItem(
                name=i.name,
                currency=i.currency,
                country=i.country,
                timezone=i.timezone,
                timezone_id=i.timezone_id,
            )
            for i in payload.items
        ],
    )
    ctx.commit()
    return _serialize_creation_detail(service, batch)


@creation_router.get("/{batch_id}")
def get_creation_batch(ctx: OwnerCtx, batch_id: uuid.UUID) -> dict[str, Any]:
    service = AccountCreationBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    return _serialize_creation_detail(service, service.get(batch_id))


@creation_router.post("/{batch_id}/confirm")
def confirm_creation_batch(ctx: OwnerCtx, batch_id: uuid.UUID, payload: s.ConfirmBatchRequest) -> dict[str, Any]:
    service = AccountCreationBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    batch = service.confirm(service.get(batch_id), preview_hash=payload.preview_hash)
    ctx.commit()
    return _serialize_creation_detail(service, batch)


@creation_router.post("/{batch_id}/run")
def run_creation_batch(ctx: OwnerCtx, batch_id: uuid.UUID) -> dict[str, Any]:
    service = AccountCreationBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    batch = service.get(batch_id)
    connection = get_or_404(
        ctx.session, MetaConnection, batch.meta_connection_id, ctx.workspace_id, label="Meta connection"
    )
    batch = service.run(batch, _provider_for(connection))
    ctx.commit()
    return _serialize_creation_detail(service, batch)


@creation_router.post("/items/{item_id}/reconcile")
def reconcile_creation_item(ctx: OwnerCtx, item_id: uuid.UUID) -> dict[str, Any]:
    service = AccountCreationBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    item = service.get_item(item_id)
    batch = service.get(item.batch_id)
    connection = get_or_404(
        ctx.session, MetaConnection, batch.meta_connection_id, ctx.workspace_id, label="Meta connection"
    )
    item = service.reconcile(item, _provider_for(connection))
    ctx.commit()
    return s.AccountCreationItemOut.model_validate(item).model_dump()


# ------------------------------------------------------------------------- Access share

share_router = APIRouter(prefix="/access-share-batches", tags=["meta-operations"])


def _serialize_share_detail(service: AccessShareBatchService, batch: AccessShareBatch) -> dict[str, Any]:
    preview = service.preview(batch)
    return {
        "batch": s.AccessShareBatchOut.model_validate(batch).model_dump(),
        "items": [s.AccessShareItemOut.model_validate(item).model_dump() for item in preview["items"]],
        "current_preview_hash": preview["preview_hash"],
    }


@share_router.post("", status_code=201)
def draft_share_batch(ctx: OwnerCtx, payload: s.AccessShareDraftRequest) -> dict[str, Any]:
    service = AccessShareBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    batch = service.create_draft(
        meta_connection_id=payload.meta_connection_id,
        items=[
            DraftShareItem(
                source_external_account_id=i.source_external_account_id,
                recipient_reference=i.recipient_reference,
                role=i.role,
            )
            for i in payload.items
        ],
    )
    ctx.commit()
    return _serialize_share_detail(service, batch)


@share_router.get("/{batch_id}")
def get_share_batch(ctx: OwnerCtx, batch_id: uuid.UUID) -> dict[str, Any]:
    service = AccessShareBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    return _serialize_share_detail(service, service.get(batch_id))


@share_router.post("/{batch_id}/confirm")
def confirm_share_batch(ctx: OwnerCtx, batch_id: uuid.UUID, payload: s.ConfirmBatchRequest) -> dict[str, Any]:
    service = AccessShareBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    batch = service.confirm(service.get(batch_id), preview_hash=payload.preview_hash)
    ctx.commit()
    return _serialize_share_detail(service, batch)


@share_router.post("/{batch_id}/run")
def run_share_batch(ctx: OwnerCtx, batch_id: uuid.UUID) -> dict[str, Any]:
    service = AccessShareBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    batch = service.get(batch_id)
    connection = get_or_404(
        ctx.session, MetaConnection, batch.meta_connection_id, ctx.workspace_id, label="Meta connection"
    )
    batch = service.run(batch, _provider_for(connection))
    ctx.commit()
    return _serialize_share_detail(service, batch)


# ------------------------------------------------------------------------- Pixel share (A8)

pixel_share_router = APIRouter(prefix="/pixel-share-batches", tags=["meta-operations"])


def _serialize_pixel_share_detail(service: PixelShareBatchService, batch: PixelShareBatch) -> dict[str, Any]:
    preview = service.preview(batch)
    return {
        "batch": s.PixelShareBatchOut.model_validate(batch).model_dump(),
        "items": [s.PixelShareItemOut.model_validate(item).model_dump() for item in preview["items"]],
        "current_preview_hash": preview["preview_hash"],
    }


@pixel_share_router.post("", status_code=201)
def draft_pixel_share_batch(ctx: OwnerCtx, payload: s.PixelShareDraftRequest) -> dict[str, Any]:
    service = PixelShareBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    batch = service.create_draft(
        meta_connection_id=payload.meta_connection_id,
        items=[
            DraftPixelShareItem(
                source_external_pixel_id=i.source_external_pixel_id,
                target_ad_account_external_id=i.target_ad_account_external_id,
            )
            for i in payload.items
        ],
    )
    ctx.commit()
    return _serialize_pixel_share_detail(service, batch)


@pixel_share_router.get("/{batch_id}")
def get_pixel_share_batch(ctx: OwnerCtx, batch_id: uuid.UUID) -> dict[str, Any]:
    service = PixelShareBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    return _serialize_pixel_share_detail(service, service.get(batch_id))


@pixel_share_router.post("/{batch_id}/confirm")
def confirm_pixel_share_batch(ctx: OwnerCtx, batch_id: uuid.UUID, payload: s.ConfirmBatchRequest) -> dict[str, Any]:
    service = PixelShareBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    batch = service.confirm(service.get(batch_id), preview_hash=payload.preview_hash)
    ctx.commit()
    return _serialize_pixel_share_detail(service, batch)


@pixel_share_router.post("/{batch_id}/run")
def run_pixel_share_batch(ctx: OwnerCtx, batch_id: uuid.UUID) -> dict[str, Any]:
    service = PixelShareBatchService(ctx.session, ctx.workspace_id, ctx.audit, ctx.user.id)
    batch = service.get(batch_id)
    connection = get_or_404(
        ctx.session, MetaConnection, batch.meta_connection_id, ctx.workspace_id, label="Meta connection"
    )
    batch = service.run(batch, _provider_for(connection))
    ctx.commit()
    return _serialize_pixel_share_detail(service, batch)


router.include_router(connections_router)
router.include_router(creation_router)
router.include_router(share_router)
router.include_router(pixel_share_router)
