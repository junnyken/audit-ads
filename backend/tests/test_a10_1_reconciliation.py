"""A10.1 — reconciliation between discovery observations and the A1 registry.

`missing_from_latest_discovery` is the strongest conclusion this product can draw about an
asset, so it sits last in the decision tree and every earlier branch is a reason not to reach
it. These tests exist to keep it there: each one drives a case that an eager implementation
would happily call "missing" and pins the weaker, truthful answer instead.

Pixel reconciliation is deliberately asymmetric. A registry Pixel has no Business Manager
relationship to prove, so its absence from a discovery of one BM is not evidence about that BM.
That is a schema limit, not a judgement about Pixels, and lifting it needs a Pixel↔BM ownership
model rather than a foreign key added in passing.
"""
from __future__ import annotations

import pytest

from app.core.enums import (
    AssetReconciliationStatus,
    BusinessAuthority,
    CoverageStatus,
    DiscoveryRunStatus,
    MetaEnvironment,
)
from app.models.entities import AdAccount, BusinessManager, Pixel
from app.models.meta_operations import MetaConnection
from app.services.audit import AuditLogService
from app.services.meta_discovery import MetaDiscoveryService
from app.services.meta_provider import DiscoveredAsset, FakeMetaBusinessProvider

BM = "1993884657458857"
OTHER_BM = "999999999999999"


@pytest.fixture()
def audit(session, workspace, owner):
    return AuditLogService(session, workspace.id, owner["user"].id)


@pytest.fixture()
def connection(session, workspace, owner):
    row = MetaConnection(
        workspace_id=workspace.id,
        label="Fake connection",
        environment=MetaEnvironment.FAKE,
        created_by=owner["user"].id,
    )
    session.add(row)
    session.commit()
    return row


def _bm(session, workspace, external_id: str, name: str = "BM") -> BusinessManager:
    row = BusinessManager(workspace_id=workspace.id, name=name, external_id=external_id)
    session.add(row)
    session.flush()
    return row


def _account(session, workspace, external_id, *, business_manager=None, name="Account"):
    row = AdAccount(
        workspace_id=workspace.id,
        display_name=name,
        external_account_id=external_id,
        business_manager_id=business_manager.id if business_manager else None,
    )
    session.add(row)
    session.flush()
    return row


def _run_with(
    session, workspace, audit, connection, *, accounts=(), pixels=(), coverage=None,
    authority=BusinessAuthority.ESTABLISHED,
):
    """Drive a real run through the service so coverage and observations are produced the same
    way production would produce them, then override coverage when a test needs a partial one."""
    provider = FakeMetaBusinessProvider()
    provider.authority = authority
    provider.business_managers.append({"external_id": BM, "name": "Quảng Cáo Top"})
    provider.discovered_ad_accounts.extend(accounts)
    provider.discovered_pixels.extend(pixels)

    service = MetaDiscoveryService(
        session, workspace.id, audit, provider=provider, business_id=BM
    )
    run = service.validate_configured_business_manager(connection)
    assert run.status == DiscoveryRunStatus.SUCCEEDED
    service.discover_assets(run)
    if coverage is not None:
        run.ad_account_coverage_status = coverage
    session.flush()
    return service, run


def _statuses(rows, external_id):
    return [row.status for row in rows if row.external_id == external_id]


# --------------------------------------------------------------- the strongest conclusion


def test_internal_account_with_proven_configured_bm_mapping_absent_from_complete_union_is_missing_from_latest_discovery(
    session, workspace, audit, connection
):
    business_manager = _bm(session, workspace, BM, "Quảng Cáo Top")
    _account(session, workspace, "111", business_manager=business_manager, name="Gone")

    service, run = _run_with(
        session, workspace, audit, connection,
        accounts=[DiscoveredAsset("222", "Still here", "owned_ad_accounts")],
    )
    rows = service.reconcile_ad_accounts(run)

    assert run.ad_accounts_complete is True
    assert _statuses(rows, "111") == [AssetReconciliationStatus.MISSING_FROM_LATEST_DISCOVERY]


