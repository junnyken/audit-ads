"""A5 integration tests: the extension API surface, its authorization and its limits."""
from __future__ import annotations

import uuid

import sqlalchemy as sa

from app.core.enums import EventSource
from app.models.entities import AccountEvent, AdAccount
from app.models.extension import ExtensionInstallation


def connect(client, auth, *, version="0.1.0", instance="browser-profile-01", label="Chrome"):
    return client.post(
        "/api/v1/extension/connect",
        json={
            "extension_instance_id": instance,
            "extension_version": version,
            "label": label,
        },
        headers=auth,
    )


def ext_headers(client, auth, **kwargs) -> dict[str, str]:
    body = connect(client, auth, **kwargs).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def make_account(api, *, external_id="act_123456789", name="BM USA - Account 03"):
    return api.post(
        "/api/v1/ad-accounts",
        json={"display_name": name, "external_account_id": external_id},
    ).json()


# ---- session -------------------------------------------------------------------------------


def test_connect_issues_a_separate_short_lived_extension_session(client, auth):
    body = connect(client, auth).json()
    assert body["token_use"] == "extension"
    assert body["access_token"]
    assert body["installation_id"]
    assert body["workspace_name"]


def test_an_extension_token_cannot_be_used_on_dashboard_routes(client, auth):
    headers = ext_headers(client, auth)
    for path in ("/api/v1/ad-accounts", "/api/v1/alerts", "/api/v1/operations/overview"):
        response = client.get(path, headers=headers)
        assert response.status_code == 401, path
        assert "extension session" in response.json()["error"]["message"].lower()


def test_an_extension_token_cannot_create_an_account_or_mint_another_session(client, auth):
    headers = ext_headers(client, auth)
    assert (
        client.post("/api/v1/ad-accounts", json={"display_name": "X"}, headers=headers).status_code
        == 401
    )
    assert connect(client, headers).status_code == 401


def test_a_dashboard_token_cannot_be_used_on_extension_only_routes(client, auth):
    response = client.post(
        "/api/v1/extension/context/resolve",
        json={"external_account_id": "1", "safe_path": "/adsmanager/manage/campaigns"},
        headers=auth,
    )
    assert response.status_code == 401
    assert "extension session" in response.json()["error"]["message"].lower()


def test_tokens_issued_before_a5_still_work_as_dashboard_sessions(client, auth):
    """The `token_use` claim is additive; stripping it (as a pre-A5 token would look) must not
    sign anyone out. `session_id` (A9) is a *separate* claim and stays intact here — this test
    isolates `token_use`'s own backward-compatibility guarantee from A9's unrelated one below."""
    import jwt

    from app.core.config import get_settings

    settings = get_settings()
    token = auth["Authorization"].removeprefix("Bearer ")
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    payload.pop("token_use")
    legacy = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)

    response = client.get("/api/v1/ad-accounts", headers={"Authorization": f"Bearer {legacy}"})
    assert response.status_code == 200


def test_a_token_missing_session_id_is_refused(client, auth):
    """A9: `session_id` is not additive like `token_use` was — every dashboard token minted
    since the session registry shipped carries one, and a token without it (forged, or from
    before the registry existed) is refused rather than trusted by default."""
    import jwt

    from app.core.config import get_settings

    settings = get_settings()
    token = auth["Authorization"].removeprefix("Bearer ")
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    payload.pop("session_id")
    stripped = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)

    response = client.get("/api/v1/ad-accounts", headers={"Authorization": f"Bearer {stripped}"})
    assert response.status_code == 401


def test_reconnecting_the_same_browser_reuses_its_installation(client, auth, db_session):
    first = connect(client, auth).json()["installation_id"]
    second = connect(client, auth, version="0.1.1").json()["installation_id"]
    assert first == second
    count = db_session.execute(
        sa.select(sa.func.count()).select_from(ExtensionInstallation)
    ).scalar_one()
    assert count == 1


