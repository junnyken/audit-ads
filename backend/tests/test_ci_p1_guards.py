"""Offline regression tests; run with --noconftest and an unreachable dummy DB."""
from __future__ import annotations

import ast
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from pydantic import ValidationError as PydanticValidationError

from app.api.v1.routers import community, extension, google_ads_sync, meta_operations, playbooks
from app.core.errors import ForbiddenFieldError, NotFoundError, ValidationError
from app.main import create_app
from app.schemas.auth import LoginRequest, PrecheckSignupRequest
from app.schemas.common import StrictPayload
from app.schemas.meta_operations import QuickSyncRequest

ORDINARY = [
    community.CommunityPolicyPutRequest, community.WorkspaceGovernancePatchRequest,
    community.AllowlistRemoveRequest, community.AllowlistEmailRequest,
    community.VerifyCanaryRequest, community.InviteCodeCreateRequest,
    community.InviteCodePatchRequest, community.RedeemCodeRequest,
    playbooks.PlaybookCreateInput, playbooks.PlaybookPatchInput,
    playbooks.PlaybookRateInput, playbooks.PlaybookRecordRunInput,
    extension.ExtensionPackageBundleRequest, google_ads_sync.GoogleAdsScriptReportIn,
    PrecheckSignupRequest, QuickSyncRequest,
]


@pytest.mark.parametrize("model", ORDINARY)
@pytest.mark.parametrize("field", ["password", "access_token", "cookie", "proxy_password"])
def test_ordinary_requests_reject_secrets(model, field):
    assert issubclass(model, StrictPayload)
    with pytest.raises(ForbiddenFieldError):
        model.model_validate({field: "must-not-be-accepted"})


@pytest.mark.parametrize("model,payload", [
    (playbooks.PlaybookCreateInput, {"title": "example", "steps": [{"cookie": "secret"}]}),
    (extension.ExtensionPackageBundleRequest, {"bundled_accounts": [{"access_token": "secret"}]}),
    (google_ads_sync.GoogleAdsScriptReportIn, {"accounts": [{"daily": [{"password": "secret"}]}]}),
])
def test_nested_ordinary_requests_reject_secrets(model, payload):
    with pytest.raises(ForbiddenFieldError):
        model.model_validate(payload)


def test_ordinary_unknown_fields_are_forbidden():
    with pytest.raises(PydanticValidationError):
        playbooks.PlaybookRateInput(stars=5, unrecognized=True)


def test_existing_login_exception_accepts_only_declared_fields_and_redacts_audit():
    from app.core.security import hash_password, verify_password
    from app.services.audit import AuditLogService

    raw = "offline-test-password"
    body = LoginRequest(email="owner@adsops-fixture.vn", password=raw)
    with pytest.raises(PydanticValidationError):
        LoginRequest(email=body.email, password=raw, cookie="unexpected")
    hashed = hash_password(body.password)
    assert raw not in hashed
    assert verify_password(raw, hashed)
    session = Mock()
    audit = AuditLogService(session, workspace_id=uuid.uuid4(), actor_id=uuid.uuid4())
    audit.record(action="test", entity_type="test", entity_id="test", after=body.model_dump())
    row = session.add.call_args.args[0]
    assert raw not in str(row.after_json)
    assert row.after_json["password"] == "[REDACTED]"


def test_original_six_delete_guards_without_database():
    # Execute the original assertions verbatim, avoiding integration conftest imports.
    app = create_app()
    names = {
        "test_a4_api.py": "test_no_delete_route_was_introduced",
        "test_health_security.py": "test_a2_adds_no_delete_endpoint",
        "test_a5_extension_api.py": "test_the_extension_surface_adds_no_delete_route",
        "test_registry_api.py": "test_no_hard_delete_endpoint_exists",
        "test_a6_preflight_api.py": "test_no_hard_delete_endpoint_exists",
        "test_alert_security.py": "test_a3_adds_no_delete_endpoint",
    }
    for file, name in names.items():
        tree = ast.parse(Path(__file__).with_name(file).read_text())
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
        namespace = {}
        exec(compile(ast.Module(body=[node], type_ignores=[]), file, "exec"), namespace)
        namespace[name](app)


def _run_request_optout_guard(app):
    # Run the exact reviewed route/fieldset contract without DB fixtures.
    from fastapi.routing import APIRoute
    from pydantic import BaseModel

    path = Path(__file__).with_name("test_f1_facebook_identities.py")
    tree = ast.parse(path.read_text())
    name = "test_only_the_documented_request_bodies_opt_out_of_strict_payload"
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    namespace = {"_PRE_F1_OPT_OUTS": set(), "APIRoute": APIRoute, "BaseModel": BaseModel}
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), "exec"), namespace)
    namespace[name](app)


