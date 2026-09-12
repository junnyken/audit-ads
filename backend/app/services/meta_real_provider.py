"""RealMetaBusinessProvider — A10. Read-only discovery against a live Business Manager.

**The read-only guarantee here is structural, not a setting.** `create_ad_account`,
`share_ad_account_access` and `share_pixel_access` raise `MetaWriteNotEnabled`. There is no flag
that turns them on, and the transport underneath this provider (`meta_graph_transport.py`) has
no method that can issue anything but a GET. Two independent reasons a write cannot happen,
because the target chosen for A10 is a real BM rather than a sandbox.

Enabling writes is a later mini-spec that must confirm approved permissions, the target BM,
billing prerequisites, and its own explicit approval — not a line changed here.

Evidence-first, per CLAUDE.md rule 4: a capability this provider cannot *confirm* comes back
`False` with a reason, never assumed `True`. A token that is missing, expired or lacking a
permission produces "no, and here is why", not an optimistic guess.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from app.core.enums import BusinessAuthority
from app.services.extension_context import canonical_external_id
from app.services.meta_graph_transport import GraphResponse, MetaGraphTransport
from app.services.meta_provider import (
    AssetDiscovery,
    CapabilityCheck,
    CreateAccountRequest,
    CreateAccountResult,
    DiscoveredAsset,
    EdgeOutcome,
    MetaBusinessProvider,
    MetaFailureCode,
    MetaWriteNotEnabled,
    ProviderIdentity,
    ShareAccessRequest,
    ShareAccessResult,
    SharePixelRequest,
    SharePixelResult,
)

#: Re-exported so existing imports of `meta_real_provider.MetaWriteNotEnabled` keep working.
#: It is defined on the interface because the batch engines must recognise it without depending
#: on this module — see the definition in `meta_provider.py`.
__all__ = ["MetaWriteNotEnabled", "RealMetaBusinessProvider", "build_real_provider"]


#: A Business Manager holds ad accounts it *owns* and ad accounts clients have *shared into* it,
#: and Meta puts them on two different edges. Reading only `owned_ad_accounts` produces an
#: inventory that looks complete and is not — and "absent from a complete inventory" is exactly
#: what licenses `missing_from_latest_discovery`. Both are read, each edge's outcome is reported
#: separately, and a run that could not read one of them is not complete.
#:
#: `owned_ad_accounts` and `adspixels` were verified against Meta's documentation on 2026-09-10.
#: `client_ad_accounts` had no retrievable reference page, so it was verified against a real BM
#: instead: it answers, under the same permissions.
#:
#: That live run also showed why both edges are read. The BM held four ad accounts, split two
#: and two across the edges. Reading only `owned_ad_accounts` — the edge the official guide
#: documents — would have returned two of four while still reporting a complete run, and
#: reconciliation would then have called the other two missing.
AD_ACCOUNT_EDGES: tuple[str, ...] = ("owned_ad_accounts", "client_ad_accounts")
PIXEL_EDGES: tuple[str, ...] = ("adspixels",)

#: Allowlisted fields only. The raw row never leaves this module.
AD_ACCOUNT_FIELDS = "id,account_id,name,account_status,currency,timezone_name"
PIXEL_FIELDS = "id,name"

#: Bounded by construction: at most `MAX_PAGES * PAGE_SIZE` items per edge. Hitting the cap sets
#: `truncated`, which makes the discovery incomplete — a bounded read is not a full inventory.
PAGE_SIZE = 100
MAX_PAGES = 10


def _next_cursor(payload: dict[str, Any]) -> str | None:
    """The `after` cursor, but only when Meta says another page exists.

    `paging.cursors.after` is present on the *last* page too, so paging on it alone would ask
    for the same empty page until the cap stopped it — and that would report `truncated`, which
    would wrongly mark a complete read as incomplete. `paging.next` is the actual signal.
    """
    paging = payload.get("paging")
    if not isinstance(paging, dict) or not paging.get("next"):
        return None
    cursors = paging.get("cursors")
    return cursors.get("after") if isinstance(cursors, dict) else None


def _ad_account_from_row(row: dict[str, Any], edge: str) -> DiscoveredAsset | None:
    """`account_id` is the bare number; `id` is the same account written `act_<number>`.

    Both are canonicalised through A5's `canonical_external_id`, the normalisation this product
    already uses for ad account ids, rather than inventing a second notion of identity.
    """
    external_id = canonical_external_id(row.get("account_id") or row.get("id"))
    if not external_id:
        return None
    metadata = {
        key: str(row[key])
        for key in ("account_status", "currency", "timezone_name")
        if row.get(key) is not None
    }
    return DiscoveredAsset(
        external_id=external_id,
        name=str(row.get("name") or ""),
        source_edge=edge,
        safe_metadata=metadata,
    )


def _pixel_from_row(row: dict[str, Any], edge: str) -> DiscoveredAsset | None:
    external_id = canonical_external_id(row.get("id"))
    if not external_id:
        return None
    return DiscoveredAsset(
        external_id=external_id, name=str(row.get("name") or ""), source_edge=edge
    )


@dataclass
class RealMetaBusinessProvider(MetaBusinessProvider):
    """Talks to a live Business Manager, and can only read from it."""

    #: Deliberately not annotated: an annotation would make this a dataclass field and put it in
    #: the constructor, where a caller could switch it off. It is a fact about the class.
    writes_are_real = True

    transport: MetaGraphTransport
    #: The Business Manager to read, because Meta will not name it for a system user token.
    #:
    #: Established live on 2026-09-10 against a real BM, not assumed: the system user had 16
    #: assets assigned and could read its Business Manager by id, yet `business` as a field on
    #: the user node returned `invalid_request` (no such field) and `businesses` — as both an
    #: expanded field and an edge — returned an empty payload. A system user belongs to exactly
    #: one business and Meta declines to say which, so the id has to come from configuration.
    #:
    #: Empty means "not configured", which surfaces as a `False` capability with reason
    #: `NOT_CONFIGURED`. It never degrades into a silent success.
    business_id: str = ""
    #: A10.3. Authority is asked once per Business Manager per provider instance: ad accounts and
    #: Pixels of the same empty BM would otherwise each spend a call to learn the same fact.
    _authority_cache: dict[str, BusinessAuthority] = field(default_factory=dict)

    # ------------------------------------------------------------------ read

    def _read_business_managers(self, limit: str = "100") -> tuple[list[dict[str, str]], GraphResponse]:
        """The one place that knows how a Business Manager is reached.

        Both public readers go through it, so a capability check and the listing it gates can
        never disagree about what is visible — which is exactly the failure this replaced.
        """
        if self.business_id:
            response = self.transport.get(self.business_id, {"fields": "id,name"})
            identifier = response.payload.get("id") if response.ok else None
            if not identifier:
                return [], response
            return [
                {"external_id": str(identifier), "name": str(response.payload.get("name", ""))}
            ], response

        # No configured id: fall back to the edge, which does work for an ordinary user token.
        response = self.transport.get("me/businesses", {"fields": "id,name", "limit": limit})
        if not response.ok:
            return [], response
        rows = response.payload.get("data", [])
        return [
            {"external_id": str(row.get("id", "")), "name": str(row.get("name", ""))}
            for row in rows
            if isinstance(row, dict) and row.get("id")
        ], response

    def check_capability(self) -> CapabilityCheck:
        """One bounded call. Never runs on a page load or a timer — only when an operator
        explicitly asks (`POST /meta-connections/{id}/check-capability`), because rate limit
        budget on a real BM is a real cost.

        What it can honestly answer is "can this token list this BM". Whether the token may
        *create* an account or *share* access is not asserted from a read: this build cannot
        perform those operations at all, so claiming otherwise would be fabricating a positive.
        """
        found, response = self._read_business_managers(limit="1")
        if not response.ok:
            return CapabilityCheck(
                list_business_managers=False,
                create_ad_account=False,
                share_ad_account_access=False,
                share_pixel_access=False,
                reason=response.failure_code,
            )
        if not found:
            # A 200 carrying nothing. Under rule 4 that is absence of evidence, not evidence of
            # access, so it must not report `True` — the earlier version did, and a connection
            # that could discover nothing was persisted as "capability confirmed".
            return CapabilityCheck(
                list_business_managers=False,
                create_ad_account=False,
                share_ad_account_access=False,
                share_pixel_access=False,
                reason=MetaFailureCode.NOT_CONFIGURED,
            )
        return CapabilityCheck(
            list_business_managers=True,
            # Not `True`: writes are not enabled in this build, so a capability check must not
            # report that they are available. `NOT_SUPPORTED` says why, rather than leaving the
            # operator to guess from three bare `false`s.
            create_ad_account=False,
            share_ad_account_access=False,
            share_pixel_access=False,
            reason=MetaFailureCode.NOT_SUPPORTED,
        )

    def list_business_managers(self) -> list[dict[str, str]]:
        """Returns `[]` on failure rather than raising: an empty list is how the rest of this
        product already represents "nothing confirmed", and the failure is visible through
        `check_capability`'s reason on the same connection."""
        found, _ = self._read_business_managers()
        return found

    def identify(self) -> ProviderIdentity:
        """One read. `me` resolves to the system user this token belongs to.

        Recorded with every run because the inventory depends on it: the same BM returned four
        ad accounts to an Employee system user and eight to an Admin one on 2026-09-11. A run is
        evidence about what *this* identity could see, never about the Business Manager alone.

        A failure here is not fatal — an unknown identity is reported as unknown rather than
        blocking a discovery that would otherwise work.
        """
        response = self.transport.get("me", {"fields": "id,name"})
        if not response.ok:
            return ProviderIdentity()
        identifier = response.payload.get("id")
        return ProviderIdentity(
            external_id=str(identifier) if identifier else None,
            name=str(response.payload.get("name") or ""),
        )

    def discover_ad_accounts(self, business_id: str) -> AssetDiscovery:
        return self._discover(business_id, AD_ACCOUNT_EDGES, AD_ACCOUNT_FIELDS, _ad_account_from_row)

    def discover_pixels(self, business_id: str) -> AssetDiscovery:
        return self._discover(business_id, PIXEL_EDGES, PIXEL_FIELDS, _pixel_from_row)

    def _discover(
        self,
        business_id: str,
        edges: tuple[str, ...],
        fields: str,
        mapper: Callable[[dict[str, Any], str], DiscoveredAsset | None],
    ) -> AssetDiscovery:
        if not business_id:
            # No BM to read. Reported per edge as `not_configured` so the result is still a
            # complete description of what was attempted — which was nothing.
            return AssetDiscovery(
                edges=tuple(
                    EdgeOutcome(edge, ok=False, failure_code=MetaFailureCode.NOT_CONFIGURED)
                    for edge in edges
                ),
                required_edges=edges,
            )

        assets: list[DiscoveredAsset] = []
        outcomes: list[EdgeOutcome] = []
        seen: set[str] = set()
        for edge in edges:
            edge_assets, outcome = self._read_edge(business_id, edge, fields, mapper)
            outcomes.append(outcome)
            for asset in edge_assets:
                # An account can legitimately appear on more than one edge. Counting it twice
                # would inflate the inventory and produce a duplicate reconciliation row.
                if asset.external_id in seen:
                    continue
                seen.add(asset.external_id)
                assets.append(asset)
        return AssetDiscovery(
            assets=tuple(assets),
            edges=tuple(outcomes),
            required_edges=edges,
            # Asked only when nothing came back. Assets are their own proof of authority, so the
            # common case costs no extra call and records `not_checked` — this field says what an
            # explicit check answered, never what was inferred. Claiming `established` here would
            # put two different values on the same Business Manager's two asset types and leave
            # the run-level summary to pick a winner.
            authority=(
                self.check_business_authority(business_id)
                if not assets
                else BusinessAuthority.NOT_CHECKED
            ),
        )

    def check_business_authority(self, business_id: str) -> BusinessAuthority:
        """Ask Meta something only a member of this Business Manager can read.

        `{business-id}/system_users` is that question: measured 2026-09-11, it returned rows for
        the Business Manager this token administers and `permission_missing` for two it has no
        role in — while those same two answered `200` with an empty list on every asset edge.

        A refusal is recorded as `not_established`, never as proof of non-membership: reading
        this edge can itself require an admin role, so a narrow-but-real member would also be
        refused. Both readings forbid concluding an asset is missing, which is all this gate
        needs to decide.
        """
        if not business_id:
            return BusinessAuthority.NOT_CHECKED
        if business_id in self._authority_cache:
            return self._authority_cache[business_id]
        response = self.transport.get(f"{business_id}/system_users", {"fields": "id"})
        authority = (
            BusinessAuthority.ESTABLISHED if response.ok else BusinessAuthority.NOT_ESTABLISHED
        )
        self._authority_cache[business_id] = authority
        return authority

    def _read_edge(
        self,
        business_id: str,
        edge: str,
        fields: str,
        mapper: Callable[[dict[str, Any], str], DiscoveredAsset | None],
    ) -> tuple[list[DiscoveredAsset], EdgeOutcome]:
        collected: list[DiscoveredAsset] = []
        cursor: str | None = None
        pages = 0
        while pages < MAX_PAGES:
            params = {"fields": fields, "limit": str(PAGE_SIZE)}
            if cursor:
                params["after"] = cursor
            response = self.transport.get(f"{business_id}/{edge}", params)
            if not response.ok:
                # Whatever was already collected is returned alongside the failure: it is real
                # data. The edge is `ok=False`, so the discovery is incomplete and cannot be
                # used to conclude anything is missing.
                return collected, EdgeOutcome(
                    edge,
                    ok=False,
                    pages_read=pages,
                    items=len(collected),
                    failure_code=response.failure_code,
                )
            pages += 1
            for row in response.payload.get("data", []):
                if isinstance(row, dict) and (asset := mapper(row, edge)) is not None:
                    collected.append(asset)
            cursor = _next_cursor(response.payload)
            if not cursor:
                return collected, EdgeOutcome(
                    edge, ok=True, pages_read=pages, items=len(collected)
                )
        return collected, EdgeOutcome(
            edge, ok=True, pages_read=pages, items=len(collected), truncated=True
        )

    # ----------------------------------------------------------------- write

    def create_ad_account(self, request: CreateAccountRequest) -> CreateAccountResult:
        raise MetaWriteNotEnabled(
            "Creating an ad account against a real Meta connection is not enabled in this build."
        )

    def share_ad_account_access(self, request: ShareAccessRequest) -> ShareAccessResult:
        raise MetaWriteNotEnabled(
            "Sharing ad-account access against a real Meta connection is not enabled in this build."
        )

    def share_pixel_access(self, request: SharePixelRequest) -> SharePixelResult:
        raise MetaWriteNotEnabled(
            "Sharing Pixel access against a real Meta connection is not enabled in this build."
        )

    def reconcile_create(self, idempotency_key: str) -> CreateAccountResult | None:
        """Nothing this provider did could have created anything, so there is nothing to
        reconcile. `None` is the interface's own "no answer available"."""
        return None

    # ------------------------------------------------------------ diagnostics

    def probe(self) -> tuple[list[dict[str, str]], GraphResponse]:
        """The operator-run live verification. Not reachable from any route — a script calls it,
        a human reads it.

        It goes through `_read_business_managers()` like every other reader. It did not, once:
        it asked `me/businesses` directly, so a run with `META_BUSINESS_ID` configured reported
        zero Business Managers while `check_capability()` — reading the configured BM node —
        could see one. The live probe contradicted the product on the same token, which is the
        precise failure the shared helper exists to make impossible. A third reader outside the
        helper is the bug, not the endpoint it happened to pick.
        """
        return self._read_business_managers(limit="1")


def build_real_provider(settings) -> RealMetaBusinessProvider:
    return RealMetaBusinessProvider(
        transport=MetaGraphTransport(
            access_token=settings.meta_access_token,
            api_base_url=settings.meta_graph_api_base_url,
            api_version=settings.meta_graph_api_version,
            timeout_seconds=settings.meta_timeout_seconds,
        ),
        business_id=settings.meta_business_id,
    )
