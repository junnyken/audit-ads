"""Owned SQLite in-memory fixture only. Run with --noconftest; no external DB."""

import base64
import json
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

import pytest
import sqlalchemy as sa
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.deps import ApiContext, get_email_registry_context
from app.api.v1.routers.email_registry import router
from app.core.config import Settings
from app.core.enums import WorkspaceMemberStatus, WorkspaceRole
from app.core.errors import install_exception_handlers
from app.core.secret_vault import VaultNotConfiguredError, contact_index
from app.core.security import hash_password
from app.models.alerts import AlertPolicy
from app.models.email_registry import EmailRegistryEntry
from app.models.entities import AuditLog, User, Workspace, WorkspaceMember
from app.models.team import DeviceSession
from app.schemas.email_registry import Create, Patch
from app.services.audit import AuditLogService

ADDRESS = "private.case+tag@example.com"
PIN = "827491"


@pytest.fixture
def isolated():
    engine = sa.create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    tables = [
        User.__table__,
        Workspace.__table__,
        WorkspaceMember.__table__,
        DeviceSession.__table__,
        EmailRegistryEntry.__table__,
        AuditLog.__table__,
        AlertPolicy.__table__,
    ]
    for table in tables:
        table.create(engine)
    session = Session(engine, expire_on_commit=False)
    ws = Workspace(name="isolated", slug="isolated")
    user = User(email="actor@example.invalid", password_hash="unused", reveal_pin_hash=hash_password(PIN))
    session.add_all([ws, user])
    session.flush()
    member = WorkspaceMember(workspace_id=ws.id, user_id=user.id, role=WorkspaceRole.OWNER)
    session.add(member)
    session.commit()
    ctx = ApiContext(session, user, member, ws, AuditLogService(session, ws.id, user.id))
    settings = SimpleNamespace(
        credential_vault_key=Fernet.generate_key().decode(),
        email_registry_index_key=base64.urlsafe_b64encode(b"i" * 32).decode(),
        email_registry_index_key_version=1,
    )
    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(router, prefix="/api/v1")

    def context():
        try:
            yield ctx
        finally:
            session.rollback()

    app.dependency_overrides[get_email_registry_context] = context
    with (
        patch("app.api.v1.routers.email_registry.get_settings", return_value=settings),
        TestClient(app) as client,
    ):
        yield SimpleNamespace(
            client=client, session=session, ctx=ctx, settings=settings, member=member, user=user, ws=ws
        )
    session.close()
    engine.dispose()


def create(t, **kw):
    r = t.client.post(
        "/api/v1/email-registry", json={"contact_address": ADDRESS, "provider": "microsoft", **kw}
    )
    assert r.status_code == 201, r.text
    assert r.headers["cache-control"] == "no-store"
    assert ADDRESS not in r.text
    return r.json()


def path(row, suffix=""):
    return "/api/v1/email-registry/" + row["id"] + suffix


def test_lifecycle_and_whitelist(isolated):
    t = isolated
    row = create(t, responsible_member_id=str(t.member.id))
    assert row["state"] == "unknown" and row["account_kind"] == "unknown"
    patchdata = {
        "state": "blocked",
        "evidence_observed_at": (datetime.now(UTC) - timedelta(minutes=1)).isoformat(),
        "reason": "Manual obstacle",
        "next_action": "Review instructions",
    }
    assert t.client.patch(path(row), json=patchdata).status_code == 428
    r = t.client.patch(path(row), json=patchdata, headers={"If-Match": '"1"'})
    assert r.status_code == 200, r.text
    assert r.json()["version"] == 2 and r.json()["evidence_source"] == "manual_attestation"
    assert (
        t.client.patch(
            path(row), json={"next_action": "Review later"}, headers={"If-Match": '"1"'}
        ).status_code
        == 409
    )
    reveal = t.client.post(path(row, "/reveal-address"), json={"pin": PIN})
    assert reveal.json() == {"address": ADDRESS}
    events = t.session.scalars(sa.select(AuditLog)).all()
    assert any(e.action == "email_registry.address_revealed" for e in events)
    raw = json.dumps(
        [{"before": e.before_json, "after": e.after_json, "meta": e.metadata_json} for e in events]
    )
    assert (
        ADDRESS not in raw and PIN not in raw and "Manual obstacle" not in raw and "address_hint" not in raw
    )
    history = t.client.get(path(row, "/history")).json()
    assert history["total"] >= 3 and "Manual obstacle" not in json.dumps(history)
    r = t.client.post(path(row, "/archive"), json={}, headers={"If-Match": '"2"'})
    assert r.status_code == 200 and r.json()["version"] == 3
    assert t.client.post(path(row, "/reveal-address"), json={"pin": PIN}).status_code == 409
    assert t.client.get("/api/v1/email-registry").json()["total"] == 0
    assert t.client.get("/api/v1/email-registry?archived=only").json()["total"] == 1
    assert (
        t.client.post(
            "/api/v1/email-registry", json={"contact_address": ADDRESS.upper(), "provider": "gmail"}
        ).status_code
        == 409
    )


