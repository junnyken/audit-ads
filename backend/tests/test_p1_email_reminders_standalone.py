"""Registry attention tests; only isolated in-memory SQLite, --noconftest."""

import uuid
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
import sqlalchemy as sa

from app.core.enums import WorkspaceMemberStatus, WorkspaceRole
from app.models.alerts import AlertPolicy
from app.models.email_registry import EmailRegistryEntry
from app.models.entities import AuditLog
from tests.test_p1_email_registry_standalone import create, path
from tests.test_p1_email_registry_standalone import isolated as sqlite_fixture

isolated = sqlite_fixture

URL = "/api/v1/email-registry"
POLICY = URL + "/reminder-policy"
FIELD = "email_registry_in_app_reminders_enabled"


def enable(t, value=True):
    r = t.client.patch(POLICY, json={FIELD: value})
    assert r.status_code == 200, r.text
    assert r.json() == {FIELD: value}
    assert r.headers["cache-control"] == "no-store"


def test_default_and_safe_toggle(isolated):
    t = isolated
    assert t.client.get(POLICY).json() == {FIELD: False}
    assert t.session.scalar(sa.select(sa.func.count()).select_from(AlertPolicy)) == 0
    row = create(t, review_due_at="2020-01-01T00:00:00Z", review_timezone="UTC")
    assert row["overdue"]
    assert t.client.get(URL + "?attention=true").json()["total"] == 0
    enable(t)
    policy = t.session.scalar(sa.select(AlertPolicy))
    assert not policy.reminder_enabled and policy.telegram_chat_id is None
    for _ in range(2):
        assert t.client.get(URL + "?attention=true").json()["total"] == 1
    assert t.session.scalar(sa.select(sa.func.count()).select_from(EmailRegistryEntry)) == 1
    assert t.session.get(EmailRegistryEntry, uuid.UUID(row["id"])).version == 1
    enable(t, False)
    assert t.client.get(URL + "?attention=true").json()["total"] == 0
    assert t.client.get(URL + "?overdue=true").json()["total"] == 1


@pytest.mark.parametrize("role", list(WorkspaceRole))
def test_policy_roles(isolated, role):
    t = isolated
    t.member.role = role
    t.session.commit()
    for method in ("get", "patch"):
        r = getattr(t.client, method)(POLICY, **({"json": {FIELD: True}} if method == "patch" else {}))
        assert r.status_code == (200 if role in (WorkspaceRole.OWNER, WorkspaceRole.ADMIN) else 403)
        assert r.headers["cache-control"] == "no-store"


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {FIELD: None},
        {FIELD: 1},
        {FIELD: "true"},
        {FIELD: True, "reminder_enabled": True},
        {FIELD: True, "telegram_chat_id": "private"},
    ],
)
def test_strict_policy(isolated, payload):
    assert isolated.client.patch(POLICY, json=payload).status_code == 422


@pytest.mark.parametrize("inactive", ["seat", "user", "workspace", "license", "archived_policy"])
def test_policy_inactive(isolated, inactive):
    t = isolated
    enable(t)
    if inactive == "seat":
        t.member.status = WorkspaceMemberStatus.SUSPENDED
    if inactive == "user":
        t.user.is_active = False
    if inactive == "workspace":
        t.ws.archived_at = datetime.now(UTC)
    if inactive == "license":
        t.ws.plan_expires_at = datetime(2020, 1, 1, tzinfo=UTC)
    if inactive == "archived_policy":
        t.session.scalar(sa.select(AlertPolicy)).archived_at = datetime.now(UTC)
    t.session.commit()
    assert t.client.patch(POLICY, json={FIELD: False}).status_code in (401, 403)


def test_config_audit_rollback(isolated):
    t = isolated
    with patch.object(t.ctx.audit, "record", side_effect=RuntimeError("private")):
        assert t.client.patch(POLICY, json={FIELD: True}).status_code == 503
    assert t.session.scalar(sa.select(AlertPolicy)) is None
    enable(t)
    with patch.object(t.session, "commit", side_effect=RuntimeError("private")):
        assert t.client.patch(POLICY, json={FIELD: False}).status_code == 503
    assert t.client.get(POLICY).json() == {FIELD: True}
    audits = t.session.scalars(
        sa.select(AuditLog).where(AuditLog.action == "email_registry.reminder_policy_updated")
    ).all()
    assert len(audits) == 1
    assert audits[0].metadata_json == {"before_enabled": False, "enabled": True}


