"""Rate limiting.

Two layers are tested separately, because they fail differently:

  * the bucket arithmetic, with an injected clock — a limiter whose refill is only ever
    exercised by `time.sleep` is a limiter whose window is never really checked; and
  * the middleware wired into a real app, which is where the mistakes live: policy selection,
    identity derivation, and whether a refusal still carries the headers a browser needs.
"""
from __future__ import annotations

import pathlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.rate_limit_middleware import RateLimitMiddleware, _verified_subject
from app.core.config import Settings
from app.core.production_checks import check_settings
from app.core.rate_limit import (
    MAX_TRACKED_IDENTITIES,
    RateLimiter,
    RateLimitPolicy,
    client_address,
)
from app.core.security import create_access_token


class FakeClock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


# --------------------------------------------------------------------------------------
# Bucket arithmetic
# --------------------------------------------------------------------------------------


def test_allows_up_to_the_limit_then_refuses():
    clock = FakeClock()
    limiter = RateLimiter(clock=clock)
    policy = RateLimitPolicy(name="auth", limit=3, window_seconds=60)

    assert [limiter.check(policy, "a").allowed for _ in range(3)] == [True, True, True]
    decision = limiter.check(policy, "a")
    assert decision.allowed is False
    assert decision.remaining == 0
    assert decision.retry_after_seconds >= 1


def test_refill_is_continuous_not_a_window_boundary():
    """The reason for a bucket over a fixed window: no double burst at the boundary."""
    clock = FakeClock()
    limiter = RateLimiter(clock=clock)
    policy = RateLimitPolicy(name="auth", limit=10, window_seconds=100)  # 1 token / 10s

    for _ in range(10):
        assert limiter.check(policy, "a").allowed
    assert limiter.check(policy, "a").allowed is False

    clock.advance(10)  # exactly one token
    assert limiter.check(policy, "a").allowed
    assert limiter.check(policy, "a").allowed is False


def test_bucket_never_refills_past_its_capacity():
    clock = FakeClock()
    limiter = RateLimiter(clock=clock)
    policy = RateLimitPolicy(name="auth", limit=3, window_seconds=30)

    limiter.check(policy, "a")
    clock.advance(10_000)  # idle for hours
    assert [limiter.check(policy, "a").allowed for _ in range(3)] == [True, True, True]
    # Capacity is 3, not 3 + hours of accrual.
    assert limiter.check(policy, "a").allowed is False


def test_identities_and_policies_do_not_share_a_bucket():
    limiter = RateLimiter(clock=FakeClock())
    auth = RateLimitPolicy(name="auth", limit=1, window_seconds=60)
    api = RateLimitPolicy(name="api", limit=1, window_seconds=60)

    assert limiter.check(auth, "a").allowed
    assert limiter.check(auth, "a").allowed is False
    assert limiter.check(auth, "b").allowed, "a second caller must be unaffected"
    assert limiter.check(api, "a").allowed, "a different policy is a different bucket"


def test_retry_after_reflects_the_actual_wait():
    clock = FakeClock()
    limiter = RateLimiter(clock=clock)
    policy = RateLimitPolicy(name="auth", limit=1, window_seconds=60)

    limiter.check(policy, "a")
    decision = limiter.check(policy, "a")
    # One token per 60s, and the bucket is empty: the wait is about a full window.
    assert 55 <= decision.retry_after_seconds <= 62

    clock.advance(decision.retry_after_seconds)
    assert limiter.check(policy, "a").allowed, "the advertised wait must actually be enough"


def test_scaling_divides_the_allowance_across_processes():
    policy = RateLimitPolicy(name="api", limit=300, window_seconds=60)
    assert policy.scaled(1).limit == 300
    assert policy.scaled(4).limit == 75
    # Never zero: more workers than the limit must not mean "refuse everything".
    assert RateLimitPolicy(name="api", limit=3, window_seconds=60).scaled(10).limit == 1


def test_tracked_identities_are_bounded():
    """The limiter must not become the memory exhaustion it prevents."""
    clock = FakeClock()
    limiter = RateLimiter(clock=clock)
    policy = RateLimitPolicy(name="api", limit=5, window_seconds=60)

    for index in range(MAX_TRACKED_IDENTITIES + 500):
        limiter.check(policy, f"caller-{index}")
    assert len(limiter._buckets) <= MAX_TRACKED_IDENTITIES

    # Eviction is generous, never punitive: an evicted caller gets a fresh, full bucket.
    assert limiter.check(policy, "caller-0").allowed


@pytest.mark.parametrize("limit,window", [(0, 60), (-1, 60), (5, 0), (5, -1)])
def test_a_meaningless_policy_is_refused_at_construction(limit, window):
    with pytest.raises(ValueError):
        RateLimitPolicy(name="x", limit=limit, window_seconds=window)