@pytest.mark.parametrize("role", list(WorkspaceRole))
def test_roles(isolated, role):
    t = isolated
    row = create(t, responsible_member_id=str(t.member.id))
    t.member.role = role
    t.session.commit()
    allowed = role in {WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.BUYER}
    assert t.client.get(path(row)).status_code == (200 if allowed else 403)
    assert t.client.get(path(row, "/history")).status_code == (200 if allowed else 403)
    assert t.client.post(path(row, "/reveal-address"), json={"pin": PIN}).status_code == (
        200 if allowed else 403
    )
    r = t.client.post(
        path(row, "/reassign"), json={"responsible_member_id": None}, headers={"If-Match": '"1"'}
    )
    assert r.status_code == (200 if role in {WorkspaceRole.OWNER, WorkspaceRole.ADMIN} else 403)
    assert t.client.post(
        "/api/v1/email-registry", json={"contact_address": "other@example.com", "provider": "gmail"}
    ).status_code == (201 if role in {WorkspaceRole.OWNER, WorkspaceRole.ADMIN} else 403)


def test_buyer_scope_foreign_missing(isolated):
    t = isolated
    row = create(t)
    t.member.role = WorkspaceRole.BUYER
    t.session.commit()
    assert t.client.get("/api/v1/email-registry").json()["total"] == 0
    missing = {"id": str(uuid.uuid4())}
    for suffix in ("", "/history"):
        invisible = t.client.get(path(row, suffix))
        absent = t.client.get(path(missing, suffix))
        assert invisible.status_code == absent.status_code == 404
        assert invisible.json()["error"]["code"] == absent.json()["error"]["code"] == "not_found"
        assert invisible.json()["error"]["message"] == absent.json()["error"]["message"]
    with patch("app.services.email_registry.decrypt_contact") as decrypt:
        assert t.client.post(path(row, "/reveal-address"), json={"pin": PIN}).status_code == 404
        assert t.client.post(path(missing, "/reveal-address"), json={"pin": PIN}).status_code == 404
        decrypt.assert_not_called()
    t.member.role = WorkspaceRole.OWNER
    other = Workspace(name="other", slug="other")
    t.session.add(other)
    t.session.flush()
    entity = t.session.get(EmailRegistryEntry, uuid.UUID(row["id"]))
    entity.workspace_id = other.id
    t.session.commit()
    for suffix in ("", "/history"):
        assert t.client.get(path(row, suffix)).status_code == 404
    assert t.client.post(path(row, "/reveal-address"), json={"pin": PIN}).status_code == 404


@pytest.mark.parametrize("kind", ["user", "seat", "archived_seat", "workspace", "archived_workspace"])
def test_inactive(isolated, kind):
    t = isolated
    row = create(t)
    if kind == "user":
        t.user.is_active = False
    elif kind == "seat":
        t.member.status = WorkspaceMemberStatus.SUSPENDED
    elif kind == "archived_seat":
        t.member.archived_at = datetime.now(UTC)
    elif kind == "workspace":
        t.ws.community_status = "suspended"
    else:
        t.ws.archived_at = datetime.now(UTC)
    t.session.commit()
    assert t.client.get(path(row)).status_code == (401 if kind == "user" else 403)