def test_page_archive_keeps_history_and_links_and_commits_after_audit(monkeypatch):
    page = SimpleNamespace(id=uuid.uuid4(), external_page_id=None, archived_at=None)
    ctx = SimpleNamespace(session=Mock(), workspace_id=uuid.uuid4(), audit=Mock(), commit=Mock())
    events = []
    ctx.audit.record.side_effect = lambda **kw: events.append(("audit", kw))
    ctx.commit.side_effect = lambda: events.append(("commit", None))
    monkeypatch.setattr(meta_operations, "get_or_404", lambda *a, **kw: page)
    monkeypatch.setattr(meta_operations, "_build_pages_summary", lambda *a, **kw: {"items": []})
    result = meta_operations.archive_unsynced_page_draft(ctx, page.id)
    assert page.archived_at is not None
    assert result["discarded_page_id"] == str(page.id)
    assert [e[0] for e in events] == ["audit", "commit"]
    assert events[0][1]["action"] == "page.archived"
    assert events[0][1]["after"]["archived_at"] == page.archived_at.isoformat()
    ctx.session.delete.assert_not_called()
    ctx.session.execute.assert_not_called()


def test_synced_page_archive_denied(monkeypatch):
    page = SimpleNamespace(id=uuid.uuid4(), external_page_id="123", archived_at=None)
    ctx = SimpleNamespace(session=Mock(), workspace_id=uuid.uuid4(), audit=Mock(), commit=Mock())
    monkeypatch.setattr(meta_operations, "get_or_404", lambda *a, **kw: page)
    with pytest.raises(ValidationError):
        meta_operations.archive_unsynced_page_draft(ctx, page.id)
    assert page.archived_at is None
    ctx.audit.record.assert_not_called()
    ctx.commit.assert_not_called()


def test_retainer_archive_reuses_existing_read_state(monkeypatch):
    ctx = SimpleNamespace(session=Mock(), workspace_id=uuid.uuid4(), audit=Mock(), commit=Mock())
    monkeypatch.setattr(meta_operations, "_build_retainers_overview", lambda *a: {"items": [{"id": "local"}]})
    meta_operations.archive_client_retainer(ctx, "local")
    args = ctx.audit.record.call_args.kwargs
    assert args["action"] == "client_retainer.updated"
    assert args["metadata"]["status"] == "ARCHIVED"
    assert args["metadata"]["archived_at"]
    ctx.commit.assert_called_once()
    ctx.session.delete.assert_not_called()
    ctx.audit.record.reset_mock()
    ctx.commit.reset_mock()
    with pytest.raises(NotFoundError):
        meta_operations.archive_client_retainer(ctx, "another-workspace")
    ctx.audit.record.assert_not_called()
    ctx.commit.assert_not_called()


def test_retainer_overview_replays_archive_and_preserves_legacy_delete(monkeypatch):
    from app.api.v1.routers import ad_accounts
    from app.services import spend_service

    monkeypatch.setattr(ad_accounts, "_reconcile_production_bm_links", lambda *a: None)
    monkeypatch.setattr(ad_accounts, "_build_billing_meta_map", lambda *a: {})
    monkeypatch.setattr(spend_service, "list_compact_reads", lambda *a: {})
    rows = [
        SimpleNamespace(entity_id="archived", action="client_retainer.created", metadata_json={"status": "ACTIVE"}),
        SimpleNamespace(entity_id="legacy", action="client_retainer.created", metadata_json={"status": "ACTIVE"}),
        SimpleNamespace(entity_id="archived", action="client_retainer.updated", metadata_json={"status": "ARCHIVED", "archived_at": "2026-11-28T00:00:00Z"}),
        SimpleNamespace(entity_id="legacy", action="client_retainer.deleted", metadata_json={}),
    ]
    session = Mock()
    empty = Mock()
    empty.scalars.return_value.all.return_value = []
    empty.all.return_value = []
    history = Mock()
    history.scalars.return_value.all.return_value = rows
    session.execute.side_effect = [empty, empty, history]
    result = meta_operations._build_retainers_overview(session, uuid.uuid4(), Mock())
    assert result["items"] == []
    assert len(rows) == 4  # replay never mutates/removes the source history
    session.delete.assert_not_called()


# These payloads exercise every declared field, including optional protocol proofs.
from app.schemas import auth as auth_schemas