# --------------------------------------------------------------------------------------
# Client address
# --------------------------------------------------------------------------------------


def test_forwarded_for_is_ignored_when_no_proxy_is_configured():
    """Otherwise a client sets the header itself and gets a fresh bucket per request."""
    address = client_address(
        peer="10.0.0.1", forwarded_for="1.2.3.4, 5.6.7.8", trusted_proxy_hops=0
    )
    assert address == "10.0.0.1"


def test_forwarded_for_is_counted_from_the_right():
    # One trusted proxy: the rightmost entry is the address it observed.
    assert (
        client_address(peer="10.0.0.1", forwarded_for="1.1.1.1, 2.2.2.2", trusted_proxy_hops=1)
        == "2.2.2.2"
    )
    # Two: step one further left.
    assert (
        client_address(
            peer="10.0.0.1", forwarded_for="1.1.1.1, 2.2.2.2, 3.3.3.3", trusted_proxy_hops=2
        )
        == "2.2.2.2"
    )


def test_a_short_forwarded_chain_does_not_index_past_the_start():
    """A spoofed short chain must not throw, and must not read the client's own claim."""
    assert (
        client_address(peer="10.0.0.1", forwarded_for="9.9.9.9", trusted_proxy_hops=3) == "9.9.9.9"
    )


def test_a_missing_peer_is_a_stable_placeholder_not_a_crash():
    assert client_address(peer=None, forwarded_for=None, trusted_proxy_hops=0) == "unknown"


# --------------------------------------------------------------------------------------
# Identity from a token
# --------------------------------------------------------------------------------------


def test_an_unverified_token_is_anonymous():
    """Trusting a decoded-but-unverified subject would let a caller drain a victim's bucket."""
    forged = (
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
        "eyJzdWIiOiJ2aWN0aW0iLCJleHAiOjk5OTk5OTk5OTl9."
        "not-a-real-signature"
    )
    assert _verified_subject(f"Bearer {forged}") is None


def test_a_valid_token_yields_its_subject():
    token, _ = create_access_token(subject="user-1", workspace_id="ws-1", role="owner")
    assert _verified_subject(f"Bearer {token}") == "user-1"


def test_an_extension_installation_gets_its_own_bucket():
    token, _ = create_access_token(
        subject="user-1",
        workspace_id="ws-1",
        role="owner",
        token_use="extension",
        extra_claims={"installation_id": "inst-9"},
    )
    assert _verified_subject(f"Bearer {token}") == "user-1:inst-9"


@pytest.mark.parametrize("header", [None, "", "Bearer", "Bearer ", "Basic abc", "garbage"])
def test_a_malformed_authorization_header_is_anonymous(header):
    assert _verified_subject(header) is None


# --------------------------------------------------------------------------------------
# The middleware in an app
# --------------------------------------------------------------------------------------


def _app(**overrides) -> FastAPI:
    # Field names, not env-var names: Settings uses extra="ignore", so a mistyped or
    # upper-cased keyword is dropped in silence and the test would pass vacuously.
    fields = {
        "jwt_secret": "test-secret-not-used-in-production",
        # Alias, not field name — see the note on Settings.cors_origins_raw.
        "CORS_ORIGINS": "https://dashboard.example.com",
        "rate_limit_enabled": True,
    }
    fields.update(overrides)
    settings = Settings(**fields)
    app = FastAPI()

    @app.get("/api/v1/things")
    def things() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/api/v1/auth/login")
    def login() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/api/v1/extension/connect")
    def connect() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/health/ready")
    def ready() -> dict[str, bool]:
        return {"ok": True}

    app.add_middleware(RateLimitMiddleware, settings=settings)
    return app


def test_login_is_limited_and_answers_with_the_project_error_envelope():
    client = TestClient(_app(rate_limit_auth_attempts=3, rate_limit_auth_window_seconds=300))

    for _ in range(3):
        assert client.post("/api/v1/auth/login").status_code == 200

    refused = client.post("/api/v1/auth/login")
    assert refused.status_code == 429
    assert refused.json()["error"]["code"] == "rate_limited"
    assert int(refused.headers["Retry-After"]) >= 1
    assert refused.headers["X-RateLimit-Remaining"] == "0"


def test_the_extension_connect_route_shares_the_strict_auth_budget():
    """Both routes exchange a credential, so both are brute-force surface."""
    client = TestClient(_app(rate_limit_auth_attempts=2, rate_limit_auth_window_seconds=300))

    assert client.post("/api/v1/auth/login").status_code == 200
    assert client.post("/api/v1/extension/connect").status_code == 200
    assert client.post("/api/v1/extension/connect").status_code == 429