@pytest.mark.parametrize(
    "payload",
    [
        {"state": None},
        {"state": "invalid"},
        {"state": "pending"},
        {"state": "unknown", "evidence_observed_at": "2020-01-01T00:00:00Z"},
        {"evidence_observed_at": None},
        {"evidence_recorded_by": str(uuid.uuid4())},
        {"contact_address": ADDRESS},
        {"responsible_member_id": None},
        {"reason": ADDRESS},
        {"reason": ""},
        {"next_action": "password=do-not-echo"},
        {},
        {"review_due_at": "2026-01-01"},
        {"review_due_at": "2026-01-01T00:00:00"},
        {"review_due_at": "2026-01-01T00:00:00Z", "review_timezone": "Asia/Ho_Chi_Minh"},
        {"nested": {"password": "do-not-echo"}},
    ],
)
def test_invalid_patch_no_leak(isolated, payload):
    t = isolated
    row = create(t)
    r = t.client.patch(path(row), json=payload, headers={"If-Match": '"1"'})
    assert r.status_code == 422, r.text
    assert ADDRESS not in r.text and "do-not-echo" not in r.text
    assert r.headers["cache-control"] == "no-store"
    assert t.session.get(EmailRegistryEntry, uuid.UUID(row["id"])).version == 1


@pytest.mark.parametrize(
    "value",
    [
        "Display <a@example.com>",
        "a@example.com,b@example.com",
        "a\r\n@example.com",
        '"abc"@example.com',
        "a..b@example.com",
        "a b@example.com",
        "https://example.com",
        "é@example.com",
    ],
)
def test_address_validation(value):
    with pytest.raises(ValueError):
        Create(contact_address=value, provider="gmail")


def test_pure_settings_index():
    settings = Settings(_env_file=None, email_registry_index_key="", email_registry_index_key_version=0)
    with pytest.raises(VaultNotConfiguredError):
        contact_index(settings, uuid.uuid4(), ADDRESS)
    settings = SimpleNamespace(
        email_registry_index_key=base64.urlsafe_b64encode(b"x" * 32).decode(),
        email_registry_index_key_version=1,
    )
    ws = uuid.uuid4()
    index, version = contact_index(settings, ws, ADDRESS)
    assert len(index) == 32 and version == 1 and index != contact_index(settings, uuid.uuid4(), ADDRESS)[0]
    assert "email_registry_index_key=" not in repr(Settings(_env_file=None))


def test_missing_keys_and_audit_failure(isolated):
    t = isolated
    for key in ("credential_vault_key", "email_registry_index_key"):
        original = getattr(t.settings, key)
        setattr(t.settings, key, "invalid")
        r = t.client.post("/api/v1/email-registry", json={"contact_address": ADDRESS, "provider": "gmail"})
        assert r.status_code == 503 and ADDRESS not in r.text
        assert t.session.scalar(sa.select(sa.func.count()).select_from(EmailRegistryEntry)) == 0
        setattr(t.settings, key, original)
    with patch.object(t.ctx.audit, "record", side_effect=RuntimeError("private error")):
        r = t.client.post("/api/v1/email-registry", json={"contact_address": ADDRESS, "provider": "gmail"})
        assert r.status_code == 503 and "private error" not in r.text
    assert t.session.scalar(sa.select(sa.func.count()).select_from(EmailRegistryEntry)) == 0
    row = create(t)
    with patch.object(t.session, "commit", side_effect=RuntimeError("private error")):
        for suffix in ("", "/history"):
            assert t.client.get(path(row, suffix)).status_code == 503
        r = t.client.post(path(row, "/reveal-address"), json={"pin": PIN})
        assert r.status_code == 503 and ADDRESS not in r.text
        assert (
            t.client.patch(path(row), json={"reason": "changed"}, headers={"If-Match": '"1"'}).status_code
            == 503
        )
    assert t.session.get(EmailRegistryEntry, uuid.UUID(row["id"])).version == 1
    assert not t.session.scalar(
        sa.select(AuditLog).where(AuditLog.action == "email_registry.address_revealed")
    )