AUTH_PAYLOADS = [
    (auth_schemas.ForgotPasswordRequest, {"email": "owner@adsops-fixture.vn", "turnstile_token": "turnstile-proof"}),
    (auth_schemas.ResetPasswordRequest, {"token": "reset-proof-123456789", "new_password": "New-password-123!"}),
    (auth_schemas.VerifyEmailRequest, {"token": "verify-proof-123456789"}),
    (auth_schemas.ChangePasswordRequest, {"current_password": "Current-password-123!", "new_password": "New-password-123!"}),
    (auth_schemas.RegisterRequest, {
        "full_name": "Offline Owner", "workspace_name": "Offline Workspace",
        "email": "owner@adsops-fixture.vn", "password": "New-password-123!",
        "challenge_token": "signed-challenge-proof", "captcha_code": "ABCDE",
        "math_answer": "7", "human_confirmed": True, "website_honeypot": "",
        "invite_code": "offline-invite", "turnstile_token": "turnstile-proof",
    }),
]


@pytest.mark.parametrize("model,payload", AUTH_PAYLOADS)
def test_reviewed_auth_accepts_exact_fields(model, payload):
    assert set(payload) == set(model.model_fields)
    assert model.model_validate(payload).model_dump() == payload


@pytest.mark.parametrize("model,payload", AUTH_PAYLOADS)
@pytest.mark.parametrize("unknown", ["cookie", "access_token", "refresh_token", "proxy_password", "unreviewed_secret", "unknown"])
def test_reviewed_auth_rejects_every_undeclared_field(model, payload, unknown):
    with pytest.raises(PydanticValidationError) as caught:
        model.model_validate({**payload, unknown: "unpersisted-secret"})
    assert any(e["type"] == "extra_forbidden" and e["loc"] == (unknown,) for e in caught.value.errors())


@pytest.mark.parametrize("handler,model", [
    ("reset_password", auth_schemas.ResetPasswordRequest),
    ("verify_email", auth_schemas.VerifyEmailRequest),
])
@pytest.mark.parametrize("state", ["missing", "used", "expired", "mismatch"])
def test_auth_token_lifecycle_denies_invalid_without_commit(handler, model, state):
    from datetime import UTC, datetime, timedelta

    from app.api.v1.routers import auth

    raw = "one-time-proof-123456789"
    row = SimpleNamespace(token_hash=auth._hash_reset_token(raw), used_at=None,
                          expires_at=datetime.now(UTC) + timedelta(minutes=5))
    if state == "used":
        row.used_at = datetime.now(UTC)
    if state == "expired":
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    if state == "mismatch":
        row.token_hash = "0" * 64
    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = None if state == "missing" else row
    payload = {"token": raw}
    if handler == "reset_password":
        payload["new_password"] = "New-password-123!"
    with pytest.raises(ValidationError):
        getattr(auth, handler)(model(**payload), session)
    session.commit.assert_not_called()
    session.add.assert_not_called()
    session.get.assert_not_called()


def test_change_password_checks_current_before_mutating():
    from app.api.v1.routers import auth
    from app.core.errors import AuthenticationError
    from app.core.security import hash_password

    hashed = hash_password("Actual-password-123!")
    ctx = SimpleNamespace(user=SimpleNamespace(password_hash=hashed), session=Mock(), audit=Mock(), commit=Mock())
    with pytest.raises(AuthenticationError):
        auth.change_password(auth_schemas.ChangePasswordRequest(current_password="Wrong-password-123!", new_password="New-password-123!"), ctx)
    assert ctx.user.password_hash == hashed
    ctx.session.execute.assert_not_called()
    ctx.audit.record.assert_not_called()
    ctx.commit.assert_not_called()


def test_auth_redaction_and_validation_never_echo_raw_inputs():
    import asyncio
    import logging

    from fastapi import FastAPI
    from fastapi.exceptions import RequestValidationError

    from app.core.errors import install_exception_handlers
    from app.core.logging import JsonFormatter
    from app.services.audit import AuditLogService

    app = FastAPI()
    install_exception_handlers(app)
    for _model, payload in AUTH_PAYLOADS:
        session = Mock()
        AuditLogService(session, uuid.uuid4(), uuid.uuid4()).record(action="test", entity_type="test", entity_id="test", after=payload)
        row = session.add.call_args.args[0]
        record = logging.LogRecord("offline", logging.INFO, "", 0, "auth request", (), None)
        record.body = payload
        output = JsonFormatter().format(record)
        for field in payload:
            if "password" in field or "token" in field:
                assert row.after_json[field] == "[REDACTED]"
                assert payload[field] not in output
        error = RequestValidationError([{"loc": ("body", "token"), "type": "string_too_short", "msg": "Too short", "input": "raw-rejected-proof"}])
        response = asyncio.run(app.exception_handlers[RequestValidationError](None, error))
        assert b"raw-rejected-proof" not in response.body