def test_an_unreadable_business_manager_never_licenses_a_missing_conclusion(
    session, workspace, audit, connection
):
    """The A10.3 case, and the one this whole gate exists for.

    Measured against real Meta on 2026-09-11: a token with no role in a Business Manager reads
    that BM's node happily and gets `200` with `[]` from every asset edge — no error anywhere.
    Before the authority gate this run reported `complete`, and `complete` is what licenses the
    strongest conclusion in the product. Every registry account mapped to that BM would have
    been reported as no longer returned by Meta, on the strength of a scan that never saw it.
    """
    business_manager = _bm(session, workspace, BM, "Quảng Cáo Top")
    _account(session, workspace, "111", business_manager=business_manager, name="Still real")

    service, run = _run_with(
        session, workspace, audit, connection,
        accounts=[],
        authority=BusinessAuthority.NOT_ESTABLISHED,
    )
    rows = service.reconcile_ad_accounts(run)

    assert run.business_authority == BusinessAuthority.NOT_ESTABLISHED
    assert run.ad_account_coverage_status == CoverageStatus.UNKNOWN
    assert run.ad_accounts_complete is False
    assert _statuses(rows, "111") == [AssetReconciliationStatus.UNKNOWN]


def test_an_empty_business_manager_the_token_can_read_still_reaches_a_missing_conclusion(
    session, workspace, audit, connection
):
    """The other half, and the reason the gate is authority rather than emptiness: a Business
    Manager that genuinely holds nothing is a real observation. Blocking it would suppress every
    legitimate absence conclusion for an emptied BM forever."""
    business_manager = _bm(session, workspace, BM, "Quảng Cáo Top")
    _account(session, workspace, "111", business_manager=business_manager, name="Gone")

    service, run = _run_with(
        session, workspace, audit, connection,
        accounts=[],
        authority=BusinessAuthority.ESTABLISHED,
    )
    rows = service.reconcile_ad_accounts(run)

    assert run.ad_accounts_complete is True
    assert _statuses(rows, "111") == [AssetReconciliationStatus.MISSING_FROM_LATEST_DISCOVERY]


def test_internal_account_without_proven_configured_bm_mapping_absent_from_complete_union_is_out_of_scope(
    session, workspace, audit, connection
):
    """No BM mapping means there is nothing to be absent *from*."""
    _account(session, workspace, "111", business_manager=None, name="Unmapped")

    service, run = _run_with(session, workspace, audit, connection, accounts=[])
    rows = service.reconcile_ad_accounts(run)

    assert _statuses(rows, "111") == [AssetReconciliationStatus.OUT_OF_SCOPE]


def test_internal_account_mapped_to_different_bm_is_out_of_scope(
    session, workspace, audit, connection
):
    other = _bm(session, workspace, OTHER_BM, "Another business")
    _account(session, workspace, "111", business_manager=other, name="Elsewhere")

    service, run = _run_with(session, workspace, audit, connection, accounts=[])
    rows = service.reconcile_ad_accounts(run)

    assert _statuses(rows, "111") == [AssetReconciliationStatus.OUT_OF_SCOPE]


@pytest.mark.parametrize(
    "coverage",
    [CoverageStatus.PARTIAL, CoverageStatus.INCOMPLETE, CoverageStatus.UNKNOWN],
)
def test_internal_account_absent_from_partial_or_incomplete_coverage_is_unknown_not_missing(
    session, workspace, audit, connection, coverage
):
    """Everything else about this account qualifies it as missing. Coverage alone withholds it."""
    business_manager = _bm(session, workspace, BM, "Quảng Cáo Top")
    _account(session, workspace, "111", business_manager=business_manager, name="Maybe gone")

    service, run = _run_with(session, workspace, audit, connection, accounts=[], coverage=coverage)
    rows = service.reconcile_ad_accounts(run)

    assert _statuses(rows, "111") == [AssetReconciliationStatus.UNKNOWN]