def test_a_revoked_installation_stops_working_immediately(client, auth):
    headers = ext_headers(client, auth)
    assert client.get("/api/v1/extension/session/current", headers=headers).status_code == 200

    revoked = client.post(
        "/api/v1/extension/installations/revoke",
        json={"reason": "Laptop handed back."},
        headers=auth,
    )
    assert revoked.status_code == 200
    assert revoked.json()["is_active"] is False

    # The token is still cryptographically valid; the row is what stops it.
    after = client.get("/api/v1/extension/session/current", headers=headers)
    assert after.status_code == 401
    assert "revoked" in after.json()["error"]["message"].lower()


def test_an_invalid_client_version_or_instance_is_refused(client, auth):
    assert connect(client, auth, version="not-a-version").status_code == 422
    assert connect(client, auth, instance="short").status_code == 422


def test_the_installation_list_never_exposes_a_token(client, auth):
    connect(client, auth)
    body = client.get("/api/v1/extension/installations", headers=auth).json()
    assert len(body) == 1
    assert set(body[0]) == {
        "id", "label", "extension_version", "last_seen_at", "revoked_at",
        "revoked_reason", "created_at", "is_active",
    }


# ---- context resolution over the API ------------------------------------------------------


def test_a_confirmed_context_returns_readiness_health_and_alerts_separately(client, auth, api):
    account = make_account(api)
    headers = ext_headers(client, auth)
    body = client.post(
        "/api/v1/extension/context/resolve",
        json={
            "external_account_id": "123456789",
            "page_type": "campaign",
            "safe_path": "/adsmanager/manage/campaigns",
            "extension_version": "0.1.0",
        },
        headers=headers,
    ).json()

    assert body["context_status"] == "confirmed"
    assert body["account"]["id"] == account["id"]
    # Three separate values, never merged and never scored.
    assert body["readiness"]["status"]
    assert body["health"]["status"]
    assert set(body["alerts"]) == {"open_count", "critical_count", "warning_count", "info_count"}
    assert "score" not in str(body).lower()


def test_an_unregistered_account_returns_unknown_with_no_account(client, auth, api):
    make_account(api)
    headers = ext_headers(client, auth)
    body = client.post(
        "/api/v1/extension/context/resolve",
        json={"external_account_id": "999999999", "safe_path": "/adsmanager/manage/campaigns"},
        headers=headers,
    ).json()
    assert body["context_status"] == "unknown"
    assert body["reason_code"] == "account_not_registered"
    assert body["account"] is None
    assert body["readiness"] is None


def test_a_resolve_never_echoes_a_query_string_back(client, auth, api):
    make_account(api)
    headers = ext_headers(client, auth)
    response = client.post(
        "/api/v1/extension/context/resolve",
        json={
            "external_account_id": "123456789",
            "safe_path": "/adsmanager/manage/campaigns?access_token=SECRET&session_id=abc",
        },
        headers=headers,
    )
    assert "SECRET" not in response.text
    assert "access_token" not in response.text
    assert response.json()["safe_path"] == "/adsmanager/manage/campaigns"


def test_resolving_does_not_persist_readiness(client, auth, api, db_session):
    account = make_account(api)
    headers = ext_headers(client, auth)
    before = db_session.execute(
        sa.select(AdAccount.readiness_evaluated_at).where(AdAccount.id == uuid.UUID(account["id"]))
    ).scalar()
    for _ in range(3):
        client.post(
            "/api/v1/extension/context/resolve",
            json={"external_account_id": "123456789", "safe_path": "/adsmanager/manage/campaigns"},
            headers=headers,
        )
    db_session.expire_all()
    after = db_session.execute(
        sa.select(AdAccount.readiness_evaluated_at).where(AdAccount.id == uuid.UUID(account["id"]))
    ).scalar()
    assert after == before


