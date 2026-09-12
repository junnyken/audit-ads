"""A10 — the real Meta provider and its Graph transport.

**Nothing here touches the network.** The transport is exercised against a stubbed
`urllib.request.urlopen`, and the provider against a stub transport. If any test in this file
ever makes a real call, that is the bug — CLAUDE.md rule 22 and A9 guardrail 29 both forbid it,
and CI would be issuing live API calls on someone's Business Manager.
"""
from __future__ import annotations

import io
import json
import urllib.error
from dataclasses import dataclass

import pytest

from app.services.meta_graph_transport import GraphResponse, MetaGraphTransport
from app.services.meta_provider import MetaFailureCode
from app.services.meta_real_provider import (
    MetaWriteNotEnabled,
    RealMetaBusinessProvider,
    build_real_provider,
)


def _http_error(status: int, graph_code: int | None = None) -> urllib.error.HTTPError:
    body = json.dumps({"error": {"code": graph_code, "message": "act_123 something"}}).encode()
    return urllib.error.HTTPError(
        url="https://graph.facebook.com/v21.0/me/businesses",
        code=status,
        msg="error",
        hdrs={},  # type: ignore[arg-type]
        fp=io.BytesIO(body),
    )


@dataclass
class StubTransport:
    """Stands in for `MetaGraphTransport`. Records what was asked for; answers from a script."""

    response: GraphResponse
    calls: list[tuple[str, dict | None]] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        self.calls = []

    def get(self, path: str, params: dict | None = None) -> GraphResponse:
        self.calls.append((path, params))
        return self.response


# ------------------------------------------------------------------------------- transport


def test_the_transport_is_get_only_by_construction():
    """The read-only guarantee is structural: there is no method here that can write. If a
    later change adds one, this test is the thing that should have to be deleted first."""
    write_verbs = {"post", "put", "patch", "delete", "request"}
    public = {name for name in dir(MetaGraphTransport) if not name.startswith("_")}
    assert not (public & write_verbs), public & write_verbs
    assert "get" in public


