"""O4 — the Login for Business round trip, end to end over HTTP + Postgres, with a scripted Graph.

Contract under test (docs/AUDIT_BEFORE_BUILD_O4_USER_TOKENS.md §7b, §8): only Meta's own flow
fills the vault; every refusal stores nothing; the callback always answers 302 with a short code;
no response, audit row, alert or delivery ever carries a token.
"""
from __future__ import annotations

import json

import sqlalchemy as sa

from app.core.enums import ReaderCredentialStatus, WorkspaceRole
from app.core.security import hash_password
from app.models.alerts import Alert, NotificationDelivery
from app.models.entities import AuditLog, User, WorkspaceMember
from app.models.meta_operations import MetaConnection
from app.models.meta_reader_credential import MetaReaderCredential
from tests.conftest import login
from tests.o4_helpers import (
    APP_ID,
    BM_A,
    BM_B,
    BM_C,
    CONFIG_ID,
    REDIRECT,
    TOKEN_PREFIX,
    TokenSpec,
    callback,
    connect,
    in_days,
    start,
)

BASE = "/api/v1/meta-reader-credentials"


def _credentials(db_session) -> list[MetaReaderCredential]:
    db_session.expire_all()
    return list(db_session.execute(sa.select(MetaReaderCredential)).scalars().all())


def _connections(db_session) -> list[MetaConnection]:
    db_session.expire_all()
    return list(db_session.execute(sa.select(MetaConnection).order_by(MetaConnection.created_at)).scalars().all())


def _no_token_anywhere(db_session, *texts: str) -> None:
    """Responses, audit rows, alerts and deliveries: no `FAKE-TOKEN-` anywhere."""
    for text in texts:
        assert TOKEN_PREFIX not in text
    db_session.expire_all()
    for model in (AuditLog, Alert, NotificationDelivery):
        for row in db_session.execute(sa.select(model)).scalars().all():
            dumped = json.dumps({c.key: str(getattr(row, c.key)) for c in sa.inspect(row).mapper.column_attrs})
            assert TOKEN_PREFIX not in dumped, model.__name__
            assert "o4-test-app-secret" not in dumped


# ------------------------------------------------------------------------ configuration


def test_without_the_meta_app_the_list_says_not_configured_and_start_is_409(api):
    listing = api.get(BASE)
    assert listing.status_code == 200
    assert listing.json()["configured"] is False
    assert listing.json()["unavailable_reason"] == "not_configured"
    response = api.post(f"{BASE}/connect/start", json={"label": "x", "business_manager_reference": BM_A})
    assert response.status_code == 409
    assert response.json()["error"]["details"]["reason"] == "not_configured"


def test_a_missing_vault_key_refuses_to_start_rather_than_store_plaintext(api, o4_env, monkeypatch):
    monkeypatch.setattr(o4_env["settings"], "credential_vault_key", "")
    response = api.post(f"{BASE}/connect/start", json={"label": "x", "business_manager_reference": BM_A})
    assert response.status_code == 409
    assert response.json()["error"]["details"]["reason"] == "vault_unavailable"


def test_start_returns_meta_s_dialog_with_config_id_and_a_signed_state(api, o4_env, db_session):
    state, url = start(api)
    assert url.startswith("https://www.facebook.com/v21.0/dialog/oauth?")
    assert f"client_id={APP_ID}" in url and f"config_id={CONFIG_ID}" in url
    assert "response_type=code" in url and "override_default_response_type=true" in url
    assert "scope=" not in url  # the configuration decides the permissions, never a scope list
    assert "o4-test-app-secret" not in url
    assert state
    assert not o4_env["graph"].calls  # starting makes no outbound call
    actions = [row.action for row in db_session.execute(sa.select(AuditLog)).scalars()]
    assert "meta_reader_credential.connect_started" in actions


def test_system_user_configuration_requires_a_business_manager_id(api, o4_env):
    response = api.post(f"{BASE}/connect/start", json={"label": "x"})
    assert response.status_code == 422
    response = api.post(f"{BASE}/connect/start", json={"label": "x", "business_manager_reference": "abc"})
    assert response.status_code == 422