def test_the_general_budget_is_separate_from_the_auth_budget():
    client = TestClient(
        _app(rate_limit_auth_attempts=1, rate_limit_api_requests=5, rate_limit_api_window_seconds=60)
    )
    assert client.post("/api/v1/auth/login").status_code == 200
    assert client.post("/api/v1/auth/login").status_code == 429
    # Exhausting login must not lock the operator out of the rest of the API.
    assert client.get("/api/v1/things").status_code == 200


def test_two_authenticated_subjects_do_not_share_a_bucket():
    """One operator on a shared office address must not exhaust everyone else's allowance."""
    client = TestClient(_app(rate_limit_api_requests=2, rate_limit_api_window_seconds=60))
    first, _ = create_access_token(subject="user-1", workspace_id="ws", role="owner")
    second, _ = create_access_token(subject="user-2", workspace_id="ws", role="owner")

    for _ in range(2):
        assert client.get("/api/v1/things", headers={"Authorization": f"Bearer {first}"}).status_code == 200
    assert client.get("/api/v1/things", headers={"Authorization": f"Bearer {first}"}).status_code == 429
    assert client.get("/api/v1/things", headers={"Authorization": f"Bearer {second}"}).status_code == 200


def test_health_probes_are_never_limited():
    """A limited probe turns a busy minute into a restart loop."""
    client = TestClient(_app(rate_limit_api_requests=1, rate_limit_auth_attempts=1))
    for _ in range(20):
        assert client.get("/health/ready").status_code == 200


def test_a_refusal_still_carries_cors_headers():
    """Without these a browser shows an opaque CORS error instead of the real reason."""
    app = _app(rate_limit_auth_attempts=1)
    from fastapi.middleware.cors import CORSMiddleware

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["https://dashboard.example.com"],
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
        expose_headers=["Retry-After"],
    )
    client = TestClient(app)
    origin = {"Origin": "https://dashboard.example.com"}

    assert client.post("/api/v1/auth/login", headers=origin).status_code == 200
    refused = client.post("/api/v1/auth/login", headers=origin)
    assert refused.status_code == 429
    assert refused.headers["access-control-allow-origin"] == "https://dashboard.example.com"


def test_the_limiter_can_be_switched_off():
    client = TestClient(_app(rate_limit_enabled=False, rate_limit_auth_attempts=1))
    for _ in range(10):
        assert client.post("/api/v1/auth/login").status_code == 200


def test_a_disabled_limiter_is_a_production_configuration_error():
    settings = Settings(
        environment="production",
        jwt_secret="a" * 40,
        cors_origins_raw="https://adsops.example.com",
        public_app_url="https://adsops.example.com",
        release_version="abc1234",
        enable_api_docs=False,
        rate_limit_enabled=False,
    )
    codes = {finding.code for finding in check_settings(settings)}
    assert "rate_limit_disabled_in_production" in codes


# --------------------------------------------------------------------------------------
# The deployed image must not hand the limiter a spoofable address
# --------------------------------------------------------------------------------------


def test_the_api_image_does_not_let_uvicorn_rewrite_the_client_address():
    """A guard, not a style check.

    `uvicorn --proxy-headers --forwarded-allow-ips "*"` sets `always_trust`, and
    `_TrustedHosts.get_trusted_client_host` then returns `x_forwarded_for[0]` — the FIRST
    entry, which is whatever the client wrote. uvicorn overwrites `request.client.host` with
    it, so the login bucket would be keyed on a value the attacker chooses and the
    brute-force bound would be worth nothing. The forwarded chain is honoured in
    `client_address()` instead, which counts from the right by a configured hop count.
    """
    dockerfile = (pathlib.Path(__file__).resolve().parents[1] / "Dockerfile").read_text()
    # Comment lines are excluded on purpose: the CMD above them explains at length why these
    # flags are absent, and a guard that trips over its own rationale is a guard people delete.
    instructions = "\n".join(
        line for line in dockerfile.splitlines() if not line.lstrip().startswith("#")
    )
    assert "--proxy-headers" not in instructions
    assert "--forwarded-allow-ips" not in instructions


def test_a_spoofed_forwarded_header_cannot_mint_a_fresh_bucket():
    """The end-to-end version of the same concern, through the real middleware."""
    client = TestClient(_app(rate_limit_auth_attempts=2, rate_limit_auth_window_seconds=300))

    assert client.post("/api/v1/auth/login", headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 200
    assert client.post("/api/v1/auth/login", headers={"X-Forwarded-For": "2.2.2.2"}).status_code == 200
    # A third address, a third header value — and still the same bucket, because hops is 0.
    assert client.post("/api/v1/auth/login", headers={"X-Forwarded-For": "3.3.3.3"}).status_code == 429
