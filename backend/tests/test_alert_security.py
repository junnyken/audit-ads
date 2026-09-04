"""A3 security, authorization and regression tests (§10.1, §10.4)."""
from __future__ import annotations

import os
import pathlib
import re
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa

from app.core.config import get_settings
from app.models.alerts import Alert, AlertPolicy, NotificationDelivery, NotificationDeliveryAttempt
from app.models.entities import AuditLog
from app.models.health import AccountHealthSignal
from tests.conftest import login
from tests.test_alert_api import alerts, configure_policy, deliveries, dispatch, restricted_account
from tests.test_readiness_api import make_ready_account

BACKEND_APP = pathlib.Path(__file__).resolve().parents[1] / "app"
FAKE_TOKEN = "123456789:AAFakeBotTokenValueThatMustNeverBeStored"


# ------------------------------------------------------------------------ bot token
def test_no_bot_token_is_configured_anywhere_in_the_test_environment():
    """The strongest guarantee that no real message can be sent: there is nothing to send with."""
    settings = get_settings()
    assert settings.telegram_bot_token == ""
    assert settings.notification_transport == "fake"
    assert settings.telegram_transport_configured is False
    assert not os.environ.get("TELEGRAM_BOT_TOKEN")


def test_policy_update_refuses_a_field_that_looks_like_a_token(api):
    for payload in (
        {"telegram_bot_token": FAKE_TOKEN},
        {"bot_token": FAKE_TOKEN},
        {"access_token": "abc"},
        {"telegram_chat_id": "-100", "session_token": "x"},
    ):
        response = api.patch("/api/v1/notification-policies/current", json=payload)
        assert response.status_code == 422, payload
        assert response.json()["error"]["code"] in ("forbidden_field", "validation_error")


def test_a_bot_token_cannot_be_smuggled_in_as_a_chat_id(api):
    response = api.patch("/api/v1/notification-policies/current", json={"telegram_chat_id": FAKE_TOKEN})
    assert response.status_code == 422


def test_no_endpoint_returns_a_bot_token(api, transport):
    configure_policy(api, quiet_hours_enabled=False)
    restricted_account(api)
    dispatch(api)
    alert = alerts(api, page_size=100)[0]
    delivery = deliveries(api, alert["id"])[0]

    bodies = [
        api.get("/api/v1/notification-policies/current").text,
        api.get("/api/v1/alerts?page_size=100").text,
        api.get("/api/v1/alerts/summary").text,
        api.get(f"/api/v1/alerts/{alert['id']}").text,
        api.get("/api/v1/notifications").text,
        api.get(f"/api/v1/notifications/{delivery['id']}").text,
        api.get(f"/api/v1/notifications/{delivery['id']}/attempts").text,
        api.get("/api/v1/notifications/status/summary").text,
        api.get("/api/v1/system/status").text,
    ]
    for body in bodies:
        lowered = body.lower()
        for banned in ("bot_token", "telegram_bot_token", "authorization", FAKE_TOKEN.lower()):
            assert banned not in lowered, body[:300]


def test_the_database_stores_no_token_and_no_raw_provider_payload(api, db_session, transport):
    configure_policy(api, quiet_hours_enabled=False)
    restricted_account(api)
    dispatch(api)

    banned = ("bot_token", "token", "password", "cookie", "secret", "authorization", "credential")
    for policy in db_session.execute(sa.select(AlertPolicy)).scalars().all():
        assert not any(banned_word in str(policy.__dict__).lower() for banned_word in ("bot_token",))
    for delivery in db_session.execute(sa.select(NotificationDelivery)).scalars().all():
        for key in delivery.payload_snapshot_json or {}:
            assert not any(word in key.lower() for word in banned), key
    for attempt in db_session.execute(sa.select(NotificationDeliveryAttempt)).scalars().all():
        assert attempt.failure_summary is None or len(attempt.failure_summary) <= 500
        assert "http" not in (attempt.failure_summary or "")


