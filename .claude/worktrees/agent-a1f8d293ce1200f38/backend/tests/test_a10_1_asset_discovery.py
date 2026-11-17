"""A10.1 — read-only discovery of ad accounts and Pixels under a configured Business Manager.

**Nothing here touches the network.** Every test drives a scripted stub transport. A real call
from this file would mean CI reading someone's live Business Manager on every run.

The invariant these tests exist to protect: a discovery is `complete` only when every edge it
needed answered *and* nothing was truncated. Only a complete discovery may later license the
conclusion `missing_from_latest_discovery`, because "absent" is only meaningful against a full
inventory. A10 shipped a bug where a capability was inferred from transport success alone; the
same shape of mistake here would delete-by-implication.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

from app.core.enums import BusinessAuthority, CoverageStatus
from app.services.meta_graph_transport import GraphResponse
from app.services.meta_provider import (
    AssetDiscovery,
    DiscoveredAsset,
    EdgeOutcome,
    MetaFailureCode,
    reset_fake_provider,
)
from app.services.meta_real_provider import (
    AD_ACCOUNT_EDGES,
    MAX_PAGES,
    PIXEL_EDGES,
    RealMetaBusinessProvider,
)

BM = "1993884657458857"


@dataclass
class ScriptedTransport:
    """Answers from a script and records what was asked. An unscripted call is a test bug, so
    it raises rather than quietly returning something plausible."""

    responses: list[GraphResponse]
    calls: list[tuple[str, dict[str, Any] | None]] = field(default_factory=list)

    def get(self, path: str, params: dict[str, Any] | None = None) -> GraphResponse:
        self.calls.append((path, params))
        if not self.responses:
            raise AssertionError(f"unscripted call to {path}")
        return self.responses.pop(0)


def _page(rows: list[dict], *, has_next: bool = False, after: str = "CUR") -> GraphResponse:
    """One Graph page. Note `cursors.after` is present either way — Meta sends it on the last
    page too, which is exactly the trap `_next_cursor` has to avoid."""
    paging: dict[str, Any] = {"cursors": {"after": after}}
    if has_next:
        paging["next"] = "https://graph.facebook.com/v21.0/next-page"
    return GraphResponse(ok=True, payload={"data": rows, "paging": paging})


def _provider(*responses: GraphResponse) -> tuple[RealMetaBusinessProvider, ScriptedTransport]:
    transport = ScriptedTransport(list(responses))
    return RealMetaBusinessProvider(transport=transport, business_id=BM), transport  # type: ignore[arg-type]


# ------------------------------------------------------------------- edge coverage


def test_ad_account_discovery_reads_both_the_owned_and_the_client_edge():
    """A BM holds accounts it owns and accounts clients shared into it. Reading one edge yields
    an inventory that looks complete and is not."""
    provider, transport = _provider(
        _page([{"account_id": "111", "name": "Owned"}]),
        _page([{"account_id": "222", "name": "Client"}]),
    )
    result = provider.discover_ad_accounts(BM)

    assert [path for path, _ in transport.calls] == [
        f"{BM}/owned_ad_accounts",
        f"{BM}/client_ad_accounts",
    ]
    assert {asset.external_id for asset in result.assets} == {"111", "222"}
    assert result.complete is True


def test_each_asset_records_which_edge_produced_it():
    provider, _ = _provider(
        _page([{"account_id": "111", "name": "Owned"}]),
        _page([{"account_id": "222", "name": "Client"}]),
    )
    by_id = {a.external_id: a.source_edge for a in provider.discover_ad_accounts(BM).assets}

    assert by_id == {"111": "owned_ad_accounts", "222": "client_ad_accounts"}


def test_a_refused_edge_makes_the_whole_discovery_incomplete():
    """The unresolved case: `client_ad_accounts` could not be verified in Meta's docs. If Meta
    refuses it, the run must be incomplete rather than silently narrower — otherwise a
    client-shared account in the registry gets called missing by a scan that never looked."""
    provider, _ = _provider(
        _page([{"account_id": "111", "name": "Owned"}]),
        GraphResponse(ok=False, failure_code=MetaFailureCode.PERMISSION_MISSING),
    )
    result = provider.discover_ad_accounts(BM)

    assert result.complete is False
    assert result.reason == MetaFailureCode.PERMISSION_MISSING
    # What the good edge returned is still real data and is kept.
    assert [asset.external_id for asset in result.assets] == ["111"]


def test_an_account_on_both_edges_is_counted_once():
    provider, _ = _provider(
        _page([{"account_id": "111", "name": "Shared both ways"}]),
        _page([{"account_id": "111", "name": "Shared both ways"}]),
    )
    result = provider.discover_ad_accounts(BM)

    assert [asset.external_id for asset in result.assets] == ["111"]


# --------------------------------------------------------------------- pagination


def test_pagination_follows_the_next_link_and_accumulates_pages():
    provider, transport = _provider(
        _page([{"account_id": "1"}], has_next=True, after="A1"),
        _page([{"account_id": "2"}]),
        _page([]),  # client edge
    )
    result = provider.discover_ad_accounts(BM)

    assert {a.external_id for a in result.assets} == {"1", "2"}
    assert transport.calls[1][1] is not None
    assert transport.calls[1][1]["after"] == "A1"
    assert result.complete is True


def test_a_trailing_cursor_without_a_next_link_ends_the_read():
    """Meta returns `cursors.after` on the final page too. Paging on it alone would re-request
    until the cap, then report `truncated` — marking a complete read incomplete, which would
    suppress every legitimate `missing_from_latest_discovery` forever."""
    provider, transport = _provider(_page([{"id": "9"}]))
    result = provider.discover_pixels(BM)

    assert len(transport.calls) == 1
    assert result.complete is True
    assert result.edges[0].pages_read == 1


def test_hitting_the_page_cap_is_reported_as_truncated_and_incomplete():
    provider, _ = _provider(*[_page([{"id": str(n)}], has_next=True) for n in range(MAX_PAGES)])
    result = provider.discover_pixels(BM)

    assert result.edges[0].truncated is True
    assert result.edges[0].pages_read == MAX_PAGES
    assert result.complete is False
    # A bounded read is not a failure — the items collected are real.
    assert len(result.assets) == MAX_PAGES


def test_pixel_discovery_reads_only_the_adspixels_edge():
    provider, transport = _provider(_page([{"id": "555", "name": "Main Pixel"}]))
    result = provider.discover_pixels(BM)

    assert [path for path, _ in transport.calls] == [f"{BM}/adspixels"]
    assert result.assets[0].external_id == "555"
    assert PIXEL_EDGES == ("adspixels",)


# ------------------------------------------------------------------------ identity


def test_act_prefixed_and_bare_ids_canonicalise_to_the_same_account():
    """Meta writes an ad account as `act_123` on `id` and `123` on `account_id`, and the
    registry stores whichever form an operator typed. Comparing raw strings would report the
    same account as both missing from the registry and missing from discovery."""
    provider, _ = _provider(_page([{"id": "act_123", "name": "Prefixed"}]), _page([]))
    from_id = provider.discover_ad_accounts(BM).assets[0].external_id

    provider2, _ = _provider(_page([{"account_id": "123", "name": "Bare"}]), _page([]))
    from_account_id = provider2.discover_ad_accounts(BM).assets[0].external_id

    assert from_id == from_account_id == "123"


def test_a_row_without_a_usable_id_is_dropped_rather_than_invented():
    provider, _ = _provider(_page([{"name": "No id at all"}, {"account_id": "7"}]), _page([]))
    result = provider.discover_ad_accounts(BM)

    assert [asset.external_id for asset in result.assets] == ["7"]


# ------------------------------------------------------------- normalisation / safety


def test_only_allowlisted_metadata_survives_normalisation():
    """Guardrail: no raw provider payload travels downstream."""
    provider, _ = _provider(
        _page(
            [
                {
                    "account_id": "111",
                    "name": "Acct",
                    "currency": "VND",
                    "timezone_name": "Asia/Ho_Chi_Minh",
                    "account_status": 1,
                    "funding_source_details": {"id": "should never appear"},
                    "owner_business": {"id": "nor this"},
                }
            ]
        ),
        _page([]),
    )
    asset = provider.discover_ad_accounts(BM).assets[0]

    assert asset.safe_metadata == {
        "account_status": "1",
        "currency": "VND",
        "timezone_name": "Asia/Ho_Chi_Minh",
    }
    assert "funding_source_details" not in asset.safe_metadata
    assert "owner_business" not in asset.safe_metadata


def test_an_unconfigured_business_id_never_reaches_the_network():
    transport = ScriptedTransport([])  # any call at all raises
    provider = RealMetaBusinessProvider(transport=transport, business_id="")  # type: ignore[arg-type]

    result = provider.discover_ad_accounts("")

    assert transport.calls == []
    assert result.complete is False
    assert result.reason == MetaFailureCode.NOT_CONFIGURED
    assert [edge.edge for edge in result.edges] == list(AD_ACCOUNT_EDGES)


def test_a_completed_empty_scan_is_complete_when_authority_was_established():
    """An empty result is a valid observation, not a failure. It must not read as either
    'discovery broken' or 'assets confirmed absent from Meta'.

    A10.3 added the third page: an empty inventory now has to prove the token may read this
    Business Manager at all, and `{bm}/system_users` answering is that proof.
    """
    provider, _ = _provider(_page([]), _page([]), _page([{"id": "sysuser-1"}]))
    result = provider.discover_ad_accounts(BM)

    assert result.assets == ()
    assert result.authority == BusinessAuthority.ESTABLISHED
    assert result.complete is True
    assert result.reason is None


def test_an_empty_scan_of_an_unreadable_business_manager_is_never_complete():
    """Measured against real Meta on 2026-09-11: a token with no role in a BM still reads the BM
    node and gets `200` with `[]` from every asset edge, while `{bm}/system_users` refuses. An
    error-free empty inventory is therefore not evidence that the BM is empty, and `complete` is
    what licenses `missing_from_latest_discovery`."""
    provider, _ = _provider(
        _page([]),
        _page([]),
        GraphResponse(ok=False, payload={}, failure_code=MetaFailureCode.PERMISSION_MISSING),
    )
    result = provider.discover_ad_accounts(BM)

    assert result.assets == ()
    assert result.authority == BusinessAuthority.NOT_ESTABLISHED
    assert result.coverage_status == CoverageStatus.UNKNOWN
    assert result.complete is False
    # No edge failed, so there is no edge-level reason to report. That is precisely why this
    # case needed a dimension of its own rather than another failure code.
    assert result.reason is None


def test_authority_is_asked_once_per_business_manager_not_once_per_asset_type():
    """Ad accounts and Pixels of the same empty BM would otherwise each spend a call to learn
    the same fact, on a token whose rate-limit budget is shared across the whole app."""
    provider, transport = _provider(
        _page([]),
        _page([]),
        _page([{"id": "sysuser-1"}]),
        _page([]),
    )

    provider.discover_ad_accounts(BM)
    provider.discover_pixels(BM)

    authority_calls = [path for path, _ in transport.calls if path.endswith("/system_users")]
    assert len(authority_calls) == 1


def test_a_non_empty_inventory_is_never_charged_for_an_authority_check():
    """Assets that came back are their own proof, so the check is not spent — and the field
    records `not_checked` rather than an inferred `established`. Inferring would put two
    different authority values on one Business Manager's two asset types, and leave the
    run-level summary to pick a winner between them."""
    provider, transport = _provider(
        _page([{"account_id": "111", "name": "Owned"}]),
        _page([]),
    )

    result = provider.discover_ad_accounts(BM)

    assert result.authority == BusinessAuthority.NOT_CHECKED
    assert result.complete is True
    assert not [path for path, _ in transport.calls if path.endswith("/system_users")]


# ----------------------------------------------------------------------- coverage rules

AD_EDGES = ("owned_ad_accounts", "client_ad_accounts")


def _ad_coverage(
    *edges: EdgeOutcome,
    assets: tuple[DiscoveredAsset, ...] = (),
    authority: BusinessAuthority = BusinessAuthority.ESTABLISHED,
) -> AssetDiscovery:
    """`authority` defaults to established: these cases are about *edge* coverage, so the premise
    is a Business Manager the token demonstrably may read. A10.3 made that premise explicit —
    without it, an empty inventory is no longer evidence of an empty Business Manager."""
    return AssetDiscovery(
        assets=assets, edges=edges, required_edges=AD_EDGES, authority=authority
    )


def _ok(edge: str) -> EdgeOutcome:
    return EdgeOutcome(edge, ok=True, pages_read=1)


def _failed(edge: str, code: MetaFailureCode) -> EdgeOutcome:
    return EdgeOutcome(edge, ok=False, pages_read=0, failure_code=code)


def test_both_edges_completed_is_complete_coverage():
    result = _ad_coverage(_ok("owned_ad_accounts"), _ok("client_ad_accounts"))

    assert result.coverage_status == CoverageStatus.COMPLETE
    assert result.complete is True


def test_a_successful_empty_edge_still_counts_as_covered():
    """Empty-completed is not the same as failed. A client edge that answers with nothing has
    been read; refusing to call that coverage would block every legitimate absence conclusion
    for a BM that simply has no client accounts."""
    result = _ad_coverage(_ok("owned_ad_accounts"), _ok("client_ad_accounts"))

    assert result.coverage_status == CoverageStatus.COMPLETE


@pytest.mark.parametrize(
    ("code", "expected"),
    [
        (MetaFailureCode.PROVIDER_SERVER_ERROR, CoverageStatus.PARTIAL),
        (MetaFailureCode.RATE_LIMITED, CoverageStatus.PARTIAL),
        (MetaFailureCode.TIMEOUT, CoverageStatus.PARTIAL),
        (MetaFailureCode.PERMISSION_MISSING, CoverageStatus.INCOMPLETE),
        (MetaFailureCode.NOT_SUPPORTED, CoverageStatus.INCOMPLETE),
        (MetaFailureCode.UNKNOWN_ERROR, CoverageStatus.UNKNOWN),
    ],
)
def test_one_failing_edge_denies_complete_coverage(code, expected):
    """Whatever went wrong on one edge, the union is not a full inventory, so nothing may be
    concluded absent from it."""
    result = _ad_coverage(_ok("owned_ad_accounts"), _failed("client_ad_accounts", code))

    assert result.coverage_status == expected
    assert result.complete is False


def test_a_required_edge_that_was_never_attempted_is_not_complete():
    """The invariant this whole design exists for. Nothing errored — the edge was simply not
    read — so any completeness rule based on "did anything fail" says yes, and is wrong."""
    result = _ad_coverage(_ok("owned_ad_accounts"))

    assert result.coverage_status == CoverageStatus.INCOMPLETE
    assert result.complete is False
    assert result.reason is None  # nothing failed; that is precisely the danger


def test_a_truncated_edge_is_partial_not_complete():
    result = _ad_coverage(
        EdgeOutcome("owned_ad_accounts", ok=True, pages_read=10, truncated=True),
        _ok("client_ad_accounts"),
    )

    assert result.coverage_status == CoverageStatus.PARTIAL


def test_no_edges_at_all_is_not_attempted_rather_than_empty():
    assert AssetDiscovery(required_edges=AD_EDGES).coverage_status == CoverageStatus.NOT_ATTEMPTED


def test_the_real_provider_reproduces_the_live_two_and_two_split():
    """The shape actually returned by Meta on 2026-09-10: two owned, two client, four unique."""
    provider, _ = _provider(
        _page([{"account_id": "1167063825546698", "name": "Tbsupellex"},
               {"account_id": "337574751894643", "name": "Thanh Công"}]),
        _page([{"account_id": "338551421414333", "name": "Quàng Chính"},
               {"account_id": "1221209591722645", "name": "Vũ Hiếu"}]),
    )
    result = provider.discover_ad_accounts(BM)

    assert len(result.assets) == 4
    assert result.required_edges == AD_EDGES
    assert result.coverage_status == CoverageStatus.COMPLETE
    owned = {a.external_id for a in result.assets if a.source_edge == "owned_ad_accounts"}
    client = {a.external_id for a in result.assets if a.source_edge == "client_ad_accounts"}
    assert len(owned) == 2 and len(client) == 2


def test_reading_only_the_documented_edge_cannot_report_complete():
    """The counterfactual, pinned. Had the client edge never been read, this run would have
    returned two of the four real accounts — and must not call that a full inventory."""
    result = AssetDiscovery(
        assets=(DiscoveredAsset("1167063825546698", "Tbsupellex", "owned_ad_accounts"),),
        edges=(_ok("owned_ad_accounts"),),
        required_edges=AD_EDGES,
    )

    assert result.complete is False


# ------------------------------------------------------------------- the fake provider


def test_the_fake_provider_serves_a_staged_discovery_and_records_the_call():
    fake = reset_fake_provider()
    fake.queue_ad_account_discovery(
        AssetDiscovery(
            assets=(DiscoveredAsset("111", "Acct", "owned_ad_accounts"),),
            edges=(EdgeOutcome("owned_ad_accounts", ok=True, pages_read=1),),
        )
    )
    result = fake.discover_ad_accounts(BM)

    assert result.assets[0].external_id == "111"
    assert ("discover_ad_accounts", BM) in fake.calls


def test_discovery_through_the_fake_provider_calls_no_write_method():
    """The no-write assertion the spec requires, made against a recording rather than a promise."""
    fake = reset_fake_provider()
    fake.discovered_ad_accounts.append(DiscoveredAsset("111", "Acct", "owned_ad_accounts"))
    fake.discovered_pixels.append(DiscoveredAsset("555", "Pixel", "adspixels"))

    fake.discover_ad_accounts(BM)
    fake.discover_pixels(BM)

    write_methods = {"create_ad_account", "share_ad_account_access", "share_pixel_access"}
    assert {method for method, _ in fake.calls} & write_methods == set()
    assert fake.created == [] and fake.shared == [] and fake.pixels_shared == []


def test_the_fake_provider_counts_items_per_edge_not_just_in_total():
    """Found by opening the page, not by any of the 726 tests that were already green.

    The fake left `items` at its default, so the UI showed `Ad accounts returned: 2` above
    `Completed: Owned accounts (0), Client accounts (0)`. The total was right and the breakdown
    was nonsense — and the breakdown is the evidence behind every coverage claim. Every existing
    coverage test built its `EdgeOutcome`s by hand with explicit counts, so none of them ever
    exercised the fake's own arithmetic.
    """
    fake = reset_fake_provider()
    fake.discovered_ad_accounts.extend(
        [
            DiscoveredAsset("111", "Owned one", "owned_ad_accounts"),
            DiscoveredAsset("222", "Owned two", "owned_ad_accounts"),
            DiscoveredAsset("333", "Client one", "client_ad_accounts"),
        ]
    )
    fake.discovered_pixels.append(DiscoveredAsset("555", "A pixel", "adspixels"))

    accounts = fake.discover_ad_accounts(BM)
    pixels = fake.discover_pixels(BM)

    per_edge = {edge.edge: edge.items for edge in accounts.edges}
    assert per_edge == {"owned_ad_accounts": 2, "client_ad_accounts": 1}
    assert sum(per_edge.values()) == len(accounts.assets)
    assert [edge.items for edge in pixels.edges] == [1]


def test_resetting_the_fake_provider_clears_discovery_state():
    fake = reset_fake_provider()
    fake.discovered_pixels.append(DiscoveredAsset("555", "Pixel", "adspixels"))
    fake.discover_pixels(BM)

    reset_fake_provider()

    assert fake.discovered_pixels == []
    assert fake.calls == []
