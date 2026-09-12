"""A10.3 — importing a discovered ad account into the A1 registry.

The import is the first path in this product that lets a Meta observation *write* an internal
record, so these tests are mostly about what it refuses to do: invent an account nobody observed,
duplicate one that already exists, or fabricate readiness because Meta returned something.

Presence and absence are deliberately asymmetric. Coverage and authority gate conclusions about
absence — "this account is gone" is only meaningful against a full inventory read by an identity
allowed to see it. An account that was *returned* needs neither gate: it was observed.
"""
from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.core.enums import BusinessAuthority, ReadinessStatus
from app.models.entities import AdAccount, BusinessManager
from app.services.meta_provider import AssetDiscovery, DiscoveredAsset, EdgeOutcome

BM = "1993884657458857"


@pytest.fixture()
def configured_bm():
    settings = get_settings()
    previous = settings.meta_business_id
    settings.meta_business_id = BM
    yield BM
    settings.meta_business_id = previous


def make_connection(api, **overrides):
    payload = {"label": "Discovery connection", "environment": "fake"}
    payload.update(overrides)
    return api.post("/api/v1/meta-connections", json=payload).json()


def _run(api, meta_provider, *, accounts=()):
    meta_provider.business_managers.append({"external_id": BM, "name": "Quảng Cáo Top"})
    meta_provider.discovered_ad_accounts.extend(accounts)
    connection = make_connection(api)
    run = api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries").json()
    return connection, run


def _import(api, connection, run, external_account_id):
    return api.post(
        f"/api/v1/meta-connections/{connection['id']}/discoveries/{run['id']}/imports",
        json={"external_account_id": external_account_id},
    )


# ------------------------------------------------------------------------ the happy path


def test_importing_registers_the_account_and_the_business_manager_behind_it(
    api, session, workspace, meta_provider, configured_bm
):
    """The Business Manager row is created too. Making an operator retype an id the run already
    proved is the friction that left the Business Managers page empty while eight accounts sat in
    a discovery result."""
    connection, run = _run(
        api, meta_provider,
        accounts=[DiscoveredAsset("1167063825546698", "Tbsupellex", "owned_ad_accounts")],
    )

    response = _import(api, connection, run, "1167063825546698")

    assert response.status_code == 201
    body = response.json()
    assert body["external_account_id"] == "1167063825546698"
    assert body["display_name"] == "Tbsupellex"

    account = session.get(AdAccount, body["ad_account_id"])
    assert account is not None
    business_manager = session.get(BusinessManager, account.business_manager_id)
    assert business_manager.external_id == BM
    assert business_manager.name == "Quảng Cáo Top"


def test_an_imported_account_starts_unknown_and_is_never_ready_because_meta_returned_it(
    api, session, meta_provider, configured_bm
):
    """Rule 4. Having been seen in a Business Manager says nothing about whether this workspace
    is ready to run ads on it — that is operator-entered evidence, and there is none yet."""
    connection, run = _run(
        api, meta_provider, accounts=[DiscoveredAsset("777", "New account", "owned_ad_accounts")]
    )

    body = _import(api, connection, run, "777").json()

    assert body["readiness_status"] == ReadinessStatus.UNKNOWN.value
    account = session.get(AdAccount, body["ad_account_id"])
    assert account.last_synced_at is None


def test_a_second_import_reuses_the_business_manager_rather_than_creating_another(
    api, session, workspace, meta_provider, configured_bm
):
    connection, run = _run(
        api, meta_provider,
        accounts=[
            DiscoveredAsset("111", "First", "owned_ad_accounts"),
            DiscoveredAsset("222", "Second", "client_ad_accounts"),
        ],
    )

    _import(api, connection, run, "111")
    _import(api, connection, run, "222")

    rows = (
        session.query(BusinessManager)
        .filter(BusinessManager.workspace_id == workspace.id, BusinessManager.external_id == BM)
        .all()
    )
    assert len(rows) == 1


def test_an_act_prefixed_id_imports_the_same_account_as_its_bare_form(
    api, meta_provider, configured_bm
):
    """Meta writes an account as `act_123` on one field and `123` on another. Without
    canonicalisation the same account could be imported twice under two spellings."""
    connection, run = _run(
        api, meta_provider, accounts=[DiscoveredAsset("123", "Prefixed", "owned_ad_accounts")]
    )

    response = _import(api, connection, run, "act_123")

    assert response.status_code == 201
    assert response.json()["external_account_id"] == "123"


# ---------------------------------------------------------------------------- refusals


def test_an_account_the_run_did_not_return_cannot_be_imported(api, meta_provider, configured_bm):
    """Otherwise this read-only feature becomes a general account-creation endpoint wearing
    discovery's evidence."""
    connection, run = _run(
        api, meta_provider, accounts=[DiscoveredAsset("111", "Observed", "owned_ad_accounts")]
    )

    response = _import(api, connection, run, "999999999")

    assert response.status_code == 404


def test_importing_the_same_account_twice_is_refused_rather_than_duplicated(
    api, meta_provider, configured_bm
):
    connection, run = _run(
        api, meta_provider, accounts=[DiscoveredAsset("111", "Once", "owned_ad_accounts")]
    )
    assert _import(api, connection, run, "111").status_code == 201

    response = _import(api, connection, run, "111")

    assert response.status_code == 409