def test_a_credential_field_in_the_body_is_still_refused(api, o4_env):
    for body in ({"label": "x", "access_token": "FAKE-TOKEN-x"}, {"label": "x", "credential": "y"}):
        assert api.post(f"{BASE}/connect/start", json=body).status_code == 422


# ----------------------------------------------------------------------------- happy path


def test_a_system_user_connect_stores_ciphertext_verifies_and_binds_a_new_connection(
    api, client, o4_env, db_session
):
    query, token = connect(api, client, o4_env["graph"])
    assert query["meta_login"] == "ok"
    [credential] = _credentials(db_session)
    assert credential.status == ReaderCredentialStatus.ACTIVE
    assert credential.kind.value == "system_user"
    assert credential.encrypted_secret and token not in credential.encrypted_secret
    assert credential.expires_at is None  # Meta's 0: does not expire
    assert credential.scopes_json == ["ads_read", "business_management"]
    assert credential.provider_user_name == "AdsOps reader (system user)"
    [connection] = _connections(db_session)
    assert connection.reader_credential_id == credential.id
    assert connection.business_manager_reference == BM_A
    assert connection.environment.value == "production"
    # O3's switches stay off: connecting never turns automation on.
    assert connection.auto_discovery_enabled is False and connection.auto_import_enabled is False
    paths = o4_env["graph"].paths()
    assert paths[:2] == ["oauth/access_token", "debug_token"]
    assert BM_A in paths and f"{BM_A}/system_users" in paths

    listing = api.get(BASE)
    body = listing.json()
    assert body["configured"] is True
    [item] = body["items"]
    assert item["derived_state"] == "active"
    assert item["connections"][0]["business_manager_reference"] == BM_A
    assert "encrypted_secret" not in item
    conns = api.get("/api/v1/meta-connections").json()
    assert conns[0]["reader_source"] == "vault"
    assert conns[0]["reader_credential"]["label"] == "FB Triều"
    _no_token_anywhere(db_session, listing.text, json.dumps(conns))


def test_connecting_binds_an_existing_unbound_connection_instead_of_creating_one(
    api, client, o4_env, db_session
):
    created = api.post(
        "/api/v1/meta-connections",
        json={"label": "Hub", "environment": "production", "business_manager_reference": BM_A},
    ).json()
    connect(api, client, o4_env["graph"])
    [connection] = _connections(db_session)
    assert str(connection.id) == created["id"]
    assert connection.reader_credential_id is not None


def test_granular_only_scopes_are_accepted(api, client, o4_env, db_session):
    query, _ = connect(api, client, o4_env["graph"], TokenSpec(granular_only=True))
    assert query["meta_login"] == "ok"


def test_a_user_token_lists_its_businesses_and_gets_one_connection_each(api, client, o4_env, db_session, monkeypatch):
    monkeypatch.setattr(o4_env["settings"], "meta_login_config_kind", "user")
    spec = TokenSpec(
        kind="USER",
        name="Triều",
        expires_at=in_days(55),
        businesses=((BM_A, "Shop A"), (BM_B, "Shop B")),
    )
    query, _ = connect(api, client, o4_env["graph"], spec, bm="")
    assert query["meta_login"] == "ok", query
    [credential] = _credentials(db_session)
    assert credential.kind.value == "user"
    assert {b["external_id"] for b in credential.businesses_seen_json} == {BM_A, BM_B}
    assert {c.business_manager_reference for c in _connections(db_session)} == {BM_A, BM_B}