@pytest.mark.parametrize("handler,model", [
    ("reset_password", auth_schemas.ResetPasswordRequest),
    ("verify_email", auth_schemas.VerifyEmailRequest),
])
def test_valid_auth_token_consumes_siblings_and_persists_no_plaintext(handler, model):
    from datetime import UTC, datetime, timedelta

    from app.api.v1.routers import auth
    from app.core.security import verify_password

    raw = "one-time-proof-123456789"
    row = SimpleNamespace(token_hash=auth._hash_reset_token(raw), used_at=None,
                          expires_at=datetime.now(UTC) + timedelta(minutes=5), user_id=uuid.uuid4())
    sibling = SimpleNamespace(used_at=None)
    user = SimpleNamespace(id=row.user_id, email="owner@adsops-fixture.vn", is_active=True, email_verified=False, email_verified_at=None)
    device = SimpleNamespace(revoked_at=None, revoked_reason=None)
    member = SimpleNamespace(workspace_id=uuid.uuid4())
    session = Mock()
    session.get.return_value = user
    first, siblings, devices, membership = Mock(), Mock(), Mock(), Mock()
    first.scalar_one_or_none.return_value = row
    siblings.scalars.return_value.all.return_value = [row, sibling]
    devices.scalars.return_value.all.return_value = [device]
    membership.scalars.return_value.first.return_value = member
    session.execute.side_effect = [first, siblings, devices, membership] if handler == "reset_password" else [first, siblings, membership]
    payload = {"token": raw}
    if handler == "reset_password":
        payload["new_password"] = "New-password-123!"
    result = getattr(auth, handler)(model(**payload), session)
    assert row.used_at is not None and sibling.used_at is not None
    if handler == "reset_password":
        assert verify_password(payload["new_password"], user.password_hash)
        assert device.revoked_reason == "password_reset"
    else:
        assert user.email_verified and user.email_verified_at is not None
    session.commit.assert_called_once()
    assert raw not in str(vars(row)) + str(result) + str(session.add.call_args_list)
    assert "New-password-123!" not in str(vars(user)) + str(session.add.call_args_list)


def test_forgot_issues_only_token_hash_and_turnstile_precedes_lookup(monkeypatch):
    from app.api.v1.routers import auth

    session = Mock()
    session.execute.return_value.scalar_one.return_value = 0
    user = SimpleNamespace(id=uuid.uuid4(), email="owner@adsops-fixture.vn", is_active=True)
    events = []
    monkeypatch.setattr(auth, "_verify_turnstile_if_enabled", lambda *a: events.append("turnstile"))
    monkeypatch.setattr(auth, "_find_user_by_email", lambda *a: events.append("lookup") or user)
    monkeypatch.setattr(auth, "get_settings", lambda: SimpleNamespace(smtp_configured=False))
    raw = "generated-reset-proof-123456789"
    monkeypatch.setattr(auth.secrets, "token_urlsafe", lambda *a: raw)
    request = SimpleNamespace(client=None)
    result = auth.forgot_password(auth_schemas.ForgotPasswordRequest(email=user.email, turnstile_token="proof"), request, session)
    assert events == ["turnstile", "lookup"]
    row = session.add.call_args.args[0]
    assert row.token_hash == auth._hash_reset_token(raw)
    assert raw not in str(vars(row)) + str(result)
    session.commit.assert_called_once()


def test_register_challenges_precede_database_and_failure_never_persists(monkeypatch):
    from app.api.v1.routers import auth

    events = []
    monkeypatch.setattr(auth, "_verify_turnstile_if_enabled", lambda *a: events.append("turnstile"))
    def reject(**kwargs):
        events.append("challenge")
        raise ValidationError("invalid challenge")
    monkeypatch.setattr(auth, "verify_bot_challenge", reject)
    session = Mock()
    with pytest.raises(ValidationError):
        auth.register(auth_schemas.RegisterRequest(**AUTH_PAYLOADS[-1][1]), Mock(), session)
    assert events == ["turnstile", "challenge"]
    session.execute.assert_not_called()
    session.add.assert_not_called()
    session.commit.assert_not_called()



def test_original_request_optout_guard_without_database():
    _run_request_optout_guard(create_app())


def test_request_registry_refuses_unreviewed_optional_plain_body():
    from fastapi import Body
    from pydantic import BaseModel, ConfigDict

    class UnreviewedBody(BaseModel):
        model_config = ConfigDict(extra="forbid")
        unknown_secret: str

    app = create_app()
    def unreviewed(payload=Body(default=None)):
        return {}
    # Set the actual runtime annotation, avoiding deferred local-name resolution.
    unreviewed.__annotations__["payload"] = UnreviewedBody | None
    app.post("/api/v1/unreviewed")(unreviewed)
    with pytest.raises(AssertionError, match="unreviewed"):
        _run_request_optout_guard(app)
