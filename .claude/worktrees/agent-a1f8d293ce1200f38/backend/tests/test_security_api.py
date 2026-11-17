"""API-level enforcement of the secret-handling guardrails (A1 §H, §Test Plan)."""
from __future__ import annotations

import sqlalchemy as sa

from app.models.entities import AuditLog


def test_payload_with_a_password_field_is_refused(api):
    response = api.post(
        "/api/v1/ad-accounts", json={"display_name": "A", "password": "hunter2hunter2"}
    )
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "forbidden_field"
    assert error["details"]["fields"] == ["password"]


def test_payload_with_a_cookie_field_is_refused(api):
    response = api.post("/api/v1/ad-accounts", json={"display_name": "A", "cookie": "sid=abc"})
    assert response.json()["error"]["code"] == "forbidden_field"


def test_payload_with_an_access_token_field_is_refused(api):
    response = api.post(
        "/api/v1/ad-accounts", json={"display_name": "A", "access_token": "ya29.abc"}
    )
    assert response.json()["error"]["code"] == "forbidden_field"


def test_nested_secret_fields_are_refused(api):
    response = api.post(
        "/api/v1/proxy-references",
        json={"proxy_reference": "label-1", "notes": "ok", "meta": {"proxy_password": "x"}},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "forbidden_field"


def test_proxy_connection_string_is_rejected_as_a_reference(api):
    response = api.post(
        "/api/v1/proxy-references",
        json={"proxy_reference": "http://user:pass@gate.example.com:7000"},
    )
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "forbidden_field"
    assert error["details"]["field"] == "proxy_reference"


def test_user_pass_host_form_is_rejected_as_a_reference(api):
    response = api.post(
        "/api/v1/proxy-references", json={"proxy_reference": "alice:s3cret@gate.internal:1080"}
    )
    assert response.status_code == 422


def test_opaque_proxy_label_is_accepted(api):
    response = api.post(
        "/api/v1/proxy-references",
        json={"proxy_reference": "smartproxy-vn-01", "provider": "smartproxy", "country": "VN"},
    )
    assert response.status_code == 201
    assert response.json()["proxy_reference"] == "smartproxy-vn-01"


def test_browser_profile_reference_rejects_a_credential_shaped_value(api):
    response = api.post(
        "/api/v1/browser-profile-references",
        json={"profile_reference": "https://user:pw@profiles.example.com/p1"},
    )
    assert response.status_code == 422


def test_evidence_rejects_credential_shaped_content(api):
    account = api.post("/api/v1/ad-accounts", json={"display_name": "A"}).json()
    response = api.post(
        f"/api/v1/ad-accounts/{account['id']}/readiness/checklist/ownership_confirmed/evidence",
        json={
            "evidence_type": "note",
            "summary": "socks5://alice:s3cret@proxy.internal:1080",
        },
    )
    assert response.status_code == 422


def test_no_audit_row_ever_persists_a_credential_like_key(api, db_session):
    api.post("/api/v1/ad-accounts", json={"display_name": "Audited", "notes": "hello"})
    rows = db_session.execute(sa.select(AuditLog)).scalars().all()
    assert rows

    banned = ("password", "cookie", "token", "secret", "credential", "authorization", "session")
    for row in rows:
        for payload in (row.before_json, row.after_json, row.metadata_json):
            if not payload:
                continue
            for key in payload:
                assert not any(fragment in key.lower() for fragment in banned), key


def test_login_password_is_never_returned_or_stored_in_the_clear(client, owner, db_session):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": owner["user"].email, "password": owner["password"]},
    )
    assert response.status_code == 200
    assert owner["password"] not in response.text
    db_session.refresh(owner["user"])
    assert owner["password"] not in owner["user"].password_hash
    assert owner["user"].password_hash.startswith("pbkdf2_sha256$")


def test_system_status_exposes_no_infrastructure_secrets(api):
    body = api.get("/api/v1/system/status").json()
    serialized = str(body).lower()
    for leak in ("postgresql://", "postgresql+psycopg", "adsops:adsops", "jwt", "secret", "@localhost"):
        assert leak not in serialized
    assert body["worker_status"] == "not_configured"
    assert body["redis_status"] == "not_configured"


def test_security_headers_are_present(client):
    headers = client.get("/health/live").headers
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["X-Frame-Options"] == "DENY"