def test_a_short_lived_user_token_is_exchanged_for_a_long_lived_one(api, client, o4_env, db_session, monkeypatch):
    monkeypatch.setattr(o4_env["settings"], "meta_login_config_kind", "user")
    graph = o4_env["graph"]
    short = TokenSpec(kind="USER", expires_at=in_days(0.05), businesses=((BM_A, "A"),))
    state, _ = start(api, bm="")
    code, token = graph.issue(short)
    long_token = f"{TOKEN_PREFIX}long"
    graph.tokens[long_token] = TokenSpec(kind="USER", expires_at=in_days(59), businesses=((BM_A, "A"),))
    graph.exchanges[token] = long_token
    _, query = callback(client, code=code, state=state)
    assert query["meta_login"] == "ok"
    [credential] = _credentials(db_session)
    assert credential.expires_at > in_days(58)


def test_zero_businesses_is_active_with_no_connection(api, client, o4_env, db_session, monkeypatch):
    monkeypatch.setattr(o4_env["settings"], "meta_login_config_kind", "user")
    query, _ = connect(api, client, o4_env["graph"], TokenSpec(kind="USER", expires_at=in_days(50)), bm="")
    assert query["meta_login"] == "ok"
    assert _credentials(db_session)[0].status == ReaderCredentialStatus.ACTIVE
    assert _connections(db_session) == []


# ---------------------------------------------------------------- refusals at the door


def _refused(api, client, o4_env, db_session, spec, reason):
    query, _ = connect(api, client, o4_env["graph"], spec)
    assert query["meta_login"] == "error"
    assert query["reason"] == reason
    assert "reader" not in query
    assert _credentials(db_session) == []
    refusals = [
        row for row in db_session.execute(sa.select(AuditLog)).scalars()
        if row.action == "meta_reader_credential.connect_refused"
    ]
    assert refusals and refusals[-1].metadata_json["reason"] == reason
    _no_token_anywhere(db_session)


def test_ads_management_is_refused_and_nothing_is_stored(api, client, o4_env, db_session):
    _refused(api, client, o4_env, db_session,
             TokenSpec(scopes=("ads_read", "business_management", "ads_management")), "scope_too_broad")


def test_missing_scope_is_refused(api, client, o4_env, db_session):
    _refused(api, client, o4_env, db_session, TokenSpec(scopes=("ads_read",)), "scope_missing")


def test_another_app_s_token_is_refused(api, client, o4_env, db_session):
    _refused(api, client, o4_env, db_session, TokenSpec(app_id="123"), "app_mismatch")


def test_an_invalid_token_is_refused(api, client, o4_env, db_session):
    _refused(api, client, o4_env, db_session, TokenSpec(valid=False), "invalid_token")


def test_a_tampered_or_missing_state_is_refused_without_any_call(api, client, o4_env, db_session):
    state, _ = start(api)
    for bad in (state[:-4] + "AAAA", "", None):
        _, query = callback(client, code="code-x", state=bad)
        assert query == {"meta_login": "error", "reason": "invalid_state"}
    assert o4_env["graph"].calls == []
    assert _credentials(db_session) == []


def test_an_expired_state_is_refused(api, client, o4_env, monkeypatch):
    from app.core import secret_vault

    state, _ = start(api)
    monkeypatch.setattr(secret_vault, "STATE_TTL_SECONDS", -1)
    code, _ = o4_env["graph"].issue()
    _, query = callback(client, code=code, state=state)
    assert query["reason"] == "invalid_state"
    assert o4_env["graph"].calls == []


def test_a_cancelled_login_is_reported_without_echoing_meta(api, client, o4_env):
    state, _ = start(api)
    location, query = callback(client, code=None, state=state, error="access_denied<script>")
    assert query == {"meta_login": "error", "reason": "login_cancelled"}
    assert "script" not in location


def test_a_bad_code_reports_code_exchange_failed(api, client, o4_env):
    state, _ = start(api)
    _, query = callback(client, code="code-never-issued", state=state)
    assert query["reason"] == "code_exchange_failed"


def test_a_business_the_token_cannot_read_stays_pending_and_is_never_read(api, client, o4_env, db_session):
    query, _ = connect(api, client, o4_env["graph"], TokenSpec(readable=(BM_B,)), bm=BM_A)
    assert query["meta_login"] == "error"
    assert query["reason"] == "business_not_readable"
    [credential] = _credentials(db_session)
    assert query["reader"] == str(credential.id)
    assert credential.status == ReaderCredentialStatus.PENDING_VERIFICATION
    assert _connections(db_session) == []