def test_pin_durable_failures_and_corruption(isolated):
    t = isolated
    row = create(t)
    for i in range(4):
        assert t.client.post(path(row, "/reveal-address"), json={"pin": "999998"}).status_code == 403
        t.session.expire(t.user)
        assert t.user.reveal_pin_failed_count == i + 1
    assert t.client.post(path(row, "/reveal-address"), json={"pin": "999998"}).status_code == 423
    assert t.client.post(path(row, "/reveal-address"), json={"pin": PIN}).status_code == 423
    t.user.reveal_pin_locked_until = None
    t.user.reveal_pin_hash = None
    t.session.commit()
    assert t.client.post(path(row, "/reveal-address"), json={"pin": PIN}).status_code == 409
    t.user.reveal_pin_hash = hash_password(PIN)
    t.session.commit()
    with patch.object(t.session, "commit", side_effect=RuntimeError()):
        assert t.client.post(path(row, "/reveal-address"), json={"pin": "999998"}).status_code == 503
    assert t.user.reveal_pin_failed_count == 0
    entity = t.session.get(EmailRegistryEntry, uuid.UUID(row["id"]))
    entity.address_ciphertext = "broken"
    t.session.commit()
    assert t.client.post(path(row, "/reveal-address"), json={"pin": PIN}).status_code == 503


def test_due_omission_null_and_filters(isolated):
    t = isolated
    row = create(t, review_due_at="2020-01-01T07:00:00+07:00", review_timezone="Asia/Ho_Chi_Minh")
    assert row["overdue"] and row["review_due_at"] == "2020-01-01T00:00:00Z"
    r = t.client.patch(path(row), json={"reason": "Manual note"}, headers={"If-Match": '"1"'})
    assert r.status_code == 200 and r.json()["overdue"]
    r = t.client.patch(
        path(row),
        json={"review_due_at": None, "review_timezone": None, "reason": None},
        headers={"If-Match": '"2"'},
    )
    assert r.status_code == 200 and r.json()["review_due_at"] is None
    for query in ("page=0", "page_size=101", "email=" + ADDRESS, "archived=bad", "page=1&page=2"):
        assert t.client.get("/api/v1/email-registry?" + query).status_code == 422
    assert t.client.get("/api/v1/email-registry?page=99").json()["items"] == []


def test_crypto_caller_boundary():
    import ast
    from pathlib import Path

    root = Path(__file__).resolve().parents[1] / "app"
    calls = {}
    for p in root.rglob("*.py"):
        tree = ast.parse(p.read_text())
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name | ast.Attribute)
                and (node.func.id if isinstance(node.func, ast.Name) else node.func.attr)
                in {"decrypt_contact", "decrypt_secret"}
            ):
                calls.setdefault(
                    node.func.id if isinstance(node.func, ast.Name) else node.func.attr, set()
                ).add(str(p.relative_to(root)))
    assert calls["decrypt_contact"] == {"services/facebook_identities.py", "services/email_registry.py"}
    assert calls["decrypt_secret"] == {"services/meta_real_provider.py"}


@pytest.mark.parametrize(
    "source,target",
    [
        (a, b)
        for a in ("unknown", "pending", "recorded", "blocked")
        for b in ("unknown", "pending", "recorded", "blocked")
        if a != b
    ]
    + [("pending", "pending"), ("recorded", "recorded"), ("blocked", "blocked")],
)
def test_manual_transitions_and_evidence(isolated, source, target):
    t = isolated
    row = create(t, responsible_member_id=str(t.member.id))
    version = 1

    def transition(state, v):
        data = {"state": state, "reason": "Manual review", "next_action": "Review instructions"}
        if state != "unknown":
            data["evidence_observed_at"] = (datetime.now(UTC) - timedelta(seconds=v)).isoformat()
        return t.client.patch(path(row), json=data, headers={"If-Match": f'"{v}"'})

    if source != "unknown":
        assert transition(source, version).status_code == 200
        version += 1
    r = transition(target, version)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["version"] == version + 1 and data["state"] == target
    if target == "unknown":
        assert all(
            data[k] is None
            for k in (
                "evidence_source",
                "evidence_observed_at",
                "evidence_recorded_at",
                "evidence_recorded_by",
            )
        )
    else:
        assert data["evidence_recorded_by"] == str(t.user.id)
        assert data["evidence_source"] == "manual_attestation"
        assert data["evidence_recorded_at"] >= data["evidence_observed_at"]
        # Metadata changes preserve the original server provenance.
        r2 = t.client.patch(path(row), json={"reason": "Follow up"}, headers={"If-Match": f'"{version + 1}"'})
        assert r2.status_code == 200
        assert r2.json()["evidence_recorded_at"] == data["evidence_recorded_at"]
        if target == "blocked":
            assert (
                t.client.patch(
                    path(row), json={"next_action": None}, headers={"If-Match": f'"{version + 2}"'}
                ).status_code
                == 422
            )