def test_a_missing_token_never_reaches_the_network(monkeypatch):
    called = False

    def fail(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("urlopen must not be called without a token")

    monkeypatch.setattr("urllib.request.urlopen", fail)
    result = MetaGraphTransport(access_token="").get("me/businesses")

    assert called is False
    assert result.ok is False
    assert result.failure_code == MetaFailureCode.PERMISSION_MISSING


def test_the_url_pins_the_configured_version_and_host(monkeypatch):
    seen: dict = {}

    class _Response:
        headers = {"X-Business-Use-Case-Usage": "{}"}

        def read(self):
            return b'{"data": []}'

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def capture(request, timeout=None):
        seen["url"] = request.full_url
        seen["method"] = request.get_method()
        seen["auth"] = request.get_header("Authorization")
        return _Response()

    monkeypatch.setattr("urllib.request.urlopen", capture)
    MetaGraphTransport(
        access_token="tok", api_base_url="https://graph.facebook.com", api_version="v21.0"
    ).get("me/businesses", {"limit": "1"})

    assert seen["url"].startswith("https://graph.facebook.com/v21.0/me/businesses?")
    assert seen["method"] == "GET"
    # The token goes in the header, not the query string — a query string ends up in proxy logs.
    assert seen["auth"] == "Bearer tok"
    assert "tok" not in seen["url"]


@pytest.mark.parametrize(
    ("status", "graph_code", "expected"),
    [
        (401, 190, MetaFailureCode.TOKEN_EXPIRED),
        (400, 190, MetaFailureCode.TOKEN_EXPIRED),  # Graph often returns 400 for a dead token
        (429, None, MetaFailureCode.RATE_LIMITED),
        (400, 4, MetaFailureCode.RATE_LIMITED),  # app-level rate limit arrives as a 400
        (403, None, MetaFailureCode.PERMISSION_MISSING),
        (400, 200, MetaFailureCode.PERMISSION_MISSING),
        (500, None, MetaFailureCode.PROVIDER_SERVER_ERROR),
        (400, None, MetaFailureCode.INVALID_REQUEST),
        (418, None, MetaFailureCode.UNKNOWN_ERROR),
    ],
)
def test_graph_errors_map_onto_this_products_own_vocabulary(monkeypatch, status, graph_code, expected):
    def raise_http(*args, **kwargs):
        raise _http_error(status, graph_code)

    monkeypatch.setattr("urllib.request.urlopen", raise_http)
    result = MetaGraphTransport(access_token="tok").get("me/businesses")

    assert result.ok is False
    assert result.failure_code == expected


def test_a_failed_response_never_echoes_metas_message_back(monkeypatch):
    """Meta's `error.message` repeats request parameters, which can name a Business Manager."""

    def raise_http(*args, **kwargs):
        raise _http_error(400, 100)

    monkeypatch.setattr("urllib.request.urlopen", raise_http)
    result = MetaGraphTransport(access_token="tok").get("me/businesses")

    assert "act_123" not in (result.failure_summary or "")


def test_a_timeout_maps_to_timeout_not_a_failure(monkeypatch):
    """`TIMEOUT` is the code the batch engine turns into `unknown` and never auto-retries."""

    def raise_timeout(*args, **kwargs):
        raise TimeoutError

    monkeypatch.setattr("urllib.request.urlopen", raise_timeout)
    result = MetaGraphTransport(access_token="tok").get("me/businesses")

    assert result.failure_code == MetaFailureCode.TIMEOUT


# -------------------------------------------------------------------------------- provider


def test_capability_check_reports_read_access_and_refuses_to_claim_writes():
    provider = RealMetaBusinessProvider(
        transport=StubTransport(GraphResponse(ok=True, payload={"data": [{"id": "1"}]}))
    )
    check = provider.check_capability()

    assert check.list_business_managers is True
    # The build cannot write, so a capability check must not report that it can.
    assert check.create_ad_account is False
    assert check.share_ad_account_access is False
    assert check.share_pixel_access is False
    assert check.reason == MetaFailureCode.NOT_SUPPORTED


def test_a_failed_call_reports_every_capability_false_with_the_real_reason():
    provider = RealMetaBusinessProvider(
        transport=StubTransport(
            GraphResponse(ok=False, failure_code=MetaFailureCode.TOKEN_EXPIRED)
        )
    )
    check = provider.check_capability()

    assert check.list_business_managers is False
    assert check.reason == MetaFailureCode.TOKEN_EXPIRED


def test_listing_business_managers_maps_the_graph_shape():
    provider = RealMetaBusinessProvider(
        transport=StubTransport(
            GraphResponse(ok=True, payload={"data": [{"id": "123", "name": "Agency BM"}]})
        )
    )
    assert provider.list_business_managers() == [{"external_id": "123", "name": "Agency BM"}]


def test_listing_returns_empty_rather_than_inventing_rows_on_failure():
    provider = RealMetaBusinessProvider(
        transport=StubTransport(GraphResponse(ok=False, failure_code=MetaFailureCode.RATE_LIMITED))
    )
    assert provider.list_business_managers() == []


def test_capability_check_makes_exactly_one_bounded_call():
    """Rate-limit budget on a real BM is a real cost — discovery must not fan out."""
    stub = StubTransport(GraphResponse(ok=True, payload={"data": []}))
    RealMetaBusinessProvider(transport=stub).check_capability()

    assert len(stub.calls) == 1
    path, params = stub.calls[0]
    assert path == "me/businesses"
    assert params == {"limit": "1", "fields": "id,name"}


def test_a_200_carrying_no_business_is_not_reported_as_capability():
    """Regression, proven against real Meta on 2026-09-10 before it was fixed.

    A system user token gets `200 {"data": []}` from `me/businesses`. The old code derived the
    capability from `response.ok` alone, so it answered `True`, the route's guard passed, the
    listing returned `[]`, and the connection was stored as "capability confirmed, zero Business
    Managers". Rule 4: a success carrying nothing is absence of evidence, not evidence of access.
    """
    provider = RealMetaBusinessProvider(
        transport=StubTransport(GraphResponse(ok=True, payload={"data": []}))
    )
    check = provider.check_capability()

    assert check.list_business_managers is False
    assert check.reason == MetaFailureCode.NOT_CONFIGURED


def test_a_configured_business_id_is_read_directly_instead_of_the_empty_edge():
    """Meta will not name the business behind a system user token, so the id is configuration."""
    stub = StubTransport(GraphResponse(ok=True, payload={"id": "1993884657458857", "name": "Quảng Cáo Top"}))
    provider = RealMetaBusinessProvider(transport=stub, business_id="1993884657458857")

    assert provider.list_business_managers() == [
        {"external_id": "1993884657458857", "name": "Quảng Cáo Top"}
    ]
    path, params = stub.calls[0]
    assert path == "1993884657458857"  # the BM node, not `me/businesses`
    assert params == {"fields": "id,name"}


def test_a_configured_business_id_that_resolves_to_nothing_is_not_a_capability():
    provider = RealMetaBusinessProvider(
        transport=StubTransport(GraphResponse(ok=True, payload={})), business_id="404"
    )

    assert provider.list_business_managers() == []
    assert provider.check_capability().list_business_managers is False


def test_the_capability_and_the_listing_it_gates_cannot_disagree():
    """`meta_operations.py` calls the listing only when the capability says `True`. If the two
    read different endpoints they can contradict each other, which is precisely how a connection
    came to be stored as "confirmed" with nothing in it. One helper now backs both."""
    for payload in ({"data": []}, {"data": [{"id": "7", "name": "BM"}]}):
        provider = RealMetaBusinessProvider(transport=StubTransport(GraphResponse(ok=True, payload=payload)))
        assert provider.check_capability().list_business_managers is bool(provider.list_business_managers())


# ----------------------------------------------------------------------- the write refusal


@pytest.mark.parametrize(
    ("method", "argument"),
    [
        ("create_ad_account", object()),
        ("share_ad_account_access", object()),
        ("share_pixel_access", object()),
    ],
)
def test_every_write_raises_rather_than_silently_doing_nothing(method, argument):
    """A failed *result* would flow into the batch engine's retry machinery as though the
    attempt had really happened. It did not, so this raises instead."""
    provider = RealMetaBusinessProvider(transport=StubTransport(GraphResponse(ok=True)))

    with pytest.raises(MetaWriteNotEnabled):
        getattr(provider, method)(argument)


def test_a_write_attempt_never_reaches_the_transport():
    stub = StubTransport(GraphResponse(ok=True))
    provider = RealMetaBusinessProvider(transport=stub)

    with pytest.raises(MetaWriteNotEnabled):
        provider.create_ad_account(object())

    assert stub.calls == []


def test_the_probe_cannot_contradict_the_capability_it_exists_to_verify():
    """Found by a real run on 2026-09-10, after the "one shared helper" fix was already in.

    `probe()` still asked `me/businesses` directly while `check_capability()` read the
    configured BM node, so the operator's own live verification printed `visible now : 0` on a
    token that could demonstrably read the Business Manager. A live probe that contradicts the
    product is worse than either answer alone: it makes both untrustworthy. The bug was a third
    reader outside the helper, not the endpoint it happened to choose.
    """
    stub = StubTransport(GraphResponse(ok=True, payload={"id": "199", "name": "Configured BM"}))
    provider = RealMetaBusinessProvider(transport=stub, business_id="199")

    found, response = provider.probe()

    assert response.ok is True
    assert [bm["external_id"] for bm in found] == ["199"]
    assert provider.check_capability().list_business_managers is True


def test_no_public_reader_bypasses_the_configured_business_manager():
    """The structural guard. Each reader is exercised alone and must have asked for the BM node;
    any of them reaching for `me/businesses` while an id is configured is the defect above."""
    for reader in ("probe", "check_capability", "list_business_managers"):
        stub = StubTransport(GraphResponse(ok=True, payload={"id": "199", "name": "Configured BM"}))
        provider = RealMetaBusinessProvider(transport=stub, business_id="199")

        getattr(provider, reader)()

        assert [path for path, _ in stub.calls] == ["199"], f"{reader} bypassed the configured BM"


def test_reconcile_has_nothing_to_reconcile():
    provider = RealMetaBusinessProvider(transport=StubTransport(GraphResponse(ok=True)))
    assert provider.reconcile_create("any-key") is None


# ------------------------------------------------------------------------- provider choice


def test_build_real_provider_passes_the_configured_version_through():
    from app.core.config import get_settings

    settings = get_settings()
    provider = build_real_provider(settings)

    assert provider.transport.api_version == settings.meta_graph_api_version
    assert provider.transport.api_base_url == settings.meta_graph_api_base_url
    # The BM id is configuration too — a provider built without it can only report
    # `not_configured`, never a quiet empty success.
    assert provider.business_id == settings.meta_business_id


class _Connection:
    """Stands in for a `MetaConnection` in the provider-selection tests.

    It has to carry every field `_provider_for` reads, and a hand-rolled stub does not grow a new
    one when the model does — A10.3 added `business_manager_reference` and these two tests went
    red on an `AttributeError`, which is the stub being out of date rather than the code being
    wrong. Defaulting it to empty keeps the existing cases meaning what they meant: inherit the
    server's Business Manager.
    """

    def __init__(self, environment, business_manager_reference: str = ""):
        self.environment = environment
        self.business_manager_reference = business_manager_reference


def test_the_fake_provider_stays_the_default_when_no_token_is_configured():
    """Half of "two independent conditions", with the condition actually set.

    This test used to assert that `production` yields the fake provider while merely *hoping*
    no token was configured — it read the developer's own `backend/.env`. It passed for as long
    as nobody had a real token, and went red the moment one was added, reporting correct
    behaviour as a failure. Worse, the interesting half — that a configured token *does* reach
    the real provider — was never tested at all.
    """
    from app.api.v1.routers.meta_operations import _provider_for
    from app.core.config import get_settings
    from app.core.enums import MetaEnvironment
    from app.services.meta_provider import FakeMetaBusinessProvider

    settings = get_settings()
    previous = settings.meta_access_token
    settings.meta_access_token = ""
    try:
        for environment in MetaEnvironment:
            assert isinstance(_provider_for(_Connection(environment)), FakeMetaBusinessProvider)
    finally:
        settings.meta_access_token = previous


def test_only_production_plus_a_configured_token_reaches_the_real_provider():
    """The other half. `fake` and `sandbox` stay fake even with a token present, so a token
    configured for one connection cannot silently upgrade another."""
    from app.api.v1.routers.meta_operations import _provider_for
    from app.core.config import get_settings
    from app.core.enums import MetaEnvironment
    from app.services.meta_provider import FakeMetaBusinessProvider

    settings = get_settings()
    previous = settings.meta_access_token
    settings.meta_access_token = "a-configured-token"
    try:
        for environment in (MetaEnvironment.FAKE, MetaEnvironment.SANDBOX):
            assert isinstance(_provider_for(_Connection(environment)), FakeMetaBusinessProvider)

        real = _provider_for(_Connection(MetaEnvironment.PRODUCTION))
        assert isinstance(real, RealMetaBusinessProvider)
        # And it still cannot write, which is the point of the whole arrangement.
        assert real.writes_are_real is True
        with pytest.raises(MetaWriteNotEnabled):
            real.create_ad_account(object())
    finally:
        settings.meta_access_token = previous


def test_a_connections_own_business_manager_reaches_the_real_provider():
    """A10.3. The column is worth nothing if the id stops at the database.

    Asserted on the object that actually talks to Meta, because that is where the wrong id would
    do damage: a provider built with the server's Business Manager would read the server's assets
    and record them against a connection that names a different business — which is the defect
    this column exists to close, reappearing one layer down.
    """
    from app.api.v1.routers.meta_operations import _provider_for
    from app.core.config import get_settings
    from app.core.enums import MetaEnvironment

    settings = get_settings()
    previous_token, previous_bm = settings.meta_access_token, settings.meta_business_id
    settings.meta_access_token = "a-configured-token"
    settings.meta_business_id = "1993884657458857"
    try:
        named = _provider_for(_Connection(MetaEnvironment.PRODUCTION, "109796697343603"))
        assert named.business_id == "109796697343603"

        # And a connection that names nothing still inherits the server's, as it always did.
        inherited = _provider_for(_Connection(MetaEnvironment.PRODUCTION))
        assert inherited.business_id == "1993884657458857"
    finally:
        settings.meta_access_token = previous_token
        settings.meta_business_id = previous_bm