def test_a_foreign_account_summary_is_reported_as_missing(client, auth, api, other_owner, other_auth):
    foreign = other_auth
    created = client.post(
        "/api/v1/ad-accounts",
        json={"display_name": "Theirs", "external_account_id": "act_777"},
        headers=foreign,
    ).json()
    headers = ext_headers(client, auth)
    response = client.get(
        f"/api/v1/extension/accounts/{created['id']}/summary", headers=headers
    )
    assert response.status_code == 404


# ---- events --------------------------------------------------------------------------------


def test_an_extension_event_becomes_an_ordinary_account_event_with_an_audit_row(
    client, auth, api, db_session
):
    account = make_account(api)
    headers = ext_headers(client, auth)
    created = client.post(
        "/api/v1/extension/events",
        json={
            "ad_account_id": account["id"],
            "event_type": "campaign_change_intent",
            "note": "Raising the daily budget after the payment review.",
            "page_type": "campaign",
            "safe_path": "/adsmanager/manage/campaigns",
            "extension_version": "0.1.0",
        },
        headers=headers,
    )
    assert created.status_code == 201
    body = created.json()
    assert body["source"] == EventSource.CHROME_EXTENSION.value
    assert body["source_context"]["page_type"] == "campaign"

    # It appears in the A1 timeline the dashboard reads.
    timeline = api.get(f"/api/v1/ad-accounts/{account['id']}/events").json()
    items = timeline["items"] if isinstance(timeline, dict) else timeline
    assert any(item["id"] == body["id"] for item in items)

    logs = api.get(f"/api/v1/audit-logs?entity_id={body['id']}").json()
    assert logs["total"] >= 1


def test_an_event_type_outside_the_allowlist_is_refused(client, auth, api):
    account = make_account(api)
    headers = ext_headers(client, auth)
    response = client.post(
        "/api/v1/extension/events",
        json={"ad_account_id": account["id"], "event_type": "account_suspended", "note": "x"},
        headers=headers,
    )
    assert response.status_code == 422


def test_an_operator_decision_needs_a_reason(client, auth, api):
    account = make_account(api)
    headers = ext_headers(client, auth)
    for event_type in ("campaign_change_intent", "account_note_added", "policy_issue_reported"):
        response = client.post(
            "/api/v1/extension/events",
            json={"ad_account_id": account["id"], "event_type": event_type, "note": "   "},
            headers=headers,
        )
        assert response.status_code == 422, event_type


def test_the_extension_cannot_choose_its_own_severity(client, auth, api, db_session):
    account = make_account(api)
    headers = ext_headers(client, auth)
    rejected = client.post(
        "/api/v1/extension/events",
        json={
            "ad_account_id": account["id"],
            "event_type": "account_note_added",
            "note": "n",
            "severity": "critical",
        },
        headers=headers,
    )
    assert rejected.status_code == 422  # the field does not exist on the schema

    created = client.post(
        "/api/v1/extension/events",
        json={"ad_account_id": account["id"], "event_type": "account_note_added", "note": "n"},
        headers=headers,
    ).json()
    assert created["severity"] == "info"


def test_an_event_cannot_be_dated_into_the_future(client, auth, api):
    from datetime import UTC, datetime, timedelta

    account = make_account(api)
    headers = ext_headers(client, auth)
    future = (datetime.now(UTC) + timedelta(days=30)).isoformat()
    body = client.post(
        "/api/v1/extension/events",
        json={
            "ad_account_id": account["id"],
            "event_type": "manual_review_started",
            "note": "",
            "occurred_at": future,
        },
        headers=headers,
    ).json()
    assert body["occurred_at"] < future


def test_an_event_for_a_foreign_account_is_reported_as_missing(client, auth, other_auth):
    foreign = client.post(
        "/api/v1/ad-accounts",
        json={"display_name": "Theirs", "external_account_id": "act_888"},
        headers=other_auth,
    ).json()
    headers = ext_headers(client, auth)
    response = client.post(
        "/api/v1/extension/events",
        json={"ad_account_id": foreign["id"], "event_type": "account_note_added", "note": "n"},
        headers=headers,
    )
    assert response.status_code == 404