def test_exact_external_id_match_wins_before_scope_absence_classification(
    session, workspace, audit, connection
):
    """The account was demonstrably returned by this run. Whatever the internal mapping says, it
    is present — calling it out-of-scope or missing would contradict direct evidence."""
    other = _bm(session, workspace, OTHER_BM, "Another business")
    _account(session, workspace, "111", business_manager=other, name="Mapped oddly")

    service, run = _run_with(
        session, workspace, audit, connection,
        accounts=[DiscoveredAsset("111", "Mapped oddly", "client_ad_accounts")],
    )
    rows = service.reconcile_ad_accounts(run)

    assert _statuses(rows, "111") == [AssetReconciliationStatus.MATCHED]


def test_an_act_prefixed_registry_id_still_matches_a_bare_discovered_id(
    session, workspace, audit, connection
):
    """The registry stores whatever an operator typed; Meta writes `act_` inconsistently."""
    _account(session, workspace, "act_111", name="Prefixed in the registry")

    service, run = _run_with(
        session, workspace, audit, connection,
        accounts=[DiscoveredAsset("111", "Bare from Meta", "owned_ad_accounts")],
    )
    rows = service.reconcile_ad_accounts(run)

    assert _statuses(rows, "111") == [AssetReconciliationStatus.MATCHED]


def test_a_discovered_account_with_no_registry_record_is_missing_in_registry(
    session, workspace, audit, connection
):
    service, run = _run_with(
        session, workspace, audit, connection,
        accounts=[DiscoveredAsset("777", "Never imported", "owned_ad_accounts")],
    )
    rows = service.reconcile_ad_accounts(run)

    assert _statuses(rows, "777") == [AssetReconciliationStatus.MISSING_IN_REGISTRY]


# ------------------------------------------------------------------------ pixels


def test_discovered_pixel_without_exact_registry_match_is_missing_in_registry(
    session, workspace, audit, connection
):
    service, run = _run_with(
        session, workspace, audit, connection,
        pixels=[DiscoveredAsset("555", "Pixel của TBsupellex", "adspixels")],
    )
    rows = service.reconcile_pixels(run)

    assert _statuses(rows, "555") == [AssetReconciliationStatus.MISSING_IN_REGISTRY]


def test_registry_pixel_absent_from_completed_discovery_is_out_of_scope_without_proven_bm_mapping(
    session, workspace, audit, connection
):
    """The coverage was complete and the Pixel was not returned — and it still may not be called
    missing, because nothing records which BM this Pixel belongs to."""
    session.add(Pixel(workspace_id=workspace.id, name="Orphan pixel", external_pixel_id="555"))
    session.flush()

    service, run = _run_with(session, workspace, audit, connection, pixels=[])
    rows = service.reconcile_pixels(run)

    assert run.pixels_complete is True
    assert _statuses(rows, "555") == [AssetReconciliationStatus.OUT_OF_SCOPE]
    detail = next(row.detail for row in rows if row.external_id == "555")
    assert "mapping is not recorded" in detail
    # Never the words that would imply Meta deleted it.
    assert "deleted" not in detail.lower() and "removed" not in detail.lower()


def test_a_registry_pixel_returned_by_discovery_is_matched(
    session, workspace, audit, connection
):
    session.add(Pixel(workspace_id=workspace.id, name="Known pixel", external_pixel_id="555"))
    session.flush()

    service, run = _run_with(
        session, workspace, audit, connection,
        pixels=[DiscoveredAsset("555", "Known pixel", "adspixels")],
    )
    rows = service.reconcile_pixels(run)

    assert _statuses(rows, "555") == [AssetReconciliationStatus.MATCHED]