@pytest.mark.parametrize(
    "invalid", ["foreign", "suspended", "archived", "inactive_user", "viewer", "auditor", "missing"]
)
def test_invalid_assignee(isolated, invalid):
    t = isolated
    row = create(t)
    user = User(email="target@example.invalid", password_hash="unused")
    t.session.add(user)
    t.session.flush()
    workspace_id = t.ws.id
    if invalid == "foreign":
        ws = Workspace(name="foreign", slug="foreign")
        t.session.add(ws)
        t.session.flush()
        workspace_id = ws.id
    target = WorkspaceMember(workspace_id=workspace_id, user_id=user.id, role=WorkspaceRole.BUYER)
    if invalid == "suspended":
        target.status = WorkspaceMemberStatus.SUSPENDED
    if invalid == "archived":
        target.archived_at = datetime.now(UTC)
    if invalid == "inactive_user":
        user.is_active = False
    if invalid in ("viewer", "auditor"):
        target.role = WorkspaceRole(invalid)
    t.session.add(target)
    t.session.commit()
    target_id = str(uuid.uuid4() if invalid == "missing" else target.id)
    r = t.client.post(
        path(row, "/reassign"), json={"responsible_member_id": target_id}, headers={"If-Match": '"1"'}
    )
    assert r.status_code == 422
    assert t.session.get(EmailRegistryEntry, uuid.UUID(row["id"])).responsible_member_id is None
    # Entity absence/foreign scope wins over assignee details after capability check.
    r = t.client.post(
        "/api/v1/email-registry/" + str(uuid.uuid4()) + "/reassign",
        json={"responsible_member_id": target_id},
        headers={"If-Match": '"1"'},
    )
    assert r.status_code == 404


def test_identity_scope_and_dot_plus(isolated):
    t = isolated
    create(t, contact_address=" Case.Name+tag@Example.com ")
    assert (
        t.client.post(
            "/api/v1/email-registry",
            json={"contact_address": "case.name+tag@example.com", "provider": "gmail"},
        ).status_code
        == 409
    )
    for address in ("casename+tag@example.com", "case.name@example.com"):
        create(t, contact_address=address)
    ws = Workspace(name="second", slug="second")
    t.session.add(ws)
    t.session.flush()
    member = WorkspaceMember(workspace_id=ws.id, user_id=t.user.id, role=WorkspaceRole.OWNER)
    t.session.add(member)
    t.session.commit()
    t.ctx.workspace = ws
    t.ctx.membership = member
    t.ctx.audit = AuditLogService(t.session, ws.id, t.user.id)
    create(t, contact_address="case.name+tag@example.com")
    assert t.client.get("/api/v1/email-registry").json()["total"] == 1


def test_buyer_metadata_and_reassignment_revokes(isolated):
    t = isolated
    row = create(t, responsible_member_id=str(t.member.id))
    t.member.role = WorkspaceRole.BUYER
    t.session.commit()
    assert (
        t.client.patch(
            path(row), json={"next_action": "Manual follow up"}, headers={"If-Match": '"1"'}
        ).status_code
        == 200
    )
    assert t.client.post(path(row, "/archive"), json={}, headers={"If-Match": '"2"'}).status_code == 403
    assert (
        t.client.post(
            path(row, "/reassign"),
            json={"responsible_member_id": str(t.member.id)},
            headers={"If-Match": '"2"'},
        ).status_code
        == 403
    )
    t.member.role = WorkspaceRole.ADMIN
    t.session.commit()
    assert (
        t.client.post(
            path(row, "/reassign"), json={"responsible_member_id": None}, headers={"If-Match": '"2"'}
        ).status_code
        == 200
    )
    t.member.role = WorkspaceRole.BUYER
    t.session.commit()
    with patch("app.services.email_registry.decrypt_contact") as decrypt:
        assert t.client.post(path(row, "/reveal-address"), json={"pin": PIN}).status_code == 404
        decrypt.assert_not_called()


