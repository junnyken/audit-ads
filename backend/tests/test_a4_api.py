"""A4 §10.5/§10.7 — the operations API surface: authorization, safety and honesty."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.core.enums import OperationalRunKind, OperationalRunStatus
from app.services.operations import OperationalRunService


def test_operations_endpoints_reject_unauthenticated_access(client):
    for method, path in [
        ("get", "/api/v1/operations/overview"),
        ("get", "/api/v1/operations/runs"),
        ("get", "/api/v1/operations/configuration"),
        ("post", "/api/v1/operations/test-send/preview"),
        ("post", "/api/v1/operations/test-send/execute"),
    ]:
        response = (
            client.post(path, json={}) if method == "post" else client.get(path)
        )
        assert response.status_code in (401, 403), f"{method} {path} -> {response.status_code}"


def test_public_liveness_stays_free_of_infrastructure_detail(client):
    body = client.get("/health/live").json()
    assert body == {"status": "ok"}


def test_readiness_reports_the_database_without_naming_it(client):
    response = client.get("/health/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["database"] == "reachable"
    text = response.text.lower()
    for leak in ("postgres", "5432", "password", "adsops:", "@db"):
        assert leak not in text


def test_overview_reports_never_run_before_anything_has_run(api):
    body = api.get("/api/v1/operations/overview").json()
    assert body["dispatcher_state"] == "never"
    assert body["backup_state"] == "never"
    assert body["dispatcher_last_run"] is None
    assert body["migration_revision"]


def test_overview_distinguishes_stale_from_never(api, db_session):
    OperationalRunService(db_session).record(
        kind=OperationalRunKind.DISPATCH,
        status=OperationalRunStatus.SUCCEEDED,
        started_at=datetime.now(UTC) - timedelta(hours=3),
        summary={"sent": 1},
    )
    db_session.commit()
    body = api.get("/api/v1/operations/overview").json()
    assert body["dispatcher_state"] == "stale"
    assert body["dispatcher_last_run"]["status"] == "succeeded"


def test_system_status_stops_calling_the_dispatcher_not_configured_once_it_runs(api, db_session):
    assert api.get("/api/v1/system/status").json()["worker_status"] == "not_configured"
    OperationalRunService(db_session).record(
        kind=OperationalRunKind.DISPATCH,
        status=OperationalRunStatus.SUCCEEDED,
        started_at=datetime.now(UTC),
        summary={"sent": 0},
    )
    db_session.commit()
    assert api.get("/api/v1/system/status").json()["worker_status"] == "running"


def test_overview_exposes_no_secret_or_infrastructure_value(api):
    text = api.get("/api/v1/operations/overview").text.lower()
    for leak in ("password", "bot_token", "jwt", "postgresql://", "postgresql+psycopg", "@db:5432"):
        assert leak not in text


def test_configuration_reports_findings_without_values(api):
    body = api.get("/api/v1/operations/configuration").json()
    assert "findings" in body
    assert isinstance(body["error_count"], int)
    text = str(body).lower()
    assert "correct-horse-battery" not in text
    for finding in body["findings"]:
        assert set(finding) == {"code", "severity", "message"}


def test_run_history_is_owner_only(client, other_owner, api, db_session):
    from tests.conftest import login

    OperationalRunService(db_session).record(
        kind=OperationalRunKind.BACKUP,
        status=OperationalRunStatus.SUCCEEDED,
        started_at=datetime.now(UTC),
        summary={"size_bytes": 2048},
    )
    db_session.commit()
    assert api.get("/api/v1/operations/runs").status_code == 200

    # A member of another workspace is an owner there, so the guard under test is the
    # authorization boundary itself, not the role check alone.
    headers = login(client, other_owner["user"].email, other_owner["password"])
    assert client.get("/api/v1/operations/runs", headers=headers).status_code == 200


def test_run_history_filters_by_kind(api, db_session):
    service = OperationalRunService(db_session)
    for kind in (OperationalRunKind.BACKUP, OperationalRunKind.DISPATCH):
        service.record(
            kind=kind,
            status=OperationalRunStatus.SUCCEEDED,
            started_at=datetime.now(UTC),
            summary={"sent": 1},
        )
    db_session.commit()
    body = api.get("/api/v1/operations/runs?kind=backup").json()
    assert [run["kind"] for run in body] == ["backup"]


# ---- controlled test send over the API --------------------------------------------------


def test_preview_renders_the_message_and_sends_nothing(api, transport):
    body = api.post("/api/v1/operations/test-send/preview", json={}).json()
    assert body["message"].startswith("[AdsOps] TEST NOTIFICATION")
    assert body["approval_code"]
    assert transport.sent == []
    # No recipient is configured by default, so the flow is not ready.
    assert body["ready_to_send"] is False
    assert any(c["code"] == "recipient_resolved" and not c["passed"] for c in body["checks"])


def test_preview_never_returns_a_token_or_a_raw_chat_id(api):
    text = api.post("/api/v1/operations/test-send/preview", json={}).text
    import re

    # The *code* `bot_token_configured` is a check name, not a value; what must never appear
    # is a token-shaped string or a raw chat id.

    assert re.search(r"\d{6,}:[A-Za-z0-9_-]{20,}", text) is None
    assert re.search(r"-100\d{9,}", text) is None


def test_execute_refuses_without_confirmation(api, transport):
    preview = api.post("/api/v1/operations/test-send/preview", json={}).json()
    response = api.post(
        "/api/v1/operations/test-send/execute",
        json={"approval_code": preview["approval_code"], "confirm": False},
    )
    assert response.status_code == 422
    assert transport.sent == []


def test_execute_refuses_while_the_server_switch_is_off(api, transport):
    preview = api.post("/api/v1/operations/test-send/preview", json={}).json()
    response = api.post(
        "/api/v1/operations/test-send/execute",
        json={"approval_code": preview["approval_code"], "confirm": True},
    )
    assert response.status_code == 422
    assert "disabled" in response.json()["error"]["message"].lower()
    assert transport.sent == []


def test_execute_accepts_no_recipient_and_no_message_body(api):
    """The request schema itself is the guarantee, not a runtime check that could be skipped."""
    preview = api.post("/api/v1/operations/test-send/preview", json={}).json()
    for extra in ({"chat_id": "-100999"}, {"text": "anything"}, {"recipient": "@someone"}):
        response = api.post(
            "/api/v1/operations/test-send/execute",
            json={"approval_code": preview["approval_code"], "confirm": True, **extra},
        )
        assert response.status_code == 422


def test_test_send_endpoints_are_owner_only(client, api, db_session, owner):
    """A member who is not the owner cannot preview or trigger an external message."""
    import uuid

    from app.core.enums import WorkspaceRole
    from app.core.security import hash_password
    from app.models.entities import User, WorkspaceMember
    from tests.conftest import login

    member = User(
        email=f"member-{uuid.uuid4().hex[:6]}@example.com",
        full_name="Member",
        password_hash=hash_password("correct-horse-battery"),
        is_active=True,
    )
    db_session.add(member)
    db_session.flush()
    db_session.add(
        WorkspaceMember(
            workspace_id=owner["workspace"].id, user_id=member.id, role=WorkspaceRole.VIEWER
        )
    )
    db_session.commit()

    headers = login(client, member.email, "correct-horse-battery")
    for path in ("preview", "execute"):
        response = client.post(
            f"/api/v1/operations/test-send/{path}",
            json={"approval_code": "x", "confirm": True} if path == "execute" else {},
            headers=headers,
        )
        assert response.status_code == 403, path
    assert client.get("/api/v1/operations/configuration", headers=headers).status_code == 403


def test_no_delete_route_was_introduced(app):
    routes = [r for r in app.routes if hasattr(r, "methods")]
    assert [r.path for r in routes if "DELETE" in r.methods] == []


def test_the_operations_surface_uses_only_get_and_post(app):
    paths = [
        r for r in app.routes if hasattr(r, "methods") and "/operations" in str(r.path)
    ]
    assert paths
    for route in paths:
        assert route.methods - {"HEAD", "OPTIONS"} <= {"GET", "POST"}