def test_alert_and_notification_audit_rows_carry_no_credential_like_key(api, db_session, transport):
    configure_policy(api, quiet_hours_enabled=False)
    restricted_account(api)
    dispatch(api)
    alert = alerts(api, page_size=100)[0]
    api.post(f"/api/v1/alerts/{alert['id']}/acknowledge", json={"note": "Seen."})

    banned = ("password", "cookie", "token", "secret", "credential", "authorization", "session")
    rows = db_session.execute(
        sa.select(AuditLog).where(
            AuditLog.entity_type.in_(["alert", "notification_delivery", "alert_policy"])
        )
    ).scalars().all()
    assert rows
    for row in rows:
        for payload in (row.before_json, row.after_json, row.metadata_json):
            for key in payload or {}:
                assert not any(word in key.lower() for word in banned), key


def test_the_outbound_message_carries_no_secret_and_no_stack_trace(api, transport):
    configure_policy(api, quiet_hours_enabled=False)
    restricted_account(api)
    dispatch(api)
    assert transport.sent
    text = transport.sent[0].text.lower()
    for banned in ("token", "password", "cookie", "traceback", "bearer", "authorization", "proxy"):
        assert banned not in text, text
    assert "127.0.0.1" not in text and "localhost" not in text


# ------------------------------------------------------------------- authorization
def test_cross_workspace_alert_access_does_not_disclose_existence(client, api, other_owner, transport):
    configure_policy(api, quiet_hours_enabled=False)
    restricted_account(api)
    dispatch(api)
    alert = alerts(api, page_size=100)[0]
    delivery = deliveries(api, alert["id"])[0]
    intruder = login(client, other_owner["user"].email, other_owner["password"])

    assert client.get(f"/api/v1/alerts/{alert['id']}", headers=intruder).status_code == 404
    assert client.get(f"/api/v1/notifications/{delivery['id']}", headers=intruder).status_code == 404
    assert (
        client.post(
            f"/api/v1/alerts/{alert['id']}/acknowledge", headers=intruder, json={"note": "Mine."}
        ).status_code
        == 404
    )
    assert client.get("/api/v1/alerts", headers=intruder).json()["total"] == 0
    assert client.get("/api/v1/notifications", headers=intruder).json()["total"] == 0
    assert client.get("/api/v1/alerts/summary", headers=intruder).json()["total_active"] == 0


def test_another_workspace_cannot_see_or_change_this_policy(client, api, other_owner):
    configure_policy(api, telegram_chat_id="-1009999999999")
    intruder = login(client, other_owner["user"].email, other_owner["password"])
    theirs = client.get("/api/v1/notification-policies/current", headers=intruder).json()
    assert theirs["recipient_configured"] is False
    assert "9999" not in str(theirs)


def test_a_client_supplied_workspace_id_cannot_widen_scope(client, api, other_owner):
    configure_policy(api)
    restricted_account(api)
    intruder = login(client, other_owner["user"].email, other_owner["password"])
    victim = api.get("/api/v1/auth/me").json()["workspace"]["id"]
    assert (
        client.get(f"/api/v1/alerts?workspace_id={victim}", headers=intruder).json()["total"] == 0
    )
    forced = client.patch(
        "/api/v1/notification-policies/current",
        headers=intruder,
        json={"workspace_id": victim, "telegram_chat_id": "-100123456"},
    )
    assert forced.status_code == 422, "an unknown field is refused outright"


def test_only_the_owner_may_change_policy_or_dispatch(client, api, db_session, owner):
    from app.core.enums import WorkspaceRole
    from app.models.entities import WorkspaceMember

    configure_policy(api, quiet_hours_enabled=False)
    restricted_account(api)

    membership = db_session.execute(
        sa.select(WorkspaceMember).where(WorkspaceMember.user_id == owner["user"].id)
    ).scalar_one()
    membership.role = WorkspaceRole.ADMIN
    db_session.commit()
    headers = login(client, owner["user"].email, owner["password"])

    assert (
        client.patch(
            "/api/v1/notification-policies/current", headers=headers, json={"enabled": False}
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/notifications/dispatch-due", headers=headers, json={"confirm": True}
        ).status_code
        == 403
    )
    assert client.post("/api/v1/notifications/recovery-sweep", headers=headers, json={}).status_code == 403
    # An admin can still read and work alerts.
    assert client.get("/api/v1/alerts", headers=headers).status_code == 200