def test_managed_and_timezone_rules(isolated):
    t = isolated
    row = create(t, responsible_member_id=str(t.member.id))
    assert (
        t.client.patch(path(row), json={"account_kind": "managed"}, headers={"If-Match": '"1"'}).status_code
        == 422
    )
    observation = (datetime.now(UTC) - timedelta(seconds=3)).isoformat()
    r = t.client.patch(
        path(row),
        json={"account_kind": "managed", "state": "recorded", "evidence_observed_at": observation},
        headers={"If-Match": '"1"'},
    )
    assert r.status_code == 200, r.text
    assert (
        t.client.patch(path(row), json={"account_kind": "unknown"}, headers={"If-Match": '"2"'}).status_code
        == 422
    )
    assert (
        t.client.patch(
            path(row),
            json={"review_due_at": "2026-03-08T02:30:00-05:00", "review_timezone": "America/New_York"},
            headers={"If-Match": '"2"'},
        ).status_code
        == 422
    )
    for offset in ("-04:00", "-05:00"):
        # Both explicit folds of the ambiguous local time are valid.
        Patch(review_due_at="2026-11-01T01:30:00" + offset, review_timezone="America/New_York")
    future = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    assert (
        t.client.patch(
            path(row), json={"evidence_observed_at": future}, headers={"If-Match": '"2"'}
        ).status_code
        == 422
    )


def test_read_audit_insert_failure_and_poisoned_history(isolated):
    t = isolated
    row = create(t)
    with patch.object(t.ctx.audit, "record", side_effect=RuntimeError("private")):
        for url in ("/api/v1/email-registry", path(row), path(row, "/history")):
            r = t.client.get(url)
            assert r.status_code == 503 and "private" not in r.text
        r = t.client.post(path(row, "/reveal-address"), json={"pin": PIN})
        assert r.status_code == 503 and ADDRESS not in r.text
    entry = t.session.scalar(sa.select(AuditLog).where(AuditLog.action == "email_registry.created"))
    entry.before_json = {
        "reason": ADDRESS,
        "state": {"nested": ADDRESS},
        "provider": ADDRESS,
        "evidence_observed_at": ADDRESS,
        "responsible_member_id": ADDRESS,
    }
    entry.metadata_json = {"changed_fields": ["reason", ADDRESS], "raw": ADDRESS, "version": ADDRESS}
    t.session.commit()
    r = t.client.get(path(row, "/history"))
    assert r.status_code == 200 and ADDRESS not in r.text


def test_configuration_fail_closed_and_version_mismatch(isolated):
    t = isolated
    create(t)
    t.settings.email_registry_index_key_version = 2
    r = t.client.post(
        "/api/v1/email-registry", json={"contact_address": "different@example.com", "provider": "gmail"}
    )
    assert r.status_code == 503
    for version in (0, -1, 32768, "bad", True):
        settings = Settings(
            _env_file=None, email_registry_index_key_version=version, email_registry_index_key="malformed"
        )
        assert settings.email_registry_index_key_version == 0
        with pytest.raises(VaultNotConfiguredError):
            contact_index(settings, t.ws.id, ADDRESS)


@pytest.mark.parametrize("value", ["a@example.com\n", "\ra@example.com", "a@example.com\x00"])
def test_outer_controls_rejected(value):
    with pytest.raises(ValueError):
        Create(contact_address=value, provider="gmail")


def test_session_license_and_failure_before_decrypt(isolated):
    t = isolated
    row = create(t)
    device = DeviceSession(
        workspace_id=t.ws.id, user_id=t.user.id, expires_at=datetime.now(UTC) + timedelta(hours=1)
    )
    t.session.add(device)
    t.session.commit()
    t.ctx.device_session_id = device.id
    assert t.client.get(path(row)).status_code == 200
    device.revoked_at = datetime.now(UTC)
    t.session.commit()
    with patch("app.services.email_registry.decrypt_contact") as decrypt:
        assert t.client.post(path(row, "/reveal-address"), json={"pin": PIN}).status_code == 401
        decrypt.assert_not_called()
    t.ctx.device_session_id = None
    t.ws.plan_expires_at = datetime.now(UTC) - timedelta(days=10)
    t.session.commit()
    assert t.client.get(path(row)).status_code == 200
    assert (
        t.client.patch(path(row), json={"reason": "Review"}, headers={"If-Match": '"1"'}).status_code == 403
    )


