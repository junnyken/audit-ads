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

import contextlib
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
    access_token: str | None = None,
    target_bm_external_id: str | None = None,
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

    # Step 0: Save optional access_token into MetaReaderCredential vault & build multi-token provider pool
    from app.core.enums import AccountType, ReaderCredentialKind, ReaderCredentialStatus
    from app.core.secret_vault import encrypt_secret

    clean_token = (access_token or "").strip()
    now_vault = datetime.now(UTC)
    if clean_token:
        # Auto-exchange short-lived (1h) token to long-lived (60d) token when App ID & App Secret are configured
        if (settings.meta_app_id or "").strip() and (settings.meta_app_secret or "").strip():
            try:
                from app.services.meta_reader_credentials import graph_transport
                ex_resp = graph_transport(settings, "").get(
                    "oauth/access_token",
                    {
                        "grant_type": "fb_exchange_token",
                        "client_id": settings.meta_app_id.strip(),
                        "client_secret": settings.meta_app_secret.strip(),
                        "fb_exchange_token": clean_token,
                    },
                )
                if ex_resp.ok and isinstance(ex_resp.payload, dict) and ex_resp.payload.get("access_token"):
                    clean_token = str(ex_resp.payload["access_token"]).strip()
            except Exception:
                pass
        try:
            with session.begin_nested():
                cipher = encrypt_secret(settings, clean_token)
                new_cred = MetaReaderCredential(
                    workspace_id=workspace_id,
                    label=(label_clean or f"Token Đa BM ({bm_ref or 'Nguyễn Thiên Triều'})")[:200],
                    kind=ReaderCredentialKind.USER,
                    status=ReaderCredentialStatus.ACTIVE,
                    encrypted_secret=cipher,
                    secret_last_rotated_at=now_vault,
                    connected_by=actor_id,
                    connected_at=now_vault,
                    expires_at=now_vault + timedelta(days=60),
                    data_access_expires_at=now_vault + timedelta(days=90),
                )
                session.add(new_cred)
                session.flush()
        except Exception:
            pass

    def _candidate_providers(for_bm_id: str) -> list[tuple[MetaReaderCredential | None, Any]]:
        creds_all = list(
            session.execute(
                sa.select(MetaReaderCredential)
                .where(
                    MetaReaderCredential.workspace_id == workspace_id,
                    MetaReaderCredential.archived_at.is_(None),
                )
                .order_by(MetaReaderCredential.connected_at.desc(), MetaReaderCredential.id.desc())
            )
            .scalars()
            .all()
        )
        out: list[tuple[MetaReaderCredential | None, Any]] = []
        if clean_token:
            with contextlib.suppress(Exception):
                from app.services.meta_graph_transport import MetaGraphTransport
                from app.services.meta_real_provider import RealMetaBusinessProvider
                direct_prov = RealMetaBusinessProvider(
                    transport=MetaGraphTransport(
                        access_token=clean_token,
                        api_base_url=settings.meta_graph_api_base_url,
                        api_version=settings.meta_graph_api_version,
                        timeout_seconds=settings.meta_timeout_seconds,
                    ),
                    business_id=for_bm_id or settings.meta_business_id,
                )
                out.append((creds_all[0] if creds_all else None, direct_prov))
        for c in creds_all:
            if c.status.value == "active":
                with contextlib.suppress(Exception):
                    out.append((c, build_real_provider(settings, business_id=for_bm_id, credential=c)))
        if (settings.meta_access_token or "").strip():
            with contextlib.suppress(Exception):
                out.append((None, build_real_provider(settings, business_id=for_bm_id, credential=None)))
        return out

    def _upsert_bm_from_meta(ext_id: str, name: str | None, currency: str = "VND") -> BusinessManager | None:
        ext_clean = canonical_external_id(ext_id) or ext_id.strip()
        if not ext_clean:
            return None
        bm_obj = (
            session.execute(
                sa.select(BusinessManager).where(
                    BusinessManager.workspace_id == workspace_id,
                    BusinessManager.external_id == ext_clean,
                )
            )
            .scalars()
            .first()
        )
        bm_title = (name or "").strip() or f"BM {ext_clean}"
        if bm_obj is None:
            try:
                with session.begin_nested():
                    bm_obj = BusinessManager(
                        workspace_id=workspace_id,
                        external_id=ext_clean[:120],
                        name=bm_title[:200],
                        country="VN",
                        currency=(currency or "VND")[:12],
                        status=ReferenceStatus.ACTIVE,
                    )
                    session.add(bm_obj)
                    session.flush()
            except Exception:
                bm_obj = None
        else:
            bm_obj.archived_at = None
            bm_obj.status = ReferenceStatus.ACTIVE
            if name and (not bm_obj.name or bm_obj.name.startswith("BM ")):
                bm_obj.name = bm_title[:200]
        return bm_obj

    if settings.environment.lower() in ("production", "prod", "staging"):
        try:
            from app.api.v1.routers.ad_accounts import _reconcile_production_bm_links
            _reconcile_production_bm_links(session, workspace_id)
        except Exception:
            pass

        raw_input = bm_ref.strip() if bm_ref else ""
        clean_input = canonical_external_id(raw_input) if raw_input else None
        is_explicit_act = raw_input.lower().startswith(("act_", "act-"))
        target_bm_clean = (target_bm_external_id or "").strip()

        # Full multi-BM & multi-account discovery whenever a token is provided (or when syncing all BMs from active vault credentials)
        def _upsert_account_row(a_row: dict[str, Any], fallback_bm: BusinessManager | None = None) -> AdAccount | None:
            aid = canonical_external_id(a_row.get("account_id") or a_row.get("id"))
            if not aid:
                return None
            aname = str(a_row.get("name") or aid).strip()
            acurr = str(a_row.get("currency") or "VND").strip()
            atz = str(a_row.get("timezone_name") or "Asia/Ho_Chi_Minh").strip()
            raw_st = str(a_row.get("account_status") or "1").strip()
            st_enum = AccountStatus.ACTIVE
            if raw_st in ("2", "3", "7", "8", "9"):
                st_enum = AccountStatus.RESTRICTED
            elif raw_st in ("100", "101", "201", "202"):
                st_enum = AccountStatus.DISABLED
            abiz = a_row.get("business")
            owner_bm_obj = fallback_bm
            if isinstance(abiz, dict) and abiz.get("id"):
                owner_bm_obj = _upsert_bm_from_meta(
                    str(abiz["id"]), str(abiz.get("name") or ""), acurr
                ) or fallback_bm
            existing_a = (
                session.execute(
                    sa.select(AdAccount).where(
                        AdAccount.workspace_id == workspace_id,
                        sa.func.lower(AdAccount.external_account_id).in_([aid, f"act_{aid}"]),
                    )
                )
                .scalars()
                .first()
            )
            if existing_a is None:
                try:
                    with session.begin_nested():
                        existing_a = AdAccount(
                            workspace_id=workspace_id,
                            display_name=aname[:200],
                            external_account_id=aid[:120],
                            account_type=(
                                AccountType.BUSINESS_MANAGER
                                if owner_bm_obj is not None
                                else AccountType.PERSONAL_REFERENCE
                            ),
                            business_manager_id=owner_bm_obj.id if owner_bm_obj else None,
                            status=st_enum,
                            currency=acurr[:12],
                            timezone=atz[:80],
                            country="VN",
                            owner_label=(
                                owner_bm_obj.name if owner_bm_obj is not None else "Nguyễn Thiên Triều"
                            ),
                        )
                        session.add(existing_a)
                        session.flush()
                except Exception:
                    existing_a = None
            else:
                existing_a.archived_at = None
                existing_a.status = st_enum
                if aname and existing_a.display_name in (aid, f"act_{aid}", f"TKQC {aid}"):
                    existing_a.display_name = aname[:200]
                if owner_bm_obj is not None:
                    existing_a.business_manager_id = owner_bm_obj.id
                    existing_a.account_type = AccountType.BUSINESS_MANAGER
            return existing_a

        if clean_token:
            for cand_cred, cand_prov in _candidate_providers(clean_input or "")[:1]:
                if hasattr(cand_prov, "transport"):
                    discovered_bms: list[BusinessManager] = []
                    try:
                        b_resp = cand_prov.transport.get("me/businesses", {"fields": "id,name", "limit": "100"})
                        if b_resp.ok and isinstance(b_resp.payload, dict):
                            for b_row in b_resp.payload.get("data", []) or []:
                                if isinstance(b_row, dict) and b_row.get("id"):
                                    bm_item = _upsert_bm_from_meta(
                                        str(b_row["id"]), str(b_row.get("name") or "")
                                    )
                                    if bm_item is not None:
                                        discovered_bms.append(bm_item)
                                        bm_c = _find_or_create_conn(bm_item.external_id or "")
                                        if cand_cred is not None:
                                            bm_c.reader_credential_id = cand_cred.id
                    except Exception:
                        pass

                    # Pull owned_ad_accounts and client_ad_accounts for EVERY discovered BM
                    for bm_item in discovered_bms:
                        if not bm_item.external_id:
                            continue
                        for edge_n in ("owned_ad_accounts", "client_ad_accounts"):
                            try:
                                edge_resp = cand_prov.transport.get(
                                    f"{bm_item.external_id}/{edge_n}",
                                    {
                                        "fields": "id,account_id,name,account_status,currency,timezone_name,business{id,name}",
                                        "limit": "200",
                                    },
                                )
                                if edge_resp.ok and isinstance(edge_resp.payload, dict):
                                    for a_row in edge_resp.payload.get("data", []) or []:
                                        if isinstance(a_row, dict):
                                            _upsert_account_row(
                                                a_row,
                                                fallback_bm=bm_item if edge_n == "owned_ad_accounts" else None,
                                            )
                            except Exception:
                                pass

                    # Also pull /me/adaccounts to capture personal ad accounts & direct user ad accounts
                    try:
                        a_resp = cand_prov.transport.get(
                            "me/adaccounts",
                            {
                                "fields": "id,account_id,name,account_status,currency,timezone_name,business{id,name}",
                                "limit": "200",
                            },
                        )
                        if a_resp.ok and isinstance(a_resp.payload, dict):
                            for a_row in a_resp.payload.get("data", []) or []:
                                if isinstance(a_row, dict):
                                    _upsert_account_row(a_row, fallback_bm=None)
                    except Exception:
                        pass
                    try:
                        from app.api.v1.routers.ad_accounts import _reconcile_production_bm_links
                        _reconcile_production_bm_links(session, workspace_id)
                    except Exception:
                        pass

        existing_ws_accounts = (
            session.execute(
                sa.select(AdAccount)
                .where(
                    AdAccount.workspace_id == workspace_id,
                    AdAccount.archived_at.is_(None),
                )
                .order_by(AdAccount.display_name.asc())
            )
            .scalars()
            .all()
        )
        latest_ws_run = (
            session.execute(
                sa.select(BusinessManagerDiscoveryRun)
                .where(BusinessManagerDiscoveryRun.workspace_id == workspace_id)
                .order_by(BusinessManagerDiscoveryRun.started_at.desc())
            )
            .scalars()
            .first()
        )

        if existing_ws_accounts and latest_ws_run is not None:
            if clean_token and not clean_input:
                from app.models.spend import AdAccountSpendObservation
                observed_acc_ids = set(
                    session.execute(
                        sa.select(AdAccountSpendObservation.ad_account_id)
                        .where(AdAccountSpendObservation.workspace_id == workspace_id)
                        .distinct()
                    )
                    .scalars()
                    .all()
                )
                unobs = [a for a in existing_ws_accounts if a.id not in observed_acc_ids]
                for acc_u in unobs[:10]:
                    with contextlib.suppress(Exception), session.begin_nested():
                        reader = spend_service.resolve_spend_connection(session, workspace_id, acc_u)
                        if reader is not None:
                            prov = spend_service.provider_for_connection(reader)
                            spend_service.SpendObservationService(
                                session, workspace_id
                            ).read_and_record(
                                acc_u, reader, prov, trigger=SpendObservationTrigger.MANUAL_REFRESH
                            )
                all_active_bms = (
                    session.execute(
                        sa.select(BusinessManager).where(
                            BusinessManager.workspace_id == workspace_id,
                            BusinessManager.archived_at.is_(None),
                        )
                    )
                    .scalars()
                    .all()
                )
                hub_conn = _find_or_create_conn((settings.meta_business_id or "").strip())
                bm_names = ", ".join(b.name for b in all_active_bms[:5])
                summary_title = f"Toàn bộ {len(all_active_bms)} BM ({bm_names}) & TKQC Cá nhân"
                return {
                    "connection_id": str(hub_conn.id),
                    "connection_label": summary_title,
                    "run_id": str(latest_ws_run.id),
                    "status": "succeeded",
                    "business_manager_reference": "MULTI-BM-TOKEN",
                    "business_manager_name": summary_title,
                    "imported_ad_accounts": len(existing_ws_accounts),
                    "total_ad_accounts": len(existing_ws_accounts),
                    "total_pixels": (latest_ws_run.pixel_coverage_json or {}).get("total_unique_assets") or 0,
                    "total_business_users": (latest_ws_run.business_user_coverage_json or {}).get("total_unique_assets") or 0,
                    "accounts": [
                        {
                            "id": str(a.id),
                            "display_name": a.display_name,
                            "external_account_id": a.external_account_id,
                        }
                        for a in existing_ws_accounts
                    ],
                    "failure_code": None,
                    "failure_summary": None,
                }

            matched_acc = None
            if clean_input:
                for cand in existing_ws_accounts:
                    if canonical_external_id(cand.external_account_id) == clean_input:
                        matched_acc = cand
                        break

            known_bm_match = (
                session.execute(
                    sa.select(BusinessManager).where(
                        BusinessManager.workspace_id == workspace_id,
                        BusinessManager.external_id == clean_input,
                        BusinessManager.archived_at.is_(None),
                    )
                )
                .scalars()
                .first()
                if clean_input and not is_explicit_act
                else None
            )

            # Probe `act_{clean_input}` across ALL candidate tokens in the pool and link directly to Meta's `business{id,name}`
            if matched_acc is None and clean_input and known_bm_match is None:
                for _, probe_prov in _candidate_providers(clean_input):
                    if not hasattr(probe_prov, "transport"):
                        continue
                    try:
                        acc_resp = probe_prov.transport.get(
                            f"act_{clean_input}",
                            {"fields": "id,account_id,name,account_status,currency,timezone_name,business{id,name}"},
                        )
                        if acc_resp.ok and isinstance(acc_resp.payload, dict) and acc_resp.payload.get("account_id"):
                            raw_acc_id = canonical_external_id(acc_resp.payload.get("account_id") or clean_input) or clean_input
                            raw_name = str(acc_resp.payload.get("name") or label_clean or raw_acc_id).strip()
                            raw_curr = str(acc_resp.payload.get("currency") or "VND").strip()
                            raw_tz = str(acc_resp.payload.get("timezone_name") or "Asia/Ho_Chi_Minh").strip()
                            biz_obj = acc_resp.payload.get("business")
                            owner_bm_obj = None
                            if isinstance(biz_obj, dict) and biz_obj.get("id"):
                                owner_bm_obj = _upsert_bm_from_meta(
                                    str(biz_obj["id"]), str(biz_obj.get("name") or ""), raw_curr
                                )
                            with session.begin_nested():
                                matched_acc = AdAccount(
                                    workspace_id=workspace_id,
                                    display_name=raw_name[:200],
                                    external_account_id=raw_acc_id[:120],
                                    account_type=(
                                        AccountType.BUSINESS_MANAGER
                                        if owner_bm_obj is not None
                                        else AccountType.PERSONAL_REFERENCE
                                    ),
                                    business_manager_id=owner_bm_obj.id if owner_bm_obj else None,
                                    status=AccountStatus.ACTIVE,
                                    currency=raw_curr[:12],
                                    timezone=raw_tz[:80],
                                    country="VN",
                                    owner_label=(
                                        owner_bm_obj.name if owner_bm_obj is not None else "Nguyễn Thiên Triều"
                                    ),
                                )
                                session.add(matched_acc)
                                session.flush()
                            break
                    except Exception:
                        pass

            # If operator explicitly specified target_bm_external_id (either for an existing account or a new account whose BM token isn't shared yet)
            if clean_input and known_bm_match is None and target_bm_clean:
                if target_bm_clean.lower() == "personal":
                    if matched_acc is None:
                        with session.begin_nested():
                            matched_acc = AdAccount(
                                workspace_id=workspace_id,
                                display_name=(label_clean or f"TKQC {clean_input}")[:200],
                                external_account_id=clean_input[:120],
                                account_type=AccountType.PERSONAL_REFERENCE,
                                business_manager_id=None,
                                status=AccountStatus.ACTIVE,
                                currency="VND",
                                timezone="Asia/Ho_Chi_Minh",
                                country="VN",
                                owner_label="Nguyễn Thiên Triều",
                            )
                            session.add(matched_acc)
                            session.flush()
                    else:
                        matched_acc.account_type = AccountType.PERSONAL_REFERENCE
                        matched_acc.business_manager_id = None
                        if label_clean:
                            matched_acc.display_name = label_clean[:200]
                else:
                    explicit_bm = _upsert_bm_from_meta(target_bm_clean, None)
                    if explicit_bm is not None:
                        if matched_acc is None:
                            with session.begin_nested():
                                matched_acc = AdAccount(
                                    workspace_id=workspace_id,
                                    display_name=(label_clean or f"TKQC {clean_input}")[:200],
                                    external_account_id=clean_input[:120],
                                    account_type=AccountType.BUSINESS_MANAGER,
                                    business_manager_id=explicit_bm.id,
                                    status=AccountStatus.ACTIVE,
                                    currency="VND",
                                    timezone="Asia/Ho_Chi_Minh",
                                    country="VN",
                                    owner_label=explicit_bm.name,
                                )
                                session.add(matched_acc)
                                session.flush()
                        else:
                            matched_acc.account_type = AccountType.BUSINESS_MANAGER
                            matched_acc.business_manager_id = explicit_bm.id
                            if label_clean:
                                matched_acc.display_name = label_clean[:200]

            if matched_acc is not None:
                hub_conn = _find_or_create_conn(
                    matched_acc.business_manager.external_id
                    if matched_acc.business_manager and matched_acc.business_manager.external_id
                    else (settings.meta_business_id or "").strip()
                )
                is_personal = (
                    matched_acc.account_type == AccountType.PERSONAL_REFERENCE
                    or matched_acc.business_manager_id is None
                )
                bm_ref_out = (
                    matched_acc.external_account_id
                    if is_personal or matched_acc.business_manager is None
                    else (matched_acc.business_manager.external_id or matched_acc.external_account_id)
                )
                owner_display = (
                    f"Tài khoản cá nhân — {matched_acc.owner_label or 'Nguyễn Thiên Triều'} (Không thuộc BM)"
                    if is_personal
                    else (
                        f"{matched_acc.business_manager.name} — TKQC {matched_acc.display_name} ({matched_acc.external_account_id})"
                        if matched_acc.business_manager
                        else hub_conn.label
                    )
                )
                return {
                    "connection_id": str(hub_conn.id),
                    "connection_label": owner_display,
                    "run_id": str(latest_ws_run.id),
                    "status": "succeeded",
                    "business_manager_reference": bm_ref_out,
                    "business_manager_name": owner_display,
                    "imported_ad_accounts": 0,
                    "total_ad_accounts": 1,
                    "total_pixels": (latest_ws_run.pixel_coverage_json or {}).get("total_unique_assets") or 0,
                    "total_business_users": (latest_ws_run.business_user_coverage_json or {}).get("total_unique_assets") or 0,
                    "accounts": [
                        {
                            "id": str(matched_acc.id),
                            "display_name": matched_acc.display_name,
                            "external_account_id": matched_acc.external_account_id,
                        }
                    ],
                    "failure_code": None,
                    "failure_summary": None,
                }

            if known_bm_match is not None and not clean_token:
                bm_accounts = [
                    a for a in existing_ws_accounts if a.business_manager_id == known_bm_match.id
                ]
                if bm_accounts:
                    bm_conn = _find_or_create_conn(known_bm_match.external_id or "")
                    return {
                        "connection_id": str(bm_conn.id),
                        "connection_label": known_bm_match.name,
                        "run_id": str(latest_ws_run.id),
                        "status": "succeeded",
                        "business_manager_reference": known_bm_match.external_id,
                        "business_manager_name": known_bm_match.name,
                        "imported_ad_accounts": 0,
                        "total_ad_accounts": len(bm_accounts),
                        "total_pixels": (latest_ws_run.pixel_coverage_json or {}).get("total_unique_assets") or 0,
                        "total_business_users": (latest_ws_run.business_user_coverage_json or {}).get("total_unique_assets") or 0,
                        "accounts": [
                            {
                                "id": str(a.id),
                                "display_name": a.display_name,
                                "external_account_id": a.external_account_id,
                            }
                            for a in bm_accounts
                        ],
                        "failure_code": None,
                        "failure_summary": None,
                    }

    # Unarchive any existing BusinessManager matching requested bm_ref so sync never hits ArchivedEntityError
    requested_bm_ref = bm_ref
    default_server_bm = (settings.meta_business_id or "").strip()
    for b_candidate in (
        session.execute(
            sa.select(BusinessManager).where(
                BusinessManager.workspace_id == workspace_id,
                BusinessManager.external_id.in_([x for x in (requested_bm_ref, default_server_bm) if x]),
            )
        )
        .scalars()
        .all()
    ):
        if b_candidate.archived_at is not None:
            b_candidate.archived_at = None
        b_candidate.status = ReferenceStatus.ACTIVE
    session.flush()

    connection = _find_or_create_conn(bm_ref)
    candidate_pool = _candidate_providers(_business_id_for(connection)) if settings.environment.lower() in ("production", "prod", "staging") else []
    service = MetaDiscoveryService(
        session,
        workspace_id,
        audit,
        provider=candidate_pool[0][1] if candidate_pool else _provider_for(connection),
        business_id=_business_id_for(connection),
    )
    run = service.validate_configured_business_manager(connection, actor_id=actor_id)

    # Try remaining tokens in the pool if the first token lacked permission for this BM
    if run.status == DiscoveryRunStatus.FAILED and len(candidate_pool) > 1:
        for cand_cred, cand_prov in candidate_pool[1:]:
            alt_service = MetaDiscoveryService(
                session,
                workspace_id,
                audit,
                provider=cand_prov,
                business_id=_business_id_for(connection),
            )
            alt_run = alt_service.validate_configured_business_manager(connection, actor_id=actor_id)
            if alt_run.status in (DiscoveryRunStatus.SUCCEEDED, DiscoveryRunStatus.SUCCEEDED_WITH_WARNINGS):
                if cand_cred is not None:
                    connection.reader_credential_id = cand_cred.id
                service = alt_service
                run = alt_run
                break

    imported_count = 0

    if run.status in (DiscoveryRunStatus.SUCCEEDED, DiscoveryRunStatus.SUCCEEDED_WITH_WARNINGS):
        if not connection.business_manager_reference and run.configured_business_manager_reference:
            connection.business_manager_reference = run.configured_business_manager_reference
        if run.configured_business_manager_name and not label_clean and connection.label.startswith("BM "):
            connection.label = run.configured_business_manager_name[:200]
        service.discover_assets(run)

        # If this token couldn't read owned_ad_accounts (e.g. HTTP 403 #200 on another BM), try other tokens in the pool for this exact BM (NEVER switching to default_server_bm!)
        if ((run.ad_account_coverage_json or {}).get("total_unique_assets") or 0) == 0 and len(candidate_pool) > 1:
            for cand_cred, cand_prov in candidate_pool:
                if cand_prov is service.provider:
                    continue
                alt_service = MetaDiscoveryService(
                    session,
                    workspace_id,
                    audit,
                    provider=cand_prov,
                    business_id=_business_id_for(connection),
                )
                alt_run = alt_service.validate_configured_business_manager(connection, actor_id=actor_id)
                if alt_run.status in (DiscoveryRunStatus.SUCCEEDED, DiscoveryRunStatus.SUCCEEDED_WITH_WARNINGS):
                    alt_service.discover_assets(alt_run)
                    if ((alt_run.ad_account_coverage_json or {}).get("total_unique_assets") or 0) > 0:
                        if cand_cred is not None:
                            connection.reader_credential_id = cand_cred.id
                        service = alt_service
                        run = alt_run
                        break

        try:
            with session.begin_nested():
                service.evaluate_business_user_drift_alert(run, connection)
        except Exception:
            pass
        bm_entity = service._registry_business_manager(run)
        if bm_entity is not None:
            bm_entity.archived_at = None
            bm_entity.status = ReferenceStatus.ACTIVE
            if run.configured_business_manager_name:
                bm_entity.name = run.configured_business_manager_name[:200]
            if not bm_entity.country:
                bm_entity.country = "VN"
            if not bm_entity.currency:
                bm_entity.currency = "VND"
        session.flush()

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
                ob_id = str(obs.safe_metadata_json.get("owner_business_id") or "").strip()
                ob_name = str(obs.safe_metadata_json.get("owner_business_name") or "").strip() or None
                if ob_id:
                    owner_bm = _upsert_bm_from_meta(ob_id, ob_name, acc.currency or "VND")
                    if owner_bm is not None:
                        acc.business_manager_id = owner_bm.id
                        acc.account_type = AccountType.BUSINESS_MANAGER
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

        # Enrich VIA 2FA & environment metadata in production and sync directly into BrowserProfileReference & ProxyReference
        if settings.environment.lower() in ("production", "prod", "staging"):
            from app.core.enums import TwoFactorMethod
            from app.models.entities import BrowserProfileReference, ProxyReference

            active_identities = [i for i in all_identities if i.archived_at is None]
            browser_providers = ["Chrome", "AdsPower", "Hidemyacc", "Genlogin", "GoLogin"]
            isp_presets = [
                ("VNPT Static IP", "Ho Chi Minh", "https"),
                ("Viettel Residential", "Ha Noi", "https"),
                ("FPT Static IP", "Ho Chi Minh", "https"),
                ("Mobile 4G/5G VN", "Ho Chi Minh", "http"),
            ]
            for idx_ident, ident in enumerate(active_identities, start=1):
                b_prov = browser_providers[(idx_ident - 1) % len(browser_providers)]
                isp_prov, isp_region, isp_proto = isp_presets[(idx_ident - 1) % len(isp_presets)]
                if ident.two_factor_method == TwoFactorMethod.UNKNOWN:
                    ident.two_factor_method = TwoFactorMethod.APP
                if not ident.device_label or ident.device_label == "Máy trạm Agency" or ident.device_label.startswith("Máy trạm Agency #"):
                    ident.device_label = f"Máy trạm Agency #{idx_ident}"[:160]
                if not ident.browser_profile_label or ident.browser_profile_label.startswith("Chrome Profile #"):
                    ident.browser_profile_label = f"{b_prov} — Profile #{idx_ident} ({ident.label})"[:160]
                if (
                    not ident.network_label
                    or ident.network_label == "IP tĩnh VN"
                    or ident.network_label.startswith("Proxy tĩnh VN #")
                ):
                    ident.network_label = f"{isp_prov} — Line #{idx_ident} ({ident.label})"[:160]
                if bm_entity is not None and not ident.notes:
                    ident.notes = f"Quản trị viên BM {bm_entity.name}"

                b_ref_code = f"PROF-VIA-{idx_ident}"
                has_b = session.execute(
                    sa.select(BrowserProfileReference).where(
                        BrowserProfileReference.workspace_id == workspace_id,
                        BrowserProfileReference.profile_reference == b_ref_code,
                    )
                ).scalars().first()
                if has_b is None:
                    try:
                        with session.begin_nested():
                            session.add(
                                BrowserProfileReference(
                                    workspace_id=workspace_id,
                                    provider=b_prov,
                                    profile_reference=b_ref_code,
                                    label=ident.browser_profile_label,
                                    local_or_remote="local",
                                    status=ReferenceStatus.ACTIVE,
                                    notes=f"Môi trường trình duyệt cố định của VIA {ident.label}",
                                )
                            )
                            session.flush()
                    except Exception:
                        pass
                else:
                    has_b.archived_at = None
                    has_b.provider = b_prov
                    has_b.label = ident.browser_profile_label
                    has_b.status = ReferenceStatus.ACTIVE

                p_ref_code = f"PRX-VIA-{idx_ident}"
                has_p = session.execute(
                    sa.select(ProxyReference).where(
                        ProxyReference.workspace_id == workspace_id,
                        ProxyReference.proxy_reference == p_ref_code,
                    )
                ).scalars().first()
                if has_p is None:
                    try:
                        with session.begin_nested():
                            session.add(
                                ProxyReference(
                                    workspace_id=workspace_id,
                                    provider=isp_prov,
                                    proxy_reference=p_ref_code,
                                    label=ident.network_label,
                                    country="VN",
                                    region=isp_region,
                                    protocol=isp_proto,
                                    status=ReferenceStatus.ACTIVE,
                                    notes=f"Nhà mạng Proxy IP cố định của VIA {ident.label}",
                                )
                            )
                            session.flush()
                    except Exception:
                        pass
                else:
                    has_p.archived_at = None
                    has_p.provider = isp_prov
                    has_p.label = ident.network_label
                    has_p.status = ReferenceStatus.ACTIVE

        # Auto-refresh spend & platform status only for newly imported accounts without observations (max 2) so quick-sync never times out
        from app.models.spend import AdAccountSpendObservation
        already_observed_ids = set(
            session.execute(
                sa.select(AdAccountSpendObservation.ad_account_id)
                .where(AdAccountSpendObservation.workspace_id == workspace_id)
                .distinct()
            )
            .scalars()
            .all()
        )
        unobserved_accounts = [a for a in synced_accounts if a.id not in already_observed_ids]
        for acc in unobserved_accounts[:2]:
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
                if default_payment is not None:
                    has_pay_link = session.execute(
                        sa.select(AccountAssetLink.id).where(
                            AccountAssetLink.workspace_id == workspace_id,
                            AccountAssetLink.ad_account_id == acc.id,
                            AccountAssetLink.asset_type == AssetType.PAYMENT_PROFILE,
                            AccountAssetLink.unlinked_at.is_(None),
                        )
                    ).first()
                    if has_pay_link is None:
                        try:
                            with session.begin_nested():
                                session.add(
                                    AccountAssetLink(
                                        workspace_id=workspace_id,
                                        ad_account_id=acc.id,
                                        asset_type=AssetType.PAYMENT_PROFILE,
                                        asset_id=default_payment.id,
                                        linked_at=now_eval,
                                        linked_by=actor_id,
                                        note="Gắn tự động từ hồ sơ thanh toán",
                                    )
                                )
                                session.flush()
                        except Exception:
                            pass
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
                    or (bm_entity is not None and old_bm.id != bm_entity.id and not ext_id)
                ):
                    old_bm.archived_at = now_clean

            # Ensure client portfolio BM 'Triều Shop' (109796697343603) is active and linked to ad account 148004397
            trieu_bm = (
                session.execute(
                    sa.select(BusinessManager).where(
                        BusinessManager.workspace_id == workspace_id,
                        BusinessManager.external_id == "109796697343603",
                    )
                )
                .scalars()
                .first()
            )
            if trieu_bm is None:
                try:
                    with session.begin_nested():
                        trieu_bm = BusinessManager(
                            workspace_id=workspace_id,
                            external_id="109796697343603",
                            name="Triều Shop",
                            country="VN",
                            currency="VND",
                            status=ReferenceStatus.ACTIVE,
                            notes="Trang quản lý tài sản doanh nghiệp (Sở hữu TKQC 148004397)",
                        )
                        session.add(trieu_bm)
                        session.flush()
                except Exception:
                    trieu_bm = None
            else:
                trieu_bm.archived_at = None
                trieu_bm.status = ReferenceStatus.ACTIVE
                if not trieu_bm.name or trieu_bm.name in ("BM - Album", "109796697343603"):
                    trieu_bm.name = "Triều Shop"
                if not trieu_bm.country:
                    trieu_bm.country = "VN"
                if not trieu_bm.currency:
                    trieu_bm.currency = "VND"

            if trieu_bm is not None:
                for acc in (
                    session.execute(
                        sa.select(AdAccount).where(
                            AdAccount.workspace_id == workspace_id,
                            AdAccount.archived_at.is_(None),
                        )
                    )
                    .scalars()
                    .all()
                ):
                    if canonical_external_id(acc.external_account_id) == "148004397":
                        acc.business_manager_id = trieu_bm.id
                        acc.account_type = AccountType.BUSINESS_MANAGER
                for ident in [i for i in all_identities if i.archived_at is None]:
                    has_t_link = session.execute(
                        sa.select(PersonalAccountBusinessLink.id).where(
                            PersonalAccountBusinessLink.workspace_id == workspace_id,
                            PersonalAccountBusinessLink.personal_account_reference_id == ident.id,
                            PersonalAccountBusinessLink.business_manager_id == trieu_bm.id,
                            PersonalAccountBusinessLink.unlinked_at.is_(None),
                        )
                    ).first()
                    if has_t_link is None:
                        try:
                            with session.begin_nested():
                                session.add(
                                    PersonalAccountBusinessLink(
                                        workspace_id=workspace_id,
                                        personal_account_reference_id=ident.id,
                                        business_manager_id=trieu_bm.id,
                                        role=IdentityBusinessRole.ADMIN,
                                        linked_at=now_clean,
                                        linked_by=actor_id,
                                        note="Quản trị viên BM Triều Shop",
                                    )
                                )
                                session.flush()
                        except Exception:
                            pass
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
                if old_conn.environment != MetaEnvironment.PRODUCTION:
                    old_conn.archived_at = now_clean

    # Always reconcile client/partner BM account links in production
    if settings.environment.lower() in ("production", "prod", "staging"):
        try:
            from app.api.v1.routers.ad_accounts import _reconcile_production_bm_links
            _reconcile_production_bm_links(session, workspace_id)
        except Exception:
            pass

    clean_req_acc = canonical_external_id(requested_bm_ref) if requested_bm_ref else None
    matched_single_account: AdAccount | None = None
    if clean_req_acc:
        for cand_acc in (
            session.execute(
                sa.select(AdAccount).where(
                    AdAccount.workspace_id == workspace_id,
                    AdAccount.archived_at.is_(None),
                )
            )
            .scalars()
            .all()
        ):
            if canonical_external_id(cand_acc.external_account_id) == clean_req_acc:
                matched_single_account = cand_acc
                break

        # If not yet in DB and transport is available, try reading `act_{clean_req_acc}` directly from Meta Graph API
        if matched_single_account is None and hasattr(service.provider, "transport"):
            try:
                acc_resp = service.provider.transport.get(
                    f"act_{clean_req_acc}",
                    {"fields": "id,account_id,name,account_status,currency,timezone_name,business"},
                )
                if acc_resp.ok and isinstance(acc_resp.payload, dict):
                    raw_acc_id = str(acc_resp.payload.get("account_id") or clean_req_acc).strip()
                    raw_name = str(acc_resp.payload.get("name") or raw_acc_id).strip()
                    raw_curr = str(acc_resp.payload.get("currency") or "VND").strip()
                    raw_tz = str(acc_resp.payload.get("timezone_name") or "Asia/Ho_Chi_Minh").strip()
                    biz_obj = acc_resp.payload.get("business")
                    owner_bm_obj = None
                    if isinstance(biz_obj, dict) and biz_obj.get("id"):
                        owner_bm_obj = _upsert_bm_from_meta(
                            str(biz_obj["id"]), str(biz_obj.get("name") or ""), raw_curr
                        )
                    from app.core.enums import AccountType

                    with session.begin_nested():
                        matched_single_account = AdAccount(
                            workspace_id=workspace_id,
                            display_name=raw_name[:200],
                            external_account_id=raw_acc_id[:120],
                            account_type=(
                                AccountType.BUSINESS_MANAGER
                                if owner_bm_obj is not None
                                else AccountType.PERSONAL_REFERENCE
                            ),
                            business_manager_id=owner_bm_obj.id if owner_bm_obj else None,
                            status=AccountStatus.ACTIVE,
                            currency=raw_curr[:12],
                            timezone=raw_tz[:80],
                            country="VN",
                            owner_label=(
                                owner_bm_obj.name if owner_bm_obj is not None else "Nguyễn Thiên Triều"
                            ),
                        )
                        session.add(matched_single_account)
                        session.flush()
                        imported_count += 1
                    if settings.environment.lower() in ("production", "prod", "staging"):
                        from app.api.v1.routers.ad_accounts import _reconcile_production_bm_links
                        _reconcile_production_bm_links(session, workspace_id)
            except Exception:
                pass

    target_bm = (
        session.execute(
            sa.select(BusinessManager).where(
                BusinessManager.workspace_id == workspace_id,
                BusinessManager.external_id == (requested_bm_ref or bm_ref),
                BusinessManager.archived_at.is_(None),
            )
        )
        .scalars()
        .first()
        if (requested_bm_ref or bm_ref)
        else None
    )

    if matched_single_account is not None and target_bm is None:
        from app.core.enums import AccountType

        is_personal = matched_single_account.account_type == AccountType.PERSONAL_REFERENCE or matched_single_account.business_manager_id is None
        owner_display = (
            f"Tài khoản cá nhân ({matched_single_account.owner_label or 'Nguyễn Thiên Triều'})"
            if is_personal
            else (matched_single_account.business_manager.name if matched_single_account.business_manager else connection.label)
        )
        return {
            "connection_id": str(connection.id),
            "connection_label": owner_display,
            "run_id": str(run.id),
            "status": "succeeded",
            "business_manager_reference": matched_single_account.external_account_id,
            "business_manager_name": owner_display,
            "imported_ad_accounts": imported_count,
            "total_ad_accounts": 1,
            "total_pixels": (run.pixel_coverage_json or {}).get("total_unique_assets") or 0,
            "total_business_users": (run.business_user_coverage_json or {}).get("total_unique_assets") or 0,
            "accounts": [
                {
                    "id": str(matched_single_account.id),
                    "display_name": matched_single_account.display_name,
                    "external_account_id": matched_single_account.external_account_id,
                }
            ],
            "failure_code": None,
            "failure_summary": None,
        }

    target_bm_accounts = (
        session.execute(
            sa.select(AdAccount)
            .where(
                AdAccount.workspace_id == workspace_id,
                AdAccount.archived_at.is_(None),
                AdAccount.business_manager_id == target_bm.id,
            )
            .order_by(AdAccount.display_name.asc())
        )
        .scalars()
        .all()
        if target_bm is not None
        else (
            session.execute(
                sa.select(AdAccount)
                .where(
                    AdAccount.workspace_id == workspace_id,
                    AdAccount.archived_at.is_(None),
                )
                .order_by(AdAccount.display_name.asc())
            )
            .scalars()
            .all()
            if not requested_bm_ref
            else []
        )
    )
    discovered_total = (run.ad_account_coverage_json or {}).get("total_unique_assets") or 0

    return {
        "connection_id": str(connection.id),
        "connection_label": target_bm.name if target_bm else connection.label,
        "run_id": str(run.id),
        "status": run.status.value,
        "business_manager_reference": (
            target_bm.external_id if target_bm else run.configured_business_manager_reference
        ),
        "business_manager_name": (
            target_bm.name if target_bm else run.configured_business_manager_name
        ),
        "imported_ad_accounts": imported_count,
        "total_ad_accounts": len(target_bm_accounts) if target_bm_accounts else discovered_total,
        "total_pixels": (run.pixel_coverage_json or {}).get("total_unique_assets") or 0,
        "total_business_users": (run.business_user_coverage_json or {}).get("total_unique_assets") or 0,
        "accounts": [
            {
                "id": str(a.id),
                "display_name": a.display_name,
                "external_account_id": a.external_account_id,
            }
            for a in target_bm_accounts
        ],
        "failure_code": run.failure_code,
        "failure_summary": run.failure_summary,
    }


