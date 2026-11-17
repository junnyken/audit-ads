"""O3 — automatic import by the discovery sweep. Fake provider behind the one seam.

What an automatic import may and may not do to the registry: import what the run returned and
the registry lacks, exactly as a person's click would; never touch an account it already has;
never re-import or restore an archived one; lose a race gracefully; never import when the owner
allowed discovery only.
"""
from __future__ import annotations

import sqlalchemy as sa

from app.commands.run_dispatcher import discovery_sweep_pass
from app.core.enums import ReadinessStatus
from app.models.entities import AdAccount, BusinessManager
from app.services import discovery_sweep as sweep_module
from tests.o3_helpers import (
    HUB,
    audit_rows,
    automatic_connection,
    stage,
)
from tests.s1_spend_helpers import make_account, make_bm


def accounts(db_session) -> dict[str, AdAccount]:
    db_session.expire_all()
    return {
        row.external_account_id: row
        for row in db_session.execute(sa.select(AdAccount)).scalars().all()
    }


def test_owned_and_client_accounts_are_imported_under_the_hub(api, db_session, sweep_env):
    automatic_connection(api)
    stage(sweep_env["provider"], ("111", "owned_ad_accounts"), ("222", "client_ad_accounts"))

    totals = discovery_sweep_pass(batch=5)

    assert totals["imported"] == 2
    rows = accounts(db_session)
    assert set(rows) == {"111", "222"}
    hubs = db_session.execute(sa.select(BusinessManager)).scalars().all()
    assert [bm.external_id for bm in hubs] == [HUB], "one Business Manager row: the hub"
    for row in rows.values():
        assert row.business_manager_id == hubs[0].id
        # Seen in Meta is not ready to run, and a discovery is not a sync.
        assert row.readiness_status == ReadinessStatus.UNKNOWN
        assert row.last_synced_at is None


def test_the_provenance_says_automatic_and_names_the_owning_business_manager(api, db_session, sweep_env):
    automatic_connection(api)
    stage(
        sweep_env["provider"],
        ("222", "client_ad_accounts"),
        ("333", "client_ad_accounts"),
        owners={"222": ("7770001", "Partner Shop")},
    )
    discovery_sweep_pass(batch=5)
    rows = accounts(db_session)

    shared = api.get(f"/api/v1/ad-accounts/{rows['222'].id}").json()["imported_from_discovery"]
    assert shared["trigger"] == "scheduled_sweep" and shared["automatic"] is True
    assert shared["source_edge"] == "client_ad_accounts"
    assert shared["owner_business_reference"] == "7770001"
    assert shared["owner_business_name"] == "Partner Shop"
    unknown = api.get(f"/api/v1/ad-accounts/{rows['333'].id}").json()["imported_from_discovery"]
    assert unknown["owner_business_reference"] is None, "not returned is not guessed"

    (row,) = [r for r in audit_rows(db_session, "meta_discovery.ad_account_auto_imported") if r.entity_id == str(rows["222"].id)]
    assert row.metadata_json["decision"] == "imported"
    assert row.metadata_json["trigger"] == "scheduled_sweep"
    assert row.metadata_json["owner_business_reference"] == "7770001"


def test_an_account_already_in_the_registry_is_not_touched(api, db_session, sweep_env):
    bm = make_bm(api, HUB, "Hub BM")
    existing = make_account(api, bm=bm, external_id="act_111", name="Typed by hand")
    automatic_connection(api)
    stage(sweep_env["provider"], ("111", "owned_ad_accounts"))

    totals = discovery_sweep_pass(batch=5)

    assert totals["imported"] == 0 and totals["already_in_registry"] == 1
    rows = accounts(db_session)
    assert list(rows) == ["act_111"], "the act_ form matched by canonical id — no second row"
    assert rows["act_111"].display_name == existing["display_name"]


def test_an_account_on_both_edges_is_imported_once(api, db_session, sweep_env):
    from app.services.meta_provider import AssetDiscovery, DiscoveredAsset, EdgeOutcome

    automatic_connection(api)
    # The real provider de-duplicates the union; the fake is staged with what that union is.
    sweep_env["provider"].queue_ad_account_discovery(
        AssetDiscovery(
            assets=(DiscoveredAsset("111", "Both", "owned_ad_accounts"),),
            edges=(
                EdgeOutcome("owned_ad_accounts", ok=True, pages_read=1, items=1),
                EdgeOutcome("client_ad_accounts", ok=True, pages_read=1, items=1),
            ),
            required_edges=("owned_ad_accounts", "client_ad_accounts"),
        )
    )

    totals = discovery_sweep_pass(batch=5)

    assert totals["imported"] == 1
    assert list(accounts(db_session)) == ["111"]