def test_authority_not_established_is_not_verified(api, client, o4_env, db_session):
    query, _ = connect(api, client, o4_env["graph"], TokenSpec(authority=False))
    assert query["reason"] == "business_not_readable"
    assert _credentials(db_session)[0].status == ReaderCredentialStatus.PENDING_VERIFICATION


def test_a_former_owner_cannot_complete_a_callback(api, client, o4_env, db_session, owner):
    state, _ = start(api)
    member = db_session.execute(
        sa.select(WorkspaceMember).where(WorkspaceMember.user_id == owner["user"].id)
    ).scalar_one()
    member.role = WorkspaceRole.ADMIN
    db_session.commit()
    code, _ = o4_env["graph"].issue()
    _, query = callback(client, code=code, state=state)
    assert query["reason"] == "not_authorized"
    assert o4_env["graph"].calls == []


# -------------------------------------------------------------------- reconnect / revoke


def test_reconnect_keeps_the_connection_and_refuses_another_identity(api, client, o4_env, db_session):
    graph = o4_env["graph"]
    connect(api, client, graph)
    [credential] = _credentials(db_session)
    connection_id = _connections(db_session)[0].id
    credential.status = ReaderCredentialStatus.RECONNECT_REQUIRED
    credential.reconnect_reason = "password_changed"
    db_session.commit()

    response = api.post(f"{BASE}/{credential.id}/reconnect/start")
    assert response.status_code == 200
    from urllib.parse import parse_qs, urlparse

    state = parse_qs(urlparse(response.json()["url"]).query)["state"][0]
    code, _ = graph.issue(TokenSpec(user_id="someone-else"))
    _, query = callback(client, code=code, state=state)
    assert query["reason"] == "user_mismatch"
    assert _credentials(db_session)[0].status == ReaderCredentialStatus.RECONNECT_REQUIRED

    state = parse_qs(urlparse(api.post(f"{BASE}/{credential.id}/reconnect/start").json()["url"]).query)["state"][0]
    code, new_token = graph.issue(TokenSpec())
    _, query = callback(client, code=code, state=state)
    assert query["meta_login"] == "ok"
    [credential] = _credentials(db_session)
    assert credential.status == ReaderCredentialStatus.ACTIVE
    assert credential.reconnect_reason is None
    [connection] = _connections(db_session)
    assert connection.id == connection_id and connection.reader_credential_id == credential.id
    _no_token_anywhere(db_session)


def test_revoke_is_terminal_clears_the_ciphertext_and_never_falls_back(api, client, o4_env, db_session, spend_env):
    connect(api, client, o4_env["graph"])
    [credential] = _credentials(db_session)
    assert api.post(f"{BASE}/{credential.id}/revoke", json={}).status_code == 422
    response = api.post(f"{BASE}/{credential.id}/revoke", json={"reason": "Account handed over"})
    assert response.status_code == 200
    assert response.json()["status"] == "revoked"
    [credential] = _credentials(db_session)
    assert credential.encrypted_secret is None
    conns = api.get("/api/v1/meta-connections").json()
    # A server token is configured (spend_env), yet the bound connection reads nothing.
    assert conns[0]["reader_source"] == "vault_reconnect_required"
    assert conns[0]["token_configured"] is False
    assert api.post(f"{BASE}/{credential.id}/revoke", json={"reason": "again"}).status_code == 409
    assert api.post(f"{BASE}/{credential.id}/reconnect/start").status_code == 409
    assert api.post(f"{BASE}/{credential.id}/verify").status_code == 409


