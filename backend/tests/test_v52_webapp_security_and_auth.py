"""v5.2 Comprehensive WebApp Security Hardening, Email Guard & Multi-Tenant IDOR Suite.

Runs standalone with `--noconftest` (SQLite in-memory + StaticPool) so it executes on any CI
or local Windows environment without requiring a live Postgres daemon.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import os
import pathlib
import time
import urllib.request
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

os.environ.setdefault("JWT_SECRET", "test-v52-secret-not-for-production-use")
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("NOTIFICATION_TRANSPORT", "fake")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
os.environ["META_ACCESS_TOKEN"] = ""
os.environ["META_ACCESS_TOKENS_BY_BUSINESS"] = "{}"
for _o4 in (
    "META_APP_ID",
    "META_APP_SECRET",
    "META_LOGIN_CONFIG_ID",
    "META_OAUTH_REDIRECT_URI",
    "CREDENTIAL_VAULT_KEY",
):
    os.environ[_o4] = ""

import pytest  # noqa: E402
import sqlalchemy as sa  # noqa: E402
from cryptography.fernet import Fernet  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import app.models  # noqa: E402,F401 - register all ORM tables before metadata.create_all
from app.bootstrap import check_db_email_guard_status  # noqa: E402
from app.core import email_and_bot_guard  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.core.email_and_bot_guard import (  # noqa: E402
    normalize_canonical_email,
    precheck_registration_email,
    validate_reputable_registration_email,
)
from app.core.enums import WorkspaceRole  # noqa: E402
from app.core.errors import ValidationError  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import create_app, invalidate_custom_domain_cache  # noqa: E402
from app.models.entities import (  # noqa: E402
    EmailVerificationToken,
    PasswordResetToken,
    User,
    Workspace,
    WorkspaceMember,
)
from app.services.meta_graph_transport import fetch_facebook_identity_and_businesses  # noqa: E402

BOOTSTRAP_PATH = pathlib.Path(__file__).resolve().parents[1] / "app" / "bootstrap.py"


class _FakeHttpResponse(io.BytesIO):
    headers: dict[str, str] = {}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _mint_challenge(code: str = "K7M9P", math_ans: str = "15", iat_offset: int = -10) -> tuple[str, str, str]:
    settings = get_settings()
    issued_at = int(time.time()) + iat_offset
    nonce = uuid.uuid4().hex[:24]
    payload_obj = {
        "n": nonce,
        "iat": issued_at,
        "exp": issued_at + 300,
        "c_hash": hashlib.sha256(f"{code.upper()}:{math_ans}:{nonce}".encode()).hexdigest(),
    }
    payload_b64 = base64.urlsafe_b64encode(
        json.dumps(payload_obj, separators=(",", ":")).encode()
    ).decode("ascii").rstrip("=")
    sig = hmac.new(settings.jwt_secret.encode(), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}", code.upper(), math_ans


@contextmanager
def _temp_env(**overrides: str) -> Iterator[None]:
    prev = {k: os.environ.get(k) for k in overrides}
    for k, v in overrides.items():
        os.environ[k] = v
    get_settings.cache_clear()
    try:
        yield
    finally:
        for k, old in prev.items():
            if old is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = old
        get_settings.cache_clear()


@pytest.fixture()
def sec_env(monkeypatch):
    vault_key = Fernet.generate_key().decode()
    with _temp_env(
        JWT_SECRET="test-v52-secret-not-for-production-use",
        CREDENTIAL_VAULT_KEY=vault_key,
        COMMUNITY_REQUIRE_INVITE_CODE="false",
        RATE_LIMIT_ENABLED="false",
        BOOTSTRAP_OWNER_EMAIL="admin-a@gmail.com",
    ):
        eng = sa.create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
            future=True,
        )
        Base.metadata.create_all(eng)
        TestingSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)

        with TestingSession() as seed:
            ws_a = Workspace(
                name="Agency Alpha",
                slug=f"alpha-{uuid.uuid4().hex[:6]}",
                plan_tier="agency",
                max_vias=500,
                max_ad_accounts=500,
                max_members=25,
                max_desktop_devices=10,
            )
            ws_b = Workspace(
                name="Agency Beta",
                slug=f"beta-{uuid.uuid4().hex[:6]}",
                plan_tier="agency",
                max_vias=500,
                max_ad_accounts=500,
                max_members=25,
                max_desktop_devices=10,
            )
            admin_a = User(
                email="admin-a@gmail.com",
                full_name="Alpha Owner Admin",
                password_hash=hash_password("AlphaStrong99!"),
                is_active=True,
                email_verified=True,
                is_platform_admin=True,
            )
            buyer_a = User(
                email="buyer-a@gmail.com",
                full_name="Alpha Buyer",
                password_hash=hash_password("BuyerStrong99!"),
                is_active=True,
                email_verified=True,
                is_platform_admin=False,
            )
            owner_b = User(
                email="owner-b@outlook.com",
                full_name="Beta Owner",
                password_hash=hash_password("BetaStrong99!"),
                is_active=True,
                email_verified=True,
                is_platform_admin=False,
            )
            seed.add_all([ws_a, ws_b, admin_a, buyer_a, owner_b])
            seed.flush()
            seed.add_all(
                [
                    WorkspaceMember(workspace_id=ws_a.id, user_id=admin_a.id, role=WorkspaceRole.OWNER),
                    WorkspaceMember(workspace_id=ws_a.id, user_id=buyer_a.id, role=WorkspaceRole.BUYER),
                    WorkspaceMember(workspace_id=ws_b.id, user_id=owner_b.id, role=WorkspaceRole.OWNER),
                ]
            )
            seed.commit()

        app = create_app()

        def _override_get_db() -> Iterator[Session]:
            db = TestingSession()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = _override_get_db
        monkeypatch.setattr("app.main.SessionLocal", TestingSession)
        invalidate_custom_domain_cache()
        try:
            with TestClient(app) as client:
                yield {
                    "app": app,
                    "client": client,
                    "Session": TestingSession,
                    "ws_a": ws_a,
                    "ws_b": ws_b,
                    "admin_a": admin_a,
                    "buyer_a": buyer_a,
                    "owner_b": owner_b,
                }
        finally:
            app.dependency_overrides.clear()
            invalidate_custom_domain_cache()


def _login(client: TestClient, email: str, password: str) -> dict[str, str]:
    resp = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


# ------------------------------------------------------------------ 1. Email guard, DB trigger & allowlist
def test_email_canonicalization_disposable_blocking_and_admin_allowlist(sec_env):
    client: TestClient = sec_env["client"]
    TestingSession = sec_env["Session"]

    assert normalize_canonical_email(" A.B.C@googlemail.com ") == "abc@gmail.com"
    assert normalize_canonical_email("op+tag@gmail.com") == "op+tag@gmail.com"

    # Blocks disposable, + aliases, and untrusted domains
    for bad in ("spammer@tempmail.com", "temp@10minutemail.com", "a+1@gmail.com", "bot@random-xyz-mail.biz"):
        with TestingSession() as db, pytest.raises(ValidationError):
            validate_reputable_registration_email(bad, session=db)

    # Postgres trigger DDL + check_db_email_guard_status safety on SQLite
    boot_src = BOOTSTRAP_PATH.read_text(encoding="utf-8")
    assert "on_users_block_disposable_email" in boot_src
    assert "SECURITY DEFINER" in boot_src
    assert "SET search_path = ''" in boot_src
    assert "BEFORE INSERT ON public.users" in boot_src
    with TestingSession() as db:
        assert check_db_email_guard_status(db) == "not_applicable_sqlite"

    # Unprivileged tenant cannot add/read allowlist
    buyer_hdr = _login(client, "buyer-a@gmail.com", "BuyerStrong99!")
    assert client.get("/api/v1/community/admin/email-allowlist", headers=buyer_hdr).status_code == 403
    assert (
        client.post(
            "/api/v1/community/admin/email-allowlist",
            headers=buyer_hdr,
            json={"email": "vip@partner-agency.io", "note": "Unauthorized"},
        ).status_code
        == 403
    )

    # Platform admin allowlists partner email -> passes both precheck-signup and backend validator
    admin_hdr = _login(client, "admin-a@gmail.com", "AlphaStrong99!")
    add_res = client.post(
        "/api/v1/community/admin/email-allowlist",
        headers=admin_hdr,
        json={"email": "vip@partner-agency.io", "note": "VIP Partner"},
    )
    assert add_res.status_code == 201
    pre = client.post("/api/v1/auth/precheck-signup", json={"email": "vip@partner-agency.io"})
    assert pre.status_code == 200
    assert pre.json()["ok"] is True

    with TestingSession() as db:
        assert validate_reputable_registration_email("vip@partner-agency.io", session=db) == "vip@partner-agency.io"

    # Zero HTTP DELETE endpoints added across auth or community routers
    v52_delete_paths = [
        getattr(route, "path", "")
        for route in sec_env["app"].routes
        if "DELETE" in getattr(route, "methods", set())
        and any(seg in getattr(route, "path", "") for seg in ("/auth/", "/community/"))
    ]
    assert v52_delete_paths == []

    del_res = client.post(
        "/api/v1/community/admin/email-allowlist/remove",
        headers=admin_hdr,
        json={"email": "vip@partner-agency.io"},
    )
    assert del_res.status_code == 200
    pre_after = client.post("/api/v1/auth/precheck-signup", json={"email": "vip@partner-agency.io"})
    assert pre_after.status_code == 200
    assert pre_after.json()["ok"] is False

    # DB-fail-open precheck: transient DB error must not block user registration
    class _BrokenSession:
        def execute(self, *_args, **_kwargs):
            raise RuntimeError("transient db blip")

    fail_open = precheck_registration_email("newop@gmail.com", session=_BrokenSession())  # type: ignore[arg-type]
    assert fail_open["ok"] is True

    # Bot challenge honeypot, replay, and 10k nonce cache cap
    hp_tok, hp_code, hp_math = _mint_challenge()
    hp_resp = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Bot Hp",
            "workspace_name": "Bot WS",
            "email": "bot-hp@gmail.com",
            "password": "BotStrong99!",
            "challenge_token": hp_tok,
            "captcha_code": hp_code,
            "math_answer": hp_math,
            "human_confirmed": True,
            "website_honeypot": "https://spam.example",
        },
    )
    assert hp_resp.status_code == 422

    rp_tok, rp_code, rp_math = _mint_challenge()
    with TestingSession() as db:
        from app.core.email_and_bot_guard import verify_bot_challenge

        verify_bot_challenge(
            challenge_token=rp_tok,
            captcha_code=rp_code,
            math_answer=rp_math,
            human_confirmed=True,
            honeypot="",
        )
        with pytest.raises(ValidationError):
            verify_bot_challenge(
                challenge_token=rp_tok,
                captcha_code=rp_code,
                math_answer=rp_math,
                human_confirmed=True,
                honeypot="",
            )
        _ = db

    # Verify _USED_NONCES eviction caps memory at <= _MAX_TRACKED_NONCES (10,000)
    with email_and_bot_guard._USED_NONCES_LOCK:
        email_and_bot_guard._USED_NONCES.clear()
        future_exp = time.time() + 600.0
        for idx in range(10_050):
            email_and_bot_guard._USED_NONCES[f"n_{idx}"] = future_exp
        email_and_bot_guard._prune_used_nonces(time.time())
        assert len(email_and_bot_guard._USED_NONCES) <= 10_000
        email_and_bot_guard._USED_NONCES.clear()


# ------------------------------------------------------------------ 2. Precheck-signup & 10/min rate limit
def test_precheck_signup_and_dedicated_rate_limit(monkeypatch):
    with _temp_env(
        RATE_LIMIT_ENABLED="true",
        RATE_LIMIT_PRECHECK_ATTEMPTS="10",
        RATE_LIMIT_PRECHECK_WINDOW_SECONDS="60",
    ):
        eng = sa.create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
            future=True,
        )
        Base.metadata.create_all(eng)
        TestingSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)

        app = create_app()

        def _override_db() -> Iterator[Session]:
            db = TestingSession()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = _override_db
        with TestClient(app) as client:
            for idx in range(10):
                res = client.post("/api/v1/auth/precheck-signup", json={"email": f"realuser{idx}@gmail.com"})
                assert res.status_code == 200, res.text
                assert res.json()["ok"] is True
            # 11th request within window must trigger dedicated 10/min IP bucket -> 429
            blocked = client.post("/api/v1/auth/precheck-signup", json={"email": "realuser10@gmail.com"})
            assert blocked.status_code == 429
            assert "Retry-After" in blocked.headers


# ------------------------------------------------------------------ 3. Email verification & gate
def test_email_verification_token_hashing_and_login_gate(sec_env, monkeypatch):
    client: TestClient = sec_env["client"]
    TestingSession = sec_env["Session"]
    sent_links: list[str] = []

    def _capture_send(settings, recipient_email: str, verify_url: str, *, full_name: str = ""):
        sent_links.append(verify_url)
        return True, "captured"

    monkeypatch.setattr("app.api.v1.routers.auth.send_email_verification_email", _capture_send)

    with _temp_env(
        REQUIRE_EMAIL_VERIFICATION="true",
        SMTP_HOST="smtp.example.test",
        SMTP_FROM_EMAIL="noreply@example.test",
        PUBLIC_APP_URL="https://adsops.example.com",
    ):
        tok, code, math_ans = _mint_challenge()
        reg = client.post(
            "/api/v1/auth/register",
            json={
                "full_name": "Verify Op",
                "workspace_name": "Verify Agency",
                "email": "v.e.r.i.f.y.op@gmail.com",
                "password": "VerifyStrong99!",
                "challenge_token": tok,
                "captcha_code": code,
                "math_answer": math_ans,
                "human_confirmed": True,
                "website_honeypot": "",
            },
        )
        assert reg.status_code == 201, reg.text
        reg_json = reg.json()
        assert reg_json["verification_required"] is True
        assert reg_json["access_token"] == ""
        assert len(sent_links) == 1
        assert "?verify_token=" in sent_links[0]
        raw_verify_token = sent_links[0].split("?verify_token=", 1)[1]

        # DB must store only SHA-256 hash, never plaintext token
        with TestingSession() as db:
            row = db.execute(sa.select(EmailVerificationToken)).scalar_one()
            assert row.token_hash != raw_verify_token
            assert row.token_hash == hashlib.sha256(raw_verify_token.encode()).hexdigest()

        # Login before clicking email link must fail 403 email_not_confirmed
        blocked_login = client.post(
            "/api/v1/auth/login",
            json={"email": "verifyop@gmail.com", "password": "VerifyStrong99!"},
        )
        assert blocked_login.status_code == 403
        assert blocked_login.json()["error"]["details"]["reason"] == "email_not_confirmed"

        # Non-enumerating resend for unknown email must return generic 200 ok
        enum_probe = client.post(
            "/api/v1/auth/resend-verification",
            json={"email": "nobody-registered-here@gmail.com"},
        )
        assert enum_probe.status_code == 200
        assert enum_probe.json()["status"] == "ok"

        # Clicking link verifies user and consumes single-use token
        ver = client.post("/api/v1/auth/verify-email", json={"token": raw_verify_token})
        assert ver.status_code == 200, ver.text
        assert ver.json()["email_verified"] is True

        # Replay of consumed token must fail
        replay = client.post("/api/v1/auth/verify-email", json={"token": raw_verify_token})
        assert replay.status_code == 422

        # Expired EmailVerificationToken must be rejected (422)
        with TestingSession() as db:
            verified_user = db.execute(sa.select(User).where(User.email == "verifyop@gmail.com")).scalar_one()
            expired_raw = "expired_verify_tok_1234567890"
            db.add(
                EmailVerificationToken(
                    user_id=verified_user.id,
                    email=verified_user.email,
                    token_hash=hashlib.sha256(expired_raw.encode()).hexdigest(),
                    expires_at=datetime.now(UTC) - timedelta(minutes=5),
                )
            )
            db.commit()
        exp_resp = client.post("/api/v1/auth/verify-email", json={"token": expired_raw})
        assert exp_resp.status_code == 422

        # Duplicate dotted variant signup blocked
        tok2, code2, math_ans2 = _mint_challenge()
        dup = client.post(
            "/api/v1/auth/register",
            json={
                "full_name": "Verify Op Dup",
                "workspace_name": "Verify Agency 2",
                "email": "verify.op@googlemail.com",
                "password": "VerifyStrong99!",
                "challenge_token": tok2,
                "captcha_code": code2,
                "math_answer": math_ans2,
                "human_confirmed": True,
                "website_honeypot": "",
            },
        )
        assert dup.status_code == 409

        # Login now succeeds cleanly
        ok_login = client.post(
            "/api/v1/auth/login",
            json={"email": "verifyop@gmail.com", "password": "VerifyStrong99!"},
        )
        assert ok_login.status_code == 200
        assert ok_login.json()["email_verified"] is True


# ------------------------------------------------------------------ 4. Logout, change-password & brute-force lockout
def test_logout_change_password_lockout_and_turnstile(sec_env, monkeypatch):
    client: TestClient = sec_env["client"]
    TestingSession = sec_env["Session"]

    # Create two concurrent sessions for Owner B (Session 1 and Session 2)
    hdr_1 = _login(client, "owner-b@outlook.com", "BetaStrong99!")
    hdr_2 = _login(client, "owner-b@outlook.com", "BetaStrong99!")
    assert client.get("/api/v1/auth/me", headers=hdr_1).status_code == 200
    assert client.get("/api/v1/auth/me", headers=hdr_2).status_code == 200

    # Change password from Session 1 -> must fail on wrong current password or weak new password
    assert (
        client.post(
            "/api/v1/auth/change-password",
            headers=hdr_1,
            json={"current_password": "WrongPassword99!", "new_password": "NewBetaStrong99!"},
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/v1/auth/change-password",
            headers=hdr_1,
            json={"current_password": "BetaStrong99!", "new_password": "weak"},
        ).status_code
        == 422
    )

    # Valid change password revokes Session 2 immediately while keeping Session 1 active
    cp = client.post(
        "/api/v1/auth/change-password",
        headers=hdr_1,
        json={"current_password": "BetaStrong99!", "new_password": "NewBetaStrong99!"},
    )
    assert cp.status_code == 200, cp.text
    assert cp.json()["revoked_other_sessions"] >= 1
    assert client.get("/api/v1/auth/me", headers=hdr_2).status_code == 401
    assert client.get("/api/v1/auth/me", headers=hdr_1).status_code == 200

    # Server-side logout revokes Session 1 itself
    out = client.post("/api/v1/auth/logout", headers=hdr_1)
    assert out.status_code == 200
    assert out.json()["revoked"] is True
    assert client.get("/api/v1/auth/me", headers=hdr_1).status_code == 401

    # Per-account brute-force lockout after 8 failed login attempts
    for i in range(7):
        fail = client.post(
            "/api/v1/auth/login",
            json={"email": "owner-b@outlook.com", "password": f"WrongPass{i}!A"},
        )
        assert fail.status_code == 401
    locked = client.post(
        "/api/v1/auth/login",
        json={"email": "owner-b@outlook.com", "password": "WrongPass7!A"},
    )
    assert locked.status_code == 429
    assert "Retry-After" in locked.headers
    assert locked.json()["error"]["details"]["reason"] == "account_temporarily_locked"

    # Even the CORRECT password must return 429 while account is locked
    correct_while_locked = client.post(
        "/api/v1/auth/login",
        json={"email": "owner-b@outlook.com", "password": "NewBetaStrong99!"},
    )
    assert correct_while_locked.status_code == 429
    assert "Retry-After" in correct_while_locked.headers

    # Resetting password clears login lockout & allows immediate login with the new password
    with TestingSession() as db:
        u = db.execute(sa.select(User).where(User.email == "owner-b@outlook.com")).scalar_one()
        raw_reset = "reset_tok_unlock_account_123456"
        db.add(
            PasswordResetToken(
                user_id=u.id,
                token_hash=hashlib.sha256(raw_reset.encode()).hexdigest(),
                expires_at=datetime.now(UTC) + timedelta(minutes=20),
            )
        )
        db.commit()
    rp_res = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw_reset, "new_password": "ResetBetaStrong99!"},
    )
    assert rp_res.status_code == 200
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": "owner-b@outlook.com", "password": "ResetBetaStrong99!"},
        ).status_code
        == 200
    )

    # Restore expected password for subsequent checks cleanly via change-password? Already signed in above -> lock + expiry check:
    for i in range(8):
        client.post(
            "/api/v1/auth/login",
            json={"email": "owner-b@outlook.com", "password": f"WrongAgain{i}!A"},
        )
    with TestingSession() as db:
        u = db.execute(sa.select(User).where(User.email == "owner-b@outlook.com")).scalar_one()
        u.login_locked_until = datetime.now(UTC) - timedelta(seconds=5)
        db.commit()
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": "owner-b@outlook.com", "password": "ResetBetaStrong99!"},
        ).status_code
        == 200
    )

    # Optional Turnstile server-side enforcement when configured
    def _mock_turnstile_urlopen(req, timeout=8):
        body = req.data.decode("utf-8") if isinstance(req.data, bytes | bytearray) else ""
        ok = "response=good-ts-token" in body
        return _FakeHttpResponse(json.dumps({"success": ok}).encode())

    monkeypatch.setattr(urllib.request, "urlopen", _mock_turnstile_urlopen)
    with _temp_env(TURNSTILE_SITE_KEY="1x00000000000000000000AA", TURNSTILE_SECRET_KEY="secret-test-key"):
        chal = client.get("/api/v1/auth/bot-challenge").json()
        assert chal["turnstile_enabled"] is True

        bad_ts = client.post(
            "/api/v1/auth/login",
            json={
                "email": "owner-b@outlook.com",
                "password": "ResetBetaStrong99!",
                "turnstile_token": "bad-token",
            },
        )
        assert bad_ts.status_code == 422
        assert bad_ts.json()["error"]["details"]["field"] == "turnstile_token"

        good_ts = client.post(
            "/api/v1/auth/login",
            json={
                "email": "owner-b@outlook.com",
                "password": "ResetBetaStrong99!",
                "turnstile_token": "good-ts-token",
            },
        )
        assert good_ts.status_code == 200


# ------------------------------------------------------------------ 5. Outbound Meta transport Bearer header guard
def test_fetch_facebook_identity_uses_bearer_header_never_url_token(monkeypatch):
    seen_requests: list[tuple[str, str]] = []

    def _fake_urlopen(req, timeout=15):
        seen_requests.append((req.full_url, req.get_header("Authorization") or ""))
        if "/me/businesses" in req.full_url:
            return _FakeHttpResponse(b'{"data": [{"id": "999888777", "name": "Real BM"}]}')
        return _FakeHttpResponse(b'{"id": "123456789", "name": "Real Operator"}')

    monkeypatch.setattr(urllib.request, "urlopen", _fake_urlopen)
    me_data, businesses = fetch_facebook_identity_and_businesses("EAAB-secret-test-value")
    assert me_data["id"] == "123456789"
    assert len(businesses) == 1
    assert len(seen_requests) == 2
    for full_url, auth_hdr in seen_requests:
        assert "access_token=" not in full_url
        assert "EAAB-secret-test-value" not in full_url
        assert auth_hdr == "Bearer EAAB-secret-test-value"


# ------------------------------------------------------------------ 6. Cross-tenant CORS, MaxBodySize 413 & Headers
def test_cross_tenant_cors_isolation_max_body_and_security_headers(sec_env, monkeypatch):
    client: TestClient = sec_env["client"]
    admin_hdr = _login(client, "admin-a@gmail.com", "AlphaStrong99!")
    owner_b_hdr = _login(client, "owner-b@outlook.com", "BetaStrong99!")

    # Tenant B (ordinary non-admin workspace) tries to register an external custom domain for CORS
    b_dom = client.post(
        "/api/v1/domain-seo/config",
        headers=owner_b_hdr,
        json={"custom_domain": "https://evil-tenant.example.com"},
    )
    assert b_dom.status_code == 200, b_dom.text
    assert b_dom.json()["cors_trusted"] is False

    # Platform admin workspace saves a legitimate trusted custom domain
    a_dom = client.post(
        "/api/v1/domain-seo/config",
        headers=admin_hdr,
        json={"custom_domain": "https://trusted-agency.example.com"},
    )
    assert a_dom.status_code == 200, a_dom.text
    assert a_dom.json()["cors_trusted"] is True

    # Enable live dynamic CORS path by temporarily removing PYTEST_CURRENT_TEST
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    invalidate_custom_domain_cache()

    evil_preflight = client.options(
        "/api/v1/auth/me",
        headers={"Origin": "https://evil-tenant.example.com", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in {k.lower(): v for k, v in evil_preflight.headers.items()}

    trusted_preflight = client.options(
        "/api/v1/auth/me",
        headers={"Origin": "https://trusted-agency.example.com", "Access-Control-Request-Method": "GET"},
    )
    assert trusted_preflight.headers.get("access-control-allow-origin") == "https://trusted-agency.example.com"

    # Security headers & no-store cache control on API routes
    me_resp = client.get("/api/v1/auth/me", headers=admin_hdr)
    assert me_resp.status_code == 200
    assert me_resp.headers.get("X-Content-Type-Options") == "nosniff"
    assert me_resp.headers.get("X-Frame-Options") == "DENY"
    assert me_resp.headers.get("X-Permitted-Cross-Domain-Policies") == "none"
    assert me_resp.headers.get("Content-Security-Policy") == "default-src 'none'; frame-ancestors 'none'"
    assert me_resp.headers.get("Cache-Control") == "no-store"

    # MaxBodySizeMiddleware rejects oversized payload (both Content-Length and chunked stream) with 413
    with _temp_env(MAX_REQUEST_BODY_BYTES="2048"):
        small_limit_app = create_app()
        with TestClient(small_limit_app) as lim_client:
            oversized = json.dumps({"email": "x@gmail.com", "password": "A" * 4000})
            res_413 = lim_client.post(
                "/api/v1/auth/login",
                content=oversized,
                headers={"Content-Type": "application/json"},
            )
            assert res_413.status_code == 413
            assert res_413.json()["error"]["code"] == "payload_too_large"

            def _chunked_oversized():
                yield b'{"email":"x@gmail.com","password":"'
                yield b"B" * 3500
                yield b'"}'

            res_chunked_413 = lim_client.post(
                "/api/v1/auth/login",
                content=_chunked_oversized(),
                headers={"Content-Type": "application/json"},
            )
            assert res_chunked_413.status_code == 413
            assert res_chunked_413.json()["error"]["code"] == "payload_too_large"


# ------------------------------------------------------------------ 7. Negative Multi-Tenant IDOR / BOLA / BFLA Matrix
def test_negative_cross_tenant_idor_and_role_escalation_matrix(sec_env):
    client: TestClient = sec_env["client"]
    TestingSession = sec_env["Session"]

    admin_a_hdr = _login(client, "admin-a@gmail.com", "AlphaStrong99!")
    buyer_a_hdr = _login(client, "buyer-a@gmail.com", "BuyerStrong99!")
    owner_b_hdr = _login(client, "owner-b@outlook.com", "BetaStrong99!")

    # Set reveal PIN for admin_a so email can be stored & guarded
    assert (
        client.put(
            "/api/v1/me/reveal-pin",
            headers=admin_a_hdr,
            json={"current_password": "AlphaStrong99!", "new_pin": "246810"},
        ).status_code
        == 200
    )

    bm_res = client.post(
        "/api/v1/business-managers",
        headers=admin_a_hdr,
        json={"name": "Alpha Vault BM", "external_id": "111222333"},
    )
    assert bm_res.status_code == 201, bm_res.text
    bm_id = bm_res.json()["id"]

    via_res = client.post(
        "/api/v1/personal-account-references",
        headers=admin_a_hdr,
        json={"label": "Alpha Sensitive Via", "owner_member_id": None},
    )
    assert via_res.status_code == 201, via_res.text
    via_id = via_res.json()["id"]

    assert (
        client.put(
            f"/api/v1/personal-account-references/{via_id}/email",
            headers=admin_a_hdr,
            json={"email": "secret-via-holder@gmail.com"},
        ).status_code
        == 200
    )

    acc_res = client.post(
        "/api/v1/ad-accounts",
        headers=admin_a_hdr,
        json={"display_name": "Alpha Core TKQC", "external_account_id": "act_987654321", "business_manager_id": bm_id},
    )
    assert acc_res.status_code == 201, acc_res.text
    acc_id = acc_res.json()["id"]

    sessions_a = client.get("/api/v1/security/sessions/me", headers=admin_a_hdr).json()
    session_a_id = sessions_a[0]["id"]

    # Cross-tenant IDOR checks: Tenant B owner must receive 404 (never 200 or data disclosure)
    cross_tenant_probes = [
        ("GET", f"/api/v1/ad-accounts/{acc_id}", None),
        ("PATCH", f"/api/v1/ad-accounts/{acc_id}", {"display_name": "Hacked Name"}),
        ("GET", f"/api/v1/business-managers/{bm_id}", None),
        ("PATCH", f"/api/v1/business-managers/{bm_id}", {"name": "Hacked BM"}),
        ("GET", f"/api/v1/personal-account-references/{via_id}", None),
        ("PATCH", f"/api/v1/personal-account-references/{via_id}", {"label": "Hacked Via"}),
        ("POST", f"/api/v1/personal-account-references/{via_id}/reveal-email", {"pin": "246810"}),
        ("POST", f"/api/v1/security/sessions/{session_a_id}/revoke", {"reason": "Attempt cross-tenant revoke"}),
    ]
    for method, url, payload in cross_tenant_probes:
        resp = client.request(method, url, headers=owner_b_hdr, json=payload)
        assert resp.status_code == 404, f"{method} {url} leaked status {resp.status_code}: {resp.text}"
        assert "secret-via-holder" not in resp.text

    # BFLA / intra-tenant privilege escalation: Buyer A must receive 403 on Owner/Admin routes
    assert (
        client.put(
            f"/api/v1/personal-account-references/{via_id}/email",
            headers=buyer_a_hdr,
            json={"email": "hijack@gmail.com"},
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/domain-seo/config",
            headers=buyer_a_hdr,
            json={"custom_domain": "https://buyer-cannot-set.example.com"},
        ).status_code
        == 403
    )
    assert client.get("/api/v1/community/admin/overview", headers=buyer_a_hdr).status_code == 403

    # Verify DB untouched for Admin A's encrypted via record
    with TestingSession() as db:
        sessions_count = db.execute(sa.select(sa.func.count(User.id))).scalar_one()
        assert sessions_count == 3