def test_an_archived_account_meta_still_returns_is_counted_never_imported_never_restored(
    api, db_session, sweep_env
):
    """Row: archived but returned — `archived_in_registry`: no import, no restore, reported."""
    bm = make_bm(api, HUB, "Hub BM")
    archived = make_account(api, bm=bm, external_id="111", name="Archived on purpose")
    assert api.post(f"/api/v1/ad-accounts/{archived['id']}/archive").status_code == 200
    automatic_connection(api)
    stage(sweep_env["provider"], ("111", "owned_ad_accounts"))

    first = discovery_sweep_pass(batch=5)

    assert first["archived_returned"] == 1 and first["imported"] == 0 and first["conflicts"] == 0
    rows = accounts(db_session)
    assert list(rows) == ["111"]
    assert rows["111"].archived_at is not None, "still archived — restoring is a person's decision"
    assert first["summaries"] == 1
    assert audit_rows(db_session, "ad_account.restored") == []
    assert len(audit_rows(db_session, "ad_account.created")) == 1, "only the person's original"


def test_a_uniqueness_race_costs_that_account_only(api, db_session, sweep_env, monkeypatch):
    """Row: two passes overlap — `conflict`, that SAVEPOINT rolled back, the pass carries on."""
    automatic_connection(api)
    stage(sweep_env["provider"], ("111", "owned_ad_accounts"), ("222", "owned_ad_accounts"))
    from app.core.errors import ConflictError
    from app.services.meta_discovery import MetaDiscoveryService

    original = MetaDiscoveryService.import_ad_account

    def racing(self, run, external_id, **kwargs):
        if external_id == "111":
            raise ConflictError("Another account in this workspace already uses this external account ID.")
        return original(self, run, external_id, **kwargs)

    monkeypatch.setattr(MetaDiscoveryService, "import_ad_account", racing)

    totals = discovery_sweep_pass(batch=5)

    assert totals["conflicts"] == 1 and totals["imported"] == 1
    assert list(accounts(db_session)) == ["222"]


def test_a_real_integrity_race_is_also_a_conflict(api, db_session, sweep_env, monkeypatch):
    """The database's own unique constraint, not just the service's pre-check: the row appears
    between the check and the insert."""
    automatic_connection(api)
    stage(sweep_env["provider"], ("111", "owned_ad_accounts"))
    from app.services.registry import AdAccountRegistryService

    monkeypatch.setattr(AdAccountRegistryService, "_assert_external_id_unique", lambda self, *a, **k: None)
    bm = make_bm(api, HUB, "Hub BM")
    make_account(api, bm=bm, external_id="111", name="Imported by a person meanwhile")
    original = sweep_module.MetaDiscoveryService.registry_account_any_state
    # Pretend the person's row did not exist yet when the sweep looked.
    monkeypatch.setattr(sweep_module.MetaDiscoveryService, "registry_account_any_state", lambda self, x: None)
    monkeypatch.setattr(
        sweep_module.MetaDiscoveryService, "reconcile_ad_accounts",
        lambda self, run: [
            sweep_module.MetaDiscoveryService._row("ad_account", "111", None, "", sweep_module.MISSING_IN_REGISTRY)
        ],
    )

    totals = discovery_sweep_pass(batch=5)

    assert totals["conflicts"] == 1 and totals["imported"] == 0
    assert len(accounts(db_session)) == 1
    assert original  # the real lookup is untouched outside this test


def test_discovery_only_imports_nothing_and_reports_what_awaits(api, db_session, sweep_env):
    """Row: `auto_discovery_enabled` with `auto_import_enabled=false` — scanned, not imported; the
    rows stay `missing_in_registry` for a person to import."""
    conn = automatic_connection(api, imports=False)
    stage(sweep_env["provider"], ("111", "owned_ad_accounts"))

    totals = discovery_sweep_pass(batch=5)

    assert totals["runs"] == 1 and totals["imported"] == 0 and totals["awaiting_import"] == 1
    assert accounts(db_session) == {}
    latest = api.get(f"/api/v1/meta-connections/{conn['id']}/discoveries/latest").json()
    assert [r["status"] for r in latest["ad_accounts"]["reconciliation"]] == ["missing_in_registry"]
    assert totals["summaries"] == 1


def test_pixels_are_counted_never_imported(api, db_session, sweep_env):
    """Row: new Pixel on `adspixels` — observation stored, no import (schema), counted."""
    automatic_connection(api)
    stage(sweep_env["provider"], pixels=("900",))

    totals = discovery_sweep_pass(batch=5)

    assert totals["pixels_new"] == 1 and totals["imported"] == 0
    from app.models.entities import Pixel

    assert db_session.execute(sa.select(Pixel)).scalars().all() == []


def test_the_history_reports_what_each_scheduled_run_imported(api, db_session, sweep_env):
    conn = automatic_connection(api)
    stage(sweep_env["provider"], ("111", "owned_ad_accounts"), ("222", "client_ad_accounts"))
    discovery_sweep_pass(batch=5)

    (item,) = api.get(f"/api/v1/meta-connections/{conn['id']}/discoveries").json()["items"]

    assert item["trigger"] == "scheduled_sweep"
    assert item["auto_import"]["imported"] == 2
    assert item["auto_import"]["archived_returned"] == 0


def test_the_import_writes_no_provider_call_of_its_own(api, db_session, sweep_env):
    automatic_connection(api)
    stage(sweep_env["provider"], ("111", "owned_ad_accounts"))

    discovery_sweep_pass(batch=5)

    names = [name for name, _ in sweep_env["provider"].calls]
    assert names.count("discover_ad_accounts") == 1
    assert not any(name.startswith(("create", "share")) for name in names), "read-only"