def test_attention_cutoff_pagination_scope_and_reschedule(isolated):
    t = isolated
    enable(t)
    now = datetime(2026, 11, 26, tzinfo=UTC)
    rows = []
    for i, due in enumerate(
        [
            "2026-11-25T07:00:00+07:00",
            "2026-11-25T00:00:00Z",
            "2026-11-26T00:00:00Z",
            "2026-11-27T00:00:00Z",
            None,
        ]
    ):
        rows.append(
            create(
                t,
                contact_address=f"item{i}@example.com",
                responsible_member_id=str(t.member.id) if i == 0 else None,
                **(
                    {"review_due_at": due, "review_timezone": "Asia/Ho_Chi_Minh" if i == 0 else "UTC"}
                    if due
                    else {}
                ),
            )
        )

    class DateTimeMeta(type):
        def __instancecheck__(cls, value):
            return isinstance(value, datetime)

    class FrozenDateTime(datetime, metaclass=DateTimeMeta):
        @classmethod
        def now(cls, tz=None):
            return now

    with patch("app.services.email_registry.datetime", FrozenDateTime):
        first = t.client.get(URL + "?attention=true&page_size=1").json()
        second = t.client.get(URL + "?attention=true&page_size=1&page=2").json()
        assert first["total"] == second["total"] == 2
        assert [first["items"][0]["id"], second["items"][0]["id"]] == sorted([r["id"] for r in rows[:2]])
        assert t.client.get(URL + "?attention=true&page=99").json()["items"] == []
        assert t.client.get(URL + "?attention=true&archived=only").json()["total"] == 0
        t.member.role = WorkspaceRole.BUYER
        t.session.commit()
        assert t.client.get(URL + "?attention=true").json()["total"] == 1
    t.member.role = WorkspaceRole.OWNER
    t.session.commit()
    assert (
        t.client.patch(
            path(rows[0]), json={"review_due_at": None, "review_timezone": None}, headers={"If-Match": '"1"'}
        ).status_code
        == 200
    )
    assert t.client.post(path(rows[1], "/archive"), json={}, headers={"If-Match": '"1"'}).status_code == 200
    entity = t.session.get(EmailRegistryEntry, uuid.UUID(rows[0]["id"]))
    assert entity.state == "unknown" and entity.evidence_source is None


def test_attention_updates_without_touching_evidence_or_outbound(isolated):
    t = isolated
    enable(t)
    policy = t.session.scalar(sa.select(AlertPolicy))
    policy.telegram_chat_id = "existing-reference"
    policy.reminder_enabled = True
    policy.reminder_interval_hours = 12
    t.session.commit()
    row = create(
        t, responsible_member_id=str(t.member.id), review_due_at="2020-01-01T00:00:00Z", review_timezone="UTC"
    )
    r = t.client.patch(
        path(row),
        json={"state": "recorded", "evidence_observed_at": "2020-01-01T00:00:00Z"},
        headers={"If-Match": '"1"'},
    )
    assert r.status_code == 200
    evidence = {key: value for key, value in r.json().items() if key.startswith("evidence_")}
    for _ in range(2):
        assert t.client.get(URL + "?attention=true").json()["total"] == 1
    r = t.client.patch(
        path(row),
        json={"review_due_at": "2099-01-01T00:00:00Z", "review_timezone": "UTC"},
        headers={"If-Match": '"2"'},
    )
    assert r.status_code == 200
    assert t.client.get(URL + "?attention=true").json()["total"] == 0
    assert {key: value for key, value in r.json().items() if key.startswith("evidence_")} == evidence
    assert r.json()["state"] == "recorded"
    assert (
        t.client.patch(
            path(row),
            json={"review_due_at": "2020-01-01T00:00:00Z", "review_timezone": "UTC"},
            headers={"If-Match": '"3"'},
        ).status_code
        == 200
    )
    assert t.client.get(URL + "?attention=true").json()["total"] == 1
    t.member.role = WorkspaceRole.BUYER
    t.session.commit()
    assert t.client.get(URL + "?attention=true").json()["total"] == 1
    t.member.role = WorkspaceRole.ADMIN
    t.session.commit()
    assert (
        t.client.post(
            path(row, "/reassign"), json={"responsible_member_id": None}, headers={"If-Match": '"4"'}
        ).status_code
        == 200
    )
    t.member.role = WorkspaceRole.BUYER
    t.session.commit()
    assert t.client.get(URL + "?attention=true").json()["total"] == 0
    t.member.role = WorkspaceRole.ADMIN
    t.session.commit()
    assert t.client.post(path(row, "/archive"), json={}, headers={"If-Match": '"5"'}).status_code == 200
    assert t.client.get(URL + "?attention=true&archived=all").json()["total"] == 0
    enable(t, False)
    enable(t)
    t.session.refresh(policy)
    assert (policy.telegram_chat_id, policy.reminder_enabled, policy.reminder_interval_hours) == (
        "existing-reference",
        True,
        12,
    )


def test_policy_and_attention_workspace_isolation(isolated):
    from app.models.entities import Workspace, WorkspaceMember
    from app.services.audit import AuditLogService

    t = isolated
    enable(t)
    create(t, review_due_at="2020-01-01T00:00:00Z", review_timezone="UTC")
    ws = Workspace(name="other", slug="other")
    t.session.add(ws)
    t.session.flush()
    member = WorkspaceMember(workspace_id=ws.id, user_id=t.user.id, role=WorkspaceRole.OWNER)
    t.session.add(member)
    t.session.commit()
    t.ctx.workspace, t.ctx.membership = ws, member
    t.ctx.audit = AuditLogService(t.session, ws.id, t.user.id)
    assert t.client.get(POLICY).json() == {FIELD: False}
    assert t.client.get(URL + "?attention=true").json()["total"] == 0
    enable(t)
    assert t.client.get(URL + "?attention=true").json()["total"] == 0
    assert t.client.get(POLICY + "?workspace_id=anything").status_code == 422
    for query in ("attention=true&attention=false", "attention=invalid"):
        r = t.client.get(URL + "?" + query)
        assert r.status_code == 422 and r.headers["cache-control"] == "no-store"