def test_no_extension_payload_may_carry_a_workspace_or_a_credential(client, auth, api):
    account = make_account(api)
    headers = ext_headers(client, auth)
    for extra in (
        {"workspace_id": str(uuid.uuid4())},
        {"cookie": "c_user=1"},
        {"access_token": "abc"},
        {"session_id": "s"},
        {"password": "p"},
        {"proxy_url": "http://u:p@host:1"},
    ):
        response = client.post(
            "/api/v1/extension/events",
            json={
                "ad_account_id": account["id"],
                "event_type": "account_note_added",
                "note": "n",
                **extra,
            },
            headers=headers,
        )
        assert response.status_code == 422, extra


def test_a_stored_event_context_never_contains_a_raw_url(client, auth, api, db_session):
    account = make_account(api)
    headers = ext_headers(client, auth)
    client.post(
        "/api/v1/extension/events",
        json={
            "ad_account_id": account["id"],
            "event_type": "account_note_added",
            "note": "n",
            "safe_path": "https://adsmanager.facebook.com/adsmanager/manage/ads?act=1&token=SECRET",
        },
        headers=headers,
    )
    rows = db_session.execute(
        sa.select(AccountEvent.source_context_json).where(
            AccountEvent.source == EventSource.CHROME_EXTENSION.value
        )
    ).scalars().all()
    blob = str(rows)
    assert "SECRET" not in blob
    assert "adsmanager.facebook.com" not in blob
    assert "?" not in blob


# ---- surface -------------------------------------------------------------------------------


def test_the_extension_surface_adds_no_delete_route(app):
    routes = [r for r in app.routes if hasattr(r, "methods")]
    assert [r.path for r in routes if "DELETE" in r.methods] == []
    extension_routes = [r for r in routes if "/extension" in str(r.path)]
    assert extension_routes
    for route in extension_routes:
        assert route.methods - {"HEAD", "OPTIONS"} <= {"GET", "POST"}


def test_every_extension_route_refuses_anonymous_access(client):
    for method, path in [
        ("post", "/api/v1/extension/connect"),
        ("get", "/api/v1/extension/installations"),
        ("post", "/api/v1/extension/installations/revoke"),
        ("get", "/api/v1/extension/session/current"),
        ("post", "/api/v1/extension/context/resolve"),
        ("post", "/api/v1/extension/events"),
    ]:
        response = getattr(client, method)(path, json={}) if method == "post" else client.get(path)
        assert response.status_code in (401, 403), path


def test_the_backend_still_starts_no_browser_and_contacts_no_platform():
    """A5 adds a browser extension; the *server* must remain free of browser tooling.

    A10 narrows this rule rather than dropping it. The distinction that matters is *which*
    Meta host: `graph.facebook.com` is the official API this product was always meant to use
    (A7 onward), and A10 finally reaches it — from two named files and nowhere else. The Ads
    Manager and Business Manager *web* hosts stay banned outright, because a server reaching
    those would mean scraping or driving the UI, which is exactly what this rule exists to
    prevent and what the product charter forbids.
    """
    import pathlib

    root = pathlib.Path(__file__).resolve().parents[1] / "app"
    files = {path.relative_to(root).as_posix(): path.read_text() for path in root.rglob("*.py")}
    sources = "\n".join(files.values())

    # Browser tooling: still banned everywhere, no exceptions.
    for banned in ("playwright", "selenium", "webdriver", "undetected_chrome", "pyppeteer"):
        assert banned not in sources.lower()

    # The web UI hosts: still banned everywhere, no exceptions.
    for platform in ("business.facebook.com/api", "adsmanager.facebook.com"):
        assert platform not in sources

    # The official Graph API: allowed in exactly these two files, by name.
    graph_allowed = {"core/config.py", "services/meta_graph_transport.py"}
    graph_offenders = [
        name for name, text in files.items()
        if "graph.facebook.com" in text and name not in graph_allowed
    ]
    assert graph_offenders == [], graph_offenders