def test_a_run_belonging_to_another_connection_is_not_disclosed(api, meta_provider, configured_bm):
    """Out of scope answers 404, never 403 — a 403 would confirm the run exists elsewhere."""
    connection, run = _run(
        api, meta_provider, accounts=[DiscoveredAsset("111", "Observed", "owned_ad_accounts")]
    )
    other = make_connection(api, label="Another connection")

    response = api.post(
        f"/api/v1/meta-connections/{other['id']}/discoveries/{run['id']}/imports",
        json={"external_account_id": "111"},
    )

    assert response.status_code == 404


def test_another_workspaces_run_is_not_disclosed(api, client, other_owner, meta_provider, configured_bm):
    connection, run = _run(
        api, meta_provider, accounts=[DiscoveredAsset("111", "Observed", "owned_ad_accounts")]
    )
    login = client.post(
        "/api/v1/auth/login",
        json={"email": other_owner["user"].email, "password": other_owner["password"]},
    ).json()
    headers = {"Authorization": f"Bearer {login['access_token']}"}

    response = client.post(
        f"/api/v1/meta-connections/{connection['id']}/discoveries/{run['id']}/imports",
        json={"external_account_id": "111"},
        headers=headers,
    )

    assert response.status_code == 404


def test_the_import_body_refuses_an_unexpected_field(api, meta_provider, configured_bm):
    """`StrictPayload`. A body that quietly accepts extra keys is how a workspace id or a
    credential gets smuggled into a write."""
    connection, run = _run(
        api, meta_provider, accounts=[DiscoveredAsset("111", "Observed", "owned_ad_accounts")]
    )

    response = api.post(
        f"/api/v1/meta-connections/{connection['id']}/discoveries/{run['id']}/imports",
        json={"external_account_id": "111", "workspace_id": "00000000-0000-0000-0000-000000000000"},
    )

    assert response.status_code == 422


# ------------------------------------------------------- what the import is NOT gated on


def test_an_account_from_an_incomplete_run_can_still_be_imported(
    api, meta_provider, configured_bm
):
    """Coverage gates *absence*, not presence. Requiring a complete inventory here would block the
    first import of a Business Manager whose client edge happens to be refused — for no gain in
    truth, since the account in hand was returned either way."""
    meta_provider.business_managers.append({"external_id": BM, "name": "Quảng Cáo Top"})
    meta_provider.queue_ad_account_discovery(
        AssetDiscovery(
            assets=(DiscoveredAsset("111", "Observed", "owned_ad_accounts"),),
            edges=(
                EdgeOutcome("owned_ad_accounts", ok=True, pages_read=1, items=1),
                EdgeOutcome("client_ad_accounts", ok=False, pages_read=0),
            ),
            required_edges=("owned_ad_accounts", "client_ad_accounts"),
            authority=BusinessAuthority.NOT_CHECKED,
        )
    )
    connection = make_connection(api)
    run = api.post(f"/api/v1/meta-connections/{connection['id']}/discoveries").json()
    assert run["ad_accounts"]["complete"] is False

    response = _import(api, connection, run, "111")

    assert response.status_code == 201


def test_the_import_makes_no_provider_call(api, meta_provider, configured_bm):
    """It reads what the run already stored. A write path that re-reads Meta would spend
    rate-limit budget per click and could disagree with the evidence on screen."""
    connection, run = _run(
        api, meta_provider, accounts=[DiscoveredAsset("111", "Observed", "owned_ad_accounts")]
    )
    meta_provider.calls.clear()

    _import(api, connection, run, "111")

    assert meta_provider.calls == []


def test_the_import_is_recorded_with_the_run_that_justified_it(api, meta_provider, configured_bm):
    """Provenance. A month later, "where did this record come from" has to be answerable from the
    audit log alone."""
    connection, run = _run(
        api, meta_provider, accounts=[DiscoveredAsset("111", "Observed", "owned_ad_accounts")]
    )

    _import(api, connection, run, "111")
    entries = api.get("/api/v1/audit-logs?page_size=25").json()["items"]

    imported = [e for e in entries if e["action"] == "meta_discovery.ad_account_imported"]
    assert len(imported) == 1
    assert imported[0]["metadata_json"]["discovery_run_id"] == run["id"]
    assert imported[0]["metadata_json"]["source_edge"] == "owned_ad_accounts"


def test_the_reconciliation_flips_to_matched_after_an_import(api, meta_provider, configured_bm):
    """The end-to-end proof that the import landed somewhere the rest of the product can see:
    the same run, re-read, now calls the account matched instead of missing from the registry."""
    connection, run = _run(
        api, meta_provider, accounts=[DiscoveredAsset("111", "Observed", "owned_ad_accounts")]
    )
    before = api.get(f"/api/v1/meta-connections/{connection['id']}/discoveries/latest").json()
    assert [r["status"] for r in before["ad_accounts"]["reconciliation"]] == ["missing_in_registry"]

    _import(api, connection, run, "111")

    after = api.get(f"/api/v1/meta-connections/{connection['id']}/discoveries/latest").json()
    assert [r["status"] for r in after["ad_accounts"]["reconciliation"]] == ["matched"]