def test_dispatch_takes_no_recipient_and_no_message_body(api):
    for payload in (
        {"confirm": True, "chat_id": "-100"},
        {"confirm": True, "text": "hello"},
        {"confirm": True, "recipient": "@someone"},
    ):
        assert api.post("/api/v1/notifications/dispatch-due", json=payload).status_code == 422


# --------------------------------------------------------------------- regressions
def test_a3_adds_no_delete_endpoint(app):
    methods = {method for route in app.routes for method in getattr(route, "methods", set())}
    assert "DELETE" not in methods


def test_only_the_telegram_transport_module_may_make_an_outbound_request():
    """A2 forbade every outbound HTTP import. A3 needs exactly one, so the rule is narrowed,
    not dropped: browser drivers and general HTTP clients stay banned everywhere, and the single
    permitted network module is named explicitly."""
    browsers = re.compile(
        r"^\s*(import|from)\s+(selenium|playwright|pyppeteer|undetected_chromedriver|splinter)\b",
        re.MULTILINE,
    )
    http_clients = re.compile(
        r"^\s*(import|from)\s+(requests|httpx|aiohttp|urllib\.request|urllib3|http\.client)\b",
        re.MULTILINE,
    )
    allowed_network_module = "services/telegram_transport.py"

    browser_offenders, http_offenders = [], []
    for path in BACKEND_APP.rglob("*.py"):
        text = path.read_text()
        relative = path.relative_to(BACKEND_APP).as_posix()
        if browsers.search(text):
            browser_offenders.append(relative)
        if http_clients.search(text) and relative != allowed_network_module:
            http_offenders.append(relative)

    assert browser_offenders == [], browser_offenders
    assert http_offenders == [], http_offenders


def test_the_telegram_transport_only_ever_targets_the_configured_api_base():
    """The one network module must build its URL from configuration, not from anything a caller
    supplies. A URL assembled from an alert or a policy field would be a request-forgery hole."""
    source = (BACKEND_APP / "services" / "telegram_transport.py").read_text()
    urls = re.findall(r"urlopen\((\w+)", source)
    assert urls == ["request"], urls
    assert 'url = f"{self.api_base_url.rstrip(\'/\')}/bot{self.bot_token}/sendMessage"' in source
    assert "api_base_url" in source


def test_no_automated_test_can_reach_the_network(api, transport):
    """The dispatcher in tests is the fake transport, and it records rather than sends."""
    configure_policy(api, quiet_hours_enabled=False)
    restricted_account(api)
    result = dispatch(api)
    assert result["transport"] == "fake"
    assert transport.name == "fake"
    assert len(transport.sent) == result["sent"]


def test_alert_actions_never_change_a1_or_a2_state(api, db_session):
    configure_policy(api, quiet_hours_enabled=False)
    account = restricted_account(api)
    before_health = api.get(f"/api/v1/ad-accounts/{account['id']}/health").json()
    before_readiness = api.get(f"/api/v1/ad-accounts/{account['id']}").json()["readiness_status"]
    alert = next(row for row in alerts(api, page_size=100) if row["severity"] == "critical")

    api.post(f"/api/v1/alerts/{alert['id']}/acknowledge", json={"note": "Seen."})
    api.post(
        f"/api/v1/alerts/{alert['id']}/suppress",
        json={"reason": "Muted.", "expires_at": (datetime.now(UTC) + timedelta(hours=1)).isoformat()},
    )
    api.post(f"/api/v1/alerts/{alert['id']}/unsuppress", json={"note": "Back."})
    api.post(f"/api/v1/alerts/{alert['id']}/resolve", json={"reason": "Handled elsewhere."})

    db_session.expire_all()
    after_health = api.get(f"/api/v1/ad-accounts/{account['id']}/health").json()
    assert after_health["health_status"] == before_health["health_status"] == "critical"
    assert api.get(f"/api/v1/ad-accounts/{account['id']}").json()["readiness_status"] == before_readiness
    signal = db_session.execute(
        sa.select(AccountHealthSignal).where(
            AccountHealthSignal.rule_key == "account_restricted_status"
        )
    ).scalar_one()
    assert signal.status.value == "open", "the A2 signal is untouched by alert workflow"
    assert (
        db_session.execute(sa.select(sa.func.count()).select_from(Alert)).scalar_one() >= 1
    ), "history is kept"