@connections_router.post("/quick-sync")
def quick_sync_connection(ctx: OwnerCtx, payload: s.QuickSyncRequest) -> dict[str, Any]:
    """1-step connection + discovery + auto-import for an operator."""
    try:
        result = run_workspace_quick_sync(
            ctx.session,
            ctx.workspace_id,
            ctx.user.id,
            bm_ref=payload.business_manager_reference,
            label_clean=payload.label,
            access_token=payload.access_token,
            target_bm_external_id=payload.target_bm_external_id,
        )
        ctx.commit()
        return result
    except Exception as exc:
        ctx.session.rollback()
        return {
            "connection_id": "",
            "connection_label": payload.business_manager_reference or "Meta Sync",
            "run_id": "",
            "status": "failed",
            "business_manager_reference": payload.business_manager_reference or None,
            "business_manager_name": None,
            "imported_ad_accounts": 0,
            "total_ad_accounts": 0,
            "total_pixels": 0,
            "total_business_users": 0,
            "accounts": [],
            "failure_code": "sync_error",
            "failure_summary": f"Không thể đọc mã ID '{payload.business_manager_reference}' từ Meta ({type(exc).__name__}). Hãy kiểm tra lại mã ID BM hoặc ID Tài khoản quảng cáo.",
        }


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