def test_real_authentication_dependency_no_session_touch(isolated):
    from app.api import deps
    from app.core.security import create_access_token
    from app.db.session import get_db

    t = isolated
    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: t.session
    device = DeviceSession(
        workspace_id=t.ws.id, user_id=t.user.id, expires_at=datetime.now(UTC) + timedelta(hours=1)
    )
    t.session.add(device)
    t.session.commit()
    with TestClient(app) as client:
        assert client.get("/api/v1/email-registry").status_code == 401
        token, _ = create_access_token(
            subject=str(t.user.id),
            workspace_id=str(t.ws.id),
            role=t.member.role.value,
            extra_claims={"session_id": str(device.id)},
        )
        with patch.object(deps.SessionRegistryService, "touch") as touch:
            # Building the context must not take a device write lock before P1's locks.
            ctx = deps._build_context(
                t.session,
                {"sub": str(t.user.id), "workspace_id": str(t.ws.id), "session_id": str(device.id)},
                touch_session=False,
            )
            assert ctx.device_session_id == device.id
            touch.assert_not_called()
        response = client.get("/api/v1/email-registry", headers={"Authorization": "Bearer " + token})
        assert response.status_code == 200, response.text
        device.revoked_at = datetime.now(UTC)
        t.session.commit()
        response = client.get("/api/v1/email-registry", headers={"Authorization": "Bearer " + token})
        assert response.status_code == 401 and response.headers["cache-control"] == "no-store"


def test_application_cors_allows_versioned_browser_writes():
    """Actual app middleware, no lifespan/bootstrap or database access."""
    from app.core.config import get_settings
    from app.main import create_app

    origin = "https://adsops-app.vibe.tinhgon.xyz"
    settings = get_settings().model_copy(update={"cors_origins_raw": origin})
    with patch("app.main.get_settings", return_value=settings):
        app = create_app()
    client = TestClient(app)  # no context manager: do not enter lifespan
    try:
        response = client.options(
            "/api/v1/email-registry/00000000-0000-0000-0000-000000000001",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "PATCH",
                "Access-Control-Request-Headers": "authorization,content-type,if-match",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin
        assert "if-match" in response.headers["access-control-allow-headers"].lower()
        refused = client.options(
            "/api/v1/email-registry",
            headers={
                "Origin": "https://untrusted.example",
                "Access-Control-Request-Method": "PATCH",
                "Access-Control-Request-Headers": "if-match",
            },
        )
        assert refused.status_code == 400
        assert "access-control-allow-origin" not in refused.headers
    finally:
        client.close()


@pytest.mark.parametrize("role", list(WorkspaceRole))
def test_registry_eligible_members_scope(isolated, role):
    t = isolated
    t.member.role = role
    other_ws = Workspace(name="other picker", slug="other-picker")
    t.session.add(other_ws)
    t.session.flush()
    for i, (ws_id, target_role, active) in enumerate(
        [
            (t.ws.id, WorkspaceRole.BUYER, True),
            (t.ws.id, WorkspaceRole.VIEWER, True),
            (t.ws.id, WorkspaceRole.BUYER, False),
            (other_ws.id, WorkspaceRole.BUYER, True),
        ]
    ):
        user = User(
            email=f"picker{i}@example.invalid",
            full_name=f"picker{i}",
            password_hash="unused",
            is_active=active,
        )
        t.session.add(user)
        t.session.flush()
        t.session.add(WorkspaceMember(workspace_id=ws_id, user_id=user.id, role=target_role))
    t.session.commit()
    response = t.client.get("/api/v1/email-registry/eligible-members")
    assert response.headers["cache-control"] == "no-store"
    if role not in {WorkspaceRole.OWNER, WorkspaceRole.ADMIN}:
        assert response.status_code == 403
        assert "picker0" not in response.text
        return
    assert response.status_code == 200
    assert {r["full_name"] for r in response.json()} == {"", "picker0"}
    assert all(set(r) == {"id", "full_name"} for r in response.json())
    assert "@" not in response.text
    assert t.client.get("/api/v1/email-registry/eligible-members?workspace_id=anything").status_code == 422