def test_a_delivery_failure_never_changes_health_or_readiness(api, transport, db_session):
    from app.core.enums import DeliveryFailureCode
    from app.services.notification_transport import TransportResult

    configure_policy(api, quiet_hours_enabled=False)
    account = restricted_account(api)
    before = api.get(f"/api/v1/ad-accounts/{account['id']}/health").json()
    transport.queue_failure(
        TransportResult(
            ok=False, failure_code=DeliveryFailureCode.UNAUTHORIZED, failure_summary="Rejected."
        )
    )
    dispatch(api)
    after = api.get(f"/api/v1/ad-accounts/{account['id']}/health").json()
    assert after["health_status"] == before["health_status"]
    assert after["counts"] == before["counts"]
    assert api.get(f"/api/v1/ad-accounts/{account['id']}").json()["readiness_status"] == "not_ready"


def test_a_failure_in_alert_derivation_does_not_break_health_evaluation(api, monkeypatch):
    """The nested savepoint earns its place here: alerting breaks, health keeps working."""
    configure_policy(api)
    account = make_ready_account(api)

    def explode(*args, **kwargs):
        raise RuntimeError("alert derivation is broken")

    monkeypatch.setattr("app.services.alert_triggers.AlertDerivationService", explode)
    response = api.patch(f"/api/v1/ad-accounts/{account['id']}", json={"status": "restricted"})
    assert response.status_code == 200, "the A1 mutation still commits"

    health = api.get(f"/api/v1/ad-accounts/{account['id']}/health").json()
    assert health["health_status"] == "critical", "health is unaffected by an alerting failure"
    runs = api.get(f"/api/v1/account-health/evaluation-runs?ad_account_id={account['id']}").json()
    assert runs["items"][0]["status"] == "succeeded"
    assert runs["items"][0]["result_summary_json"]["alert_derivation_error"] == "RuntimeError"


def test_no_alert_output_claims_safety_or_approval(api, transport):
    configure_policy(api, quiet_hours_enabled=False)
    restricted_account(api)
    dispatch(api)
    bodies = [
        api.get("/api/v1/alerts?page_size=100").text,
        api.get("/api/v1/alerts/summary").text,
        api.get("/api/v1/notifications").text,
        transport.sent[0].text if transport.sent else "",
    ]
    affirmative = re.compile(
        r"\b(safe account|is safe|no ban risk|ban risk|guaranteed approval|account protected"
        r"|bypass detected|unlock account|trust score|risk score|safety score)\b",
        re.IGNORECASE,
    )
    for body in bodies:
        assert not affirmative.search(body), body[:300]


def test_no_numeric_risk_or_score_field_exists_on_any_alert_payload(api):
    configure_policy(api)
    restricted_account(api)
    payloads = [
        api.get("/api/v1/alerts?page_size=100").json(),
        api.get("/api/v1/alerts/summary").json(),
        api.get("/api/v1/notification-policies/current").json(),
    ]
    banned = ("score", "risk", "probability", "confidence")

    def walk(node):
        if isinstance(node, dict):
            for key, value in node.items():
                assert not any(word in key.lower() for word in banned), key
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    for payload in payloads:
        walk(payload)