def test_verify_now_checks_and_reports(api, client, o4_env, db_session):
    connect(api, client, o4_env["graph"])
    [credential] = _credentials(db_session)
    o4_env["graph"].calls.clear()
    response = api.post(f"{BASE}/{credential.id}/verify")
    assert response.status_code == 200
    assert response.json()["check_result"] == "valid"
    assert o4_env["graph"].paths() == ["debug_token"]


# ------------------------------------------------------------- assign / two credentials


def test_the_owner_switches_a_connection_to_another_active_credential_explicitly(
    api, client, o4_env, db_session
):
    graph = o4_env["graph"]
    connect(api, client, graph, label="first")
    connect(api, client, graph, TokenSpec(user_id="61550000000888", name="Second"), label="second")
    creds = {c.label: c for c in _credentials(db_session)}
    [connection] = _connections(db_session)
    # Never switched by the system: still the first credential.
    assert connection.reader_credential_id == creds["first"].id
    card = api.get(f"/api/v1/meta-connections/{connection.id}").json()
    assert [r["label"] for r in card["other_readers"]] == ["second"]

    response = api.post(
        f"/api/v1/meta-connections/{connection.id}/reader-credential",
        json={"reader_id": str(creds["second"].id)},
    )
    assert response.status_code == 200, response.text
    assert response.json()["reader_credential"]["label"] == "second"
    assert any(
        row.action == "meta_reader_credential.assigned_to_connection"
        for row in db_session.execute(sa.select(AuditLog)).scalars()
    )


def test_assign_refuses_a_credential_that_never_saw_the_business(api, client, o4_env, db_session):
    graph = o4_env["graph"]
    connect(api, client, graph, label="first")
    connect(api, client, graph, TokenSpec(user_id="2", readable=(BM_C,)), label="other", bm=BM_C)
    creds = {c.label: c for c in _credentials(db_session)}
    target = next(c for c in _connections(db_session) if c.business_manager_reference == BM_A)
    response = api.post(
        f"/api/v1/meta-connections/{target.id}/reader-credential",
        json={"reader_id": str(creds["other"].id)},
    )
    assert response.status_code == 409
    assert response.json()["error"]["details"]["reason"] == "business_manager_not_seen"
    assert api.post(
        f"/api/v1/meta-connections/{target.id}/reader-credential",
        json={"credential_id": str(creds["other"].id)},
    ).status_code == 422


# ----------------------------------------------------------------------------- authz


def test_every_route_is_owner_only_and_workspace_scoped(api, client, o4_env, db_session, owner, other_auth):
    connect(api, client, o4_env["graph"])
    [credential] = _credentials(db_session)
    # Another workspace's owner: 404, never 403, so ids cannot be probed.
    assert client.post(f"{BASE}/{credential.id}/verify", headers=other_auth).status_code == 404
    assert client.post(f"{BASE}/{credential.id}/revoke", headers=other_auth, json={"reason": "x"}).status_code == 404
    assert client.get(BASE, headers=other_auth).json()["items"] == []
    # A non-owner member of this workspace: refused.
    viewer = User(email="viewer@example.com", full_name="V", password_hash=hash_password("pw-viewer-123456"), is_active=True)
    db_session.add(viewer)
    db_session.flush()
    db_session.add(WorkspaceMember(workspace_id=owner["workspace"].id, user_id=viewer.id, role=WorkspaceRole.ADMIN))
    db_session.commit()
    headers = login(client, "viewer@example.com", "pw-viewer-123456")
    assert client.get(BASE, headers=headers).status_code == 403
    assert client.post(f"{BASE}/connect/start", headers=headers, json={"label": "x", "business_manager_reference": BM_A}).status_code == 403
    assert client.post(f"{BASE}/{credential.id}/verify", headers=headers).status_code == 403
    # No token at all.
    assert client.get(BASE).status_code == 401


def test_the_redirect_goes_to_configured_dashboard_only(api, client, o4_env):
    state, _ = start(api)
    location, _ = callback(client, code="nope", state=state)
    assert location.startswith("https://adsops.example.com/settings?")
    assert location.endswith("#meta-readers")
    assert REDIRECT not in location
