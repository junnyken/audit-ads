"""Shared helpers for the O4 tests (vault reader credentials). Not collected.

`o4_env` configures a fake Meta app and a **throwaway** Fernet key generated at test time, and
replaces `meta_reader_credentials.graph_transport` — the only place the credential service gets a
transport — with `FakeGraph`, a scripted Graph that records every call. No test reaches Meta.

Every token here starts with `FAKE-TOKEN-` so a leak check can grep for the prefix in responses,
audit rows, alerts, deliveries and logs.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from cryptography.fernet import Fernet

from app.core.config import get_settings
from app.services import meta_reader_credentials
from app.services.meta_graph_transport import GraphResponse
from app.services.meta_provider import MetaFailureCode

APP_ID = "900000000000001"
APP_SECRET = "o4-test-app-secret-not-real"
CONFIG_ID = "800000000000001"
REDIRECT = "https://api.adsops.example.com/api/v1/meta-reader-credentials/callback"
BM_A = "1993884657458857"
BM_B = "109796697343603"
BM_C = "555000000000003"
TOKEN_PREFIX = "FAKE-TOKEN-"


def new_token() -> str:
    return f"{TOKEN_PREFIX}{uuid.uuid4().hex}"


@dataclass
class TokenSpec:
    kind: str = "SYSTEM_USER"
    valid: bool = True
    scopes: tuple[str, ...] = ("ads_read", "business_management")
    granular_only: bool = False
    app_id: str = APP_ID
    user_id: str = "61550000000777"
    name: str = "AdsOps reader (system user)"
    expires_at: datetime | None = None
    subcode: int | None = None
    readable: tuple[str, ...] = (BM_A,)
    authority: bool = True
    businesses: tuple[tuple[str, str], ...] = ()


@dataclass
class FakeGraph:
    tokens: dict[str, TokenSpec] = field(default_factory=dict)
    codes: dict[str, str] = field(default_factory=dict)
    #: token -> token returned by `fb_exchange_token`
    exchanges: dict[str, str] = field(default_factory=dict)
    #: path -> failure code to force (e.g. rate limit on debug_token)
    failures: dict[str, MetaFailureCode] = field(default_factory=dict)
    calls: list[tuple[str, dict, str]] = field(default_factory=list)

    def issue(self, spec: TokenSpec | None = None, *, code: str | None = None) -> tuple[str, str]:
        token = new_token()
        self.tokens[token] = spec or TokenSpec()
        code = code or f"code-{uuid.uuid4().hex[:12]}"
        self.codes[code] = token
        return code, token

    def transport(self, settings, access_token: str) -> FakeTransport:
        return FakeTransport(self, access_token)

    def paths(self) -> list[str]:
        return [path for path, _, _ in self.calls]


@dataclass
class FakeTransport:
    graph: FakeGraph
    access_token: str

    def get(self, path: str, params: dict[str, str] | None = None) -> GraphResponse:
        params = dict(params or {})
        path = path.strip("/")
        self.graph.calls.append((path, params, self.access_token))
        forced = self.graph.failures.get(path)
        if forced is not None:
            return GraphResponse(ok=False, failure_code=forced)
        if path == "oauth/access_token":
            if params.get("client_secret") != APP_SECRET or params.get("client_id") != APP_ID:
                return GraphResponse(ok=False, failure_code=MetaFailureCode.INVALID_REQUEST)
            if params.get("grant_type") == "fb_exchange_token":
                exchanged = self.graph.exchanges.get(params.get("fb_exchange_token", ""))
                if not exchanged:
                    return GraphResponse(ok=False, failure_code=MetaFailureCode.INVALID_REQUEST)
                return GraphResponse(ok=True, payload={"access_token": exchanged, "token_type": "bearer"})
            token = self.graph.codes.pop(params.get("code", ""), None)
            if token is None:
                return GraphResponse(ok=False, failure_code=MetaFailureCode.INVALID_REQUEST)
            return GraphResponse(ok=True, payload={"access_token": token, "token_type": "bearer"})
        if path == "debug_token":
            if self.access_token != f"{APP_ID}|{APP_SECRET}":
                return GraphResponse(ok=False, failure_code=MetaFailureCode.TOKEN_EXPIRED)
            spec = self.graph.tokens.get(params.get("input_token", ""))
            if spec is None:
                return GraphResponse(ok=True, payload={"data": {"is_valid": False, "app_id": APP_ID}})
            data: dict[str, Any] = {
                "app_id": spec.app_id,
                "type": spec.kind,
                "application": "AdsOps",
                "is_valid": spec.valid,
                "issued_at": int(datetime(2026, 10, 1, tzinfo=UTC).timestamp()),
                "expires_at": int(spec.expires_at.timestamp()) if spec.expires_at else 0,
                "data_access_expires_at": 0,
                "user_id": spec.user_id,
                "granular_scopes": [{"scope": s} for s in spec.scopes],
            }
            if not spec.granular_only:
                data["scopes"] = list(spec.scopes)
            if spec.subcode is not None:
                data["error"] = {"code": 190, "subcode": spec.subcode, "message": "secret-ish Meta text"}
            return GraphResponse(ok=True, payload={"data": data})
        spec = self.graph.tokens.get(self.access_token)
        if spec is None or not spec.valid:
            return GraphResponse(ok=False, failure_code=MetaFailureCode.TOKEN_EXPIRED)
        if path == "me":
            return GraphResponse(ok=True, payload={"id": spec.user_id, "name": spec.name})
        if path == "me/businesses":
            return GraphResponse(
                ok=True,
                payload={"data": [{"id": bm, "name": name, "permitted_roles": ["ADMIN"]} for bm, name in spec.businesses]},
            )
        if path.endswith("/system_users"):
            bm = path.split("/")[0]
            if spec.authority and bm in spec.readable:
                return GraphResponse(ok=True, payload={"data": [{"id": "1"}]})
            return GraphResponse(ok=False, failure_code=MetaFailureCode.PERMISSION_MISSING)
        if path.isdigit():
            if path in spec.readable:
                return GraphResponse(ok=True, payload={"id": path, "name": f"BM {path}"})
            return GraphResponse(ok=False, failure_code=MetaFailureCode.PERMISSION_MISSING)
        return GraphResponse(ok=False, failure_code=MetaFailureCode.UNKNOWN_ERROR)


@pytest.fixture()
def o4_env(monkeypatch):
    settings = get_settings()
    values = {
        "meta_app_id": APP_ID,
        "meta_app_secret": APP_SECRET,
        "meta_login_config_id": CONFIG_ID,
        "meta_oauth_redirect_uri": REDIRECT,
        "meta_login_config_kind": "system_user",
        # Generated now, used by this test only, never written anywhere.
        "credential_vault_key": Fernet.generate_key().decode(),
        "credential_check_every_n_passes": 0,
        "credential_check_batch": 10,
        "credential_expiry_warning_days": 14,
        "credential_renew_before_days": 20,
    }
    for name, value in values.items():
        monkeypatch.setattr(settings, name, value)
    graph = FakeGraph()
    monkeypatch.setattr(meta_reader_credentials, "graph_transport", graph.transport)
    return {"graph": graph, "settings": settings}


def start(api, *, label: str = "FB Triều", bm: str = BM_A, url: str = "/api/v1/meta-reader-credentials/connect/start"):
    response = api.post(url, json={"label": label, "business_manager_reference": bm})
    assert response.status_code == 200, response.text
    query = parse_qs(urlparse(response.json()["url"]).query)
    return query["state"][0], response.json()["url"]


def callback(client, *, code: str | None, state: str | None, error: str | None = None):
    params = {}
    if code is not None:
        params["code"] = code
    if state is not None:
        params["state"] = state
    if error is not None:
        params["error"] = error
    response = client.get("/api/v1/meta-reader-credentials/callback", params=params, follow_redirects=False)
    assert response.status_code == 302, response.text
    location = response.headers["location"]
    query = {key: values[0] for key, values in parse_qs(urlparse(location).query).items()}
    return location, query


def connect(api, client, graph: FakeGraph, spec: TokenSpec | None = None, *, label: str = "FB Triều", bm: str = BM_A):
    """The whole round trip. Returns (callback query, token)."""
    state, _ = start(api, label=label, bm=bm)
    code, token = graph.issue(spec)
    _, query = callback(client, code=code, state=state)
    return query, token


def in_days(days: float) -> datetime:
    return datetime.now(UTC) + timedelta(days=days)
