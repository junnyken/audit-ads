"""Integration tests for the registry API against a real PostgreSQL database."""
from __future__ import annotations

import uuid

from tests.conftest import login


def create_bm(api, name="BM One", external_id="bm_1"):
    response = api.post(
        "/api/v1/business-managers",
        json={"name": name, "external_id": external_id, "status": "active", "country": "VN"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def create_account(api, **overrides):
    payload = {
        "display_name": "Account One",
        "external_account_id": "act_1",
        "account_type": "unknown",
        "status": "unknown",
    }
    payload.update(overrides)
    response = api.post("/api/v1/ad-accounts", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_health_endpoints(client):
    assert client.get("/health/live").json() == {"status": "ok"}
    ready = client.get("/health/ready")
    assert ready.status_code == 200 and ready.json()["database"] == "reachable"


def test_request_id_is_echoed_for_correlation(client):
    response = client.get("/health/live", headers={"X-Request-ID": "abc-123"})
    assert response.headers["X-Request-ID"] == "abc-123"


def test_unauthenticated_requests_are_rejected_with_the_standard_envelope(client):
    response = client.get("/api/v1/ad-accounts")
    assert response.status_code == 401
    body = response.json()["error"]
    assert body["code"] == "not_authenticated"
    assert "request_id" in body


def test_login_does_not_reveal_whether_an_account_exists(client, owner):
    missing = client.post(
        "/api/v1/auth/login", json={"email": "nobody@example.com", "password": "wrong-password-1"}
    )
    wrong = client.post(
        "/api/v1/auth/login", json={"email": owner["user"].email, "password": "wrong-password-1"}
    )
    assert missing.status_code == wrong.status_code == 401
    assert missing.json()["error"]["message"] == wrong.json()["error"]["message"]


def test_create_account_initialises_the_checklist_and_readiness(api):
    account = create_account(api)
    assert account["readiness_status"] == "unknown"

    checklist = api.get(f"/api/v1/ad-accounts/{account['id']}/readiness/checklist").json()
    assert len(checklist) == 14
    assert all(entry["item"]["review_status"] == "not_reviewed" for entry in checklist)


def test_checklist_initialisation_is_idempotent(api):
    account = create_account(api)
    first = api.get(f"/api/v1/ad-accounts/{account['id']}/readiness/checklist").json()
    api.post(f"/api/v1/ad-accounts/{account['id']}/readiness/recalculate")
    api.post(f"/api/v1/ad-accounts/{account['id']}/readiness/recalculate")
    second = api.get(f"/api/v1/ad-accounts/{account['id']}/readiness/checklist").json()
    assert len(first) == len(second) == 14
    assert {e["item"]["id"] for e in first} == {e["item"]["id"] for e in second}


def test_external_account_id_is_unique_per_workspace(api):
    create_account(api, external_account_id="act_dup")
    response = api.post(
        "/api/v1/ad-accounts",
        json={"display_name": "Другой", "external_account_id": "act_dup"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"


def test_blank_external_account_id_does_not_collide(api):
    create_account(api, display_name="A", external_account_id="")
    second = api.post("/api/v1/ad-accounts", json={"display_name": "B", "external_account_id": ""})
    assert second.status_code == 201
    assert second.json()["external_account_id"] is None


def test_no_hard_delete_endpoint_exists(app):
    methods = {method for route in app.routes for method in getattr(route, "methods", set())}
    assert "DELETE" not in methods


def test_archive_is_reversible_and_keeps_children(api):
    account = create_account(api)
    archived = api.post(f"/api/v1/ad-accounts/{account['id']}/archive").json()
    assert archived["archived_at"] is not None
    assert archived["readiness_status"] == "unknown"

    checklist = api.get(f"/api/v1/ad-accounts/{account['id']}/readiness/checklist").json()
    assert len(checklist) == 14

    assert api.get("/api/v1/ad-accounts").json()["total"] == 0
    assert api.get("/api/v1/ad-accounts?archived=true").json()["total"] == 1

    restored = api.post(f"/api/v1/ad-accounts/{account['id']}/restore").json()
    assert restored["archived_at"] is None


def test_mutating_an_archived_account_is_refused(api):
    account = create_account(api)
    api.post(f"/api/v1/ad-accounts/{account['id']}/archive")
    response = api.patch(f"/api/v1/ad-accounts/{account['id']}", json={"display_name": "New"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "entity_archived"


def test_cross_workspace_access_is_denied(client, api, other_owner):
    account = create_account(api)
    intruder = login(client, other_owner["user"].email, other_owner["password"])

    read = client.get(f"/api/v1/ad-accounts/{account['id']}", headers=intruder)
    assert read.status_code == 404
    write = client.patch(
        f"/api/v1/ad-accounts/{account['id']}", headers=intruder, json={"display_name": "Taken"}
    )
    assert write.status_code == 404
    assert client.get("/api/v1/ad-accounts", headers=intruder).json()["total"] == 0


def test_account_cannot_reference_a_business_manager_from_another_workspace(client, api, other_owner):
    intruder = login(client, other_owner["user"].email, other_owner["password"])
    foreign_bm = client.post(
        "/api/v1/business-managers",
        headers=intruder,
        json={"name": "Foreign BM", "external_id": "bm_foreign"},
    ).json()

    response = api.post(
        "/api/v1/ad-accounts",
        json={"display_name": "Borrowed", "business_manager_id": foreign_bm["id"]},
    )
    assert response.status_code == 404


def test_list_pagination_filter_and_sort(api):
    bm = create_bm(api)
    for index in range(5):
        create_account(
            api,
            display_name=f"Account {index}",
            external_account_id=f"act_{index}",
            account_type="business_manager",
            business_manager_id=bm["id"],
            status="active" if index % 2 == 0 else "warning",
        )

    first_page = api.get("/api/v1/ad-accounts?page=1&page_size=2&sort=display_name&sort_direction=asc").json()
    assert first_page["total"] == 5 and first_page["total_pages"] == 3
    assert [item["display_name"] for item in first_page["items"]] == ["Account 0", "Account 1"]

    second_page = api.get("/api/v1/ad-accounts?page=2&page_size=2&sort=display_name&sort_direction=asc").json()
    assert [item["display_name"] for item in second_page["items"]] == ["Account 2", "Account 3"]

    assert api.get("/api/v1/ad-accounts?status=active").json()["total"] == 3
    assert api.get("/api/v1/ad-accounts?search=Account 4").json()["total"] == 1
    assert api.get(f"/api/v1/ad-accounts?business_manager_id={bm['id']}").json()["total"] == 5
    assert api.get("/api/v1/ad-accounts?has_browser_reference=false").json()["total"] == 5
    assert api.get("/api/v1/ad-accounts?has_browser_reference=true").json()["total"] == 0


def test_search_matches_the_business_manager_name(api):
    bm = create_bm(api, name="Retail Vietnam", external_id="bm_retail")
    create_account(api, business_manager_id=bm["id"], account_type="business_manager")
    assert api.get("/api/v1/ad-accounts?search=Retail").json()["total"] == 1


def test_asset_links_are_historical_not_destructive(api):
    account = create_account(api)
    page = api.post("/api/v1/pages", json={"name": "Landing Page", "external_page_id": "pg_1"}).json()

    link = api.post(
        f"/api/v1/ad-accounts/{account['id']}/asset-links",
        json={"asset_type": "page", "asset_id": page["id"]},
    ).json()
    assert link["is_active"] is True and link["asset_label"] == "Landing Page"

    duplicate = api.post(
        f"/api/v1/ad-accounts/{account['id']}/asset-links",
        json={"asset_type": "page", "asset_id": page["id"]},
    )
    assert duplicate.status_code == 409

    unlinked = api.post(
        f"/api/v1/ad-accounts/{account['id']}/asset-links/{link['id']}/unlink"
    ).json()
    assert unlinked["is_active"] is False and unlinked["unlinked_at"] is not None

    history = api.get(f"/api/v1/ad-accounts/{account['id']}/asset-links").json()
    assert len(history) == 1, "unlinking must never delete the historical row"
    active_only = api.get(
        f"/api/v1/ad-accounts/{account['id']}/asset-links?include_inactive=false"
    ).json()
    assert active_only == []


def test_reassigning_a_browser_reference_closes_the_previous_mapping(api):
    account = create_account(api)
    first = api.post(
        "/api/v1/browser-profile-references", json={"profile_reference": "chrome-1"}
    ).json()
    second = api.post(
        "/api/v1/browser-profile-references", json={"profile_reference": "chrome-2"}
    ).json()

    api.post(
        f"/api/v1/ad-accounts/{account['id']}/asset-links",
        json={"asset_type": "browser_profile", "asset_id": first["id"]},
    )
    api.post(
        f"/api/v1/ad-accounts/{account['id']}/asset-links",
        json={"asset_type": "browser_profile", "asset_id": second["id"]},
    )

    links = api.get(f"/api/v1/ad-accounts/{account['id']}/asset-links").json()
    active = [link for link in links if link["is_active"]]
    assert len(links) == 2 and len(active) == 1
    assert active[0]["asset_id"] == second["id"]


def test_reference_archive_and_restore(api):
    bm = create_bm(api)
    archived = api.post(f"/api/v1/business-managers/{bm['id']}/archive").json()
    assert archived["archived_at"] is not None
    assert api.get("/api/v1/business-managers").json()["total"] == 0
    assert api.get("/api/v1/business-managers?archived=true").json()["total"] == 1
    restored = api.post(f"/api/v1/business-managers/{bm['id']}/restore").json()
    assert restored["archived_at"] is None


def test_unknown_uuid_returns_not_found(api):
    response = api.get(f"/api/v1/ad-accounts/{uuid.uuid4()}")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
