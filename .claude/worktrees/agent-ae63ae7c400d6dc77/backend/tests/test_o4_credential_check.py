"""O4 — what happens after a credential is stored: the scheduled check, its alerts, and what every
reader does once Meta declares a credential dead. The degradation table in
docs/AUDIT_BEFORE_BUILD_O4_USER_TOKENS.md §8 is the contract; each test names its row.
"""
from __future__ import annotations

import sqlalchemy as sa

from app.commands.run_dispatcher import credential_check_pass, one_pass, spend_sweep_pass
from app.core.enums import AlertSeverity, AlertSourceType, OperationalRunKind, ReaderCredentialStatus
from app.models.alerts import Alert, NotificationDelivery
from app.models.entities import AuditLog
from app.models.meta_operations import MetaConnection
from app.models.meta_reader_credential import MetaReaderCredential
from app.models.operations import OperationalRun
from app.models.spend import AdAccountSpendObservation
from app.services.audit import AuditLogService
from app.services.meta_provider import MetaFailureCode
from app.services.meta_reader_credentials import MetaReaderCredentialService
from app.services.notification_transport import get_fake_transport
from tests.o4_helpers import BM_A, BM_B, BM_C, TOKEN_PREFIX, TokenSpec, connect, in_days
from tests.s1_spend_helpers import make_account, make_bm


def _credential(db_session) -> MetaReaderCredential:
    db_session.expire_all()
    return db_session.execute(sa.select(MetaReaderCredential)).scalars().one()


def _alerts(db_session, **filters) -> list[Alert]:
    db_session.expire_all()
    stmt = sa.select(Alert).where(Alert.source_type == AlertSourceType.READER_CREDENTIAL)
    for key, value in filters.items():
        stmt = stmt.where(getattr(Alert, key) == value)
    return list(db_session.execute(stmt).scalars().all())


def _runs(db_session) -> list[OperationalRun]:
    db_session.expire_all()
    return list(
        db_session.execute(
            sa.select(OperationalRun).where(OperationalRun.kind == OperationalRunKind.CREDENTIAL_CHECK)
        ).scalars().all()
    )


# ------------------------------------------------------------------------------ the pass


def test_without_the_meta_app_the_pass_does_nothing_and_records_no_run(
    api, client, o4_env, db_session, monkeypatch
):
    connect(api, client, o4_env["graph"])
    o4_env["graph"].calls.clear()
    monkeypatch.setattr(o4_env["settings"], "meta_app_secret", "")
    totals = credential_check_pass(batch=10)
    assert totals["not_configured"] == 1 and totals["checked"] == 0
    assert o4_env["graph"].calls == []
    assert _runs(db_session) == []  # System Status keeps saying "never"
    assert api.get("/api/v1/operations/overview").json()["credential_check_state"] == "never"


def test_a_missing_vault_key_fails_the_run_but_kills_no_credential(api, client, o4_env, db_session, monkeypatch):
    connect(api, client, o4_env["graph"])
    monkeypatch.setattr(o4_env["settings"], "credential_vault_key", "")
    totals = credential_check_pass(batch=10)
    assert totals["vault_unavailable"] == 1
    [run] = _runs(db_session)
    assert run.status.value == "failed" and run.error_code == "vault_unavailable"
    assert _credential(db_session).status == ReaderCredentialStatus.ACTIVE
    assert _alerts(db_session) == []


def test_a_live_system_user_credential_costs_one_get_and_records_a_run(api, client, o4_env, db_session):
    connect(api, client, o4_env["graph"])
    o4_env["graph"].calls.clear()
    totals = credential_check_pass(batch=10)
    assert totals["checked"] == 1 and totals["valid"] == 1
    assert o4_env["graph"].paths() == ["debug_token"]
    [run] = _runs(db_session)
    assert run.status.value == "succeeded"
    overview = api.get("/api/v1/operations/overview").json()
    assert overview["credential_check_state"] == "current"
    assert overview["reader_credentials"]["active"] == 1
    audit = [row for row in db_session.execute(sa.select(AuditLog)).scalars() if row.action == "meta_reader_credential.verified"]
    assert audit[-1].actor_id is None
    assert audit[-1].metadata_json["actor"] == "system:credential_check"


def test_rate_limited_stops_the_pass_and_changes_nothing(api, client, o4_env, db_session):
    graph = o4_env["graph"]
    connect(api, client, graph, label="one")
    connect(api, client, graph, TokenSpec(user_id="2", readable=(BM_B,)), label="two", bm=BM_B)
    graph.failures["debug_token"] = MetaFailureCode.RATE_LIMITED
    graph.calls.clear()
    totals = credential_check_pass(batch=10)
    assert totals["rate_limited"] == 1 and totals["due_remaining"] == 1
    assert graph.paths() == ["debug_token"]
    db_session.expire_all()
    assert all(
        c.status == ReaderCredentialStatus.ACTIVE
        for c in db_session.execute(sa.select(MetaReaderCredential)).scalars()
    )
    assert _runs(db_session)[0].status.value == "partial"


# ------------------------------------------------------------------- death and its effect


def _kill(graph, token, **changes):
    spec = graph.tokens[token]
    for key, value in changes.items():
        setattr(spec, key, value)


def test_token_expired_row(api, client, o4_env, db_session, spend_env):
    """Row "Token hết hạn": reconnect_required(expired), not_observable with a reason, no new
    observation, one critical alert (not one per account), never a fall back to env."""
    graph = o4_env["graph"]
    _, token = connect(api, client, graph)
    bm = make_bm(api, BM_A)
    account = make_account(api, bm=bm, external_id="1111")
    make_account(api, bm=bm, external_id="2222")
    _kill(graph, token, valid=False, subcode=463)

    totals = credential_check_pass(batch=10)
    assert totals["reconnect_required"] == 1
    credential = _credential(db_session)
    assert credential.status == ReaderCredentialStatus.RECONNECT_REQUIRED
    assert credential.reconnect_reason == "expired"

    [alert] = _alerts(db_session)
    assert alert.severity == AlertSeverity.CRITICAL and alert.ad_account_id is None
    assert alert.source_snapshot_json["accounts_affected"] == 2
    assert alert.source_snapshot_json["reason"] == "expired"

    spend = api.get(f"/api/v1/ad-accounts/{account['id']}/spend").json()
    assert spend["observable"] is False
    assert spend["freshness"] == "not_observable"
    assert spend["not_observable_reason"] == "reader_reconnect_required"
    listed = api.get("/api/v1/ad-accounts").json()
    compact = {row["id"]: row for row in listed["items"]}[account["id"]]
    assert compact["spend"]["not_observable_reason"] == "reader_reconnect_required"
    refresh = api.post(f"/api/v1/ad-accounts/{account['id']}/spend/refresh")
    assert refresh.status_code == 409
    assert refresh.json()["error"]["details"]["not_observable_reason"] == "reader_reconnect_required"

    # A server token is configured (spend_env) — and still nothing reads this Business Manager.
    sweep = spend_sweep_pass(batch=10)
    assert sweep["not_observable"] == 2 and sweep["observed"] == 0
    db_session.expire_all()
    assert db_session.execute(sa.select(AdAccountSpendObservation)).scalars().all() == []
    assert spend_env["built"] == []

    # The next pass does not select it; the one alert stays one.
    credential_check_pass(batch=10)
    assert len(_alerts(db_session)) == 1


def test_the_reconnect_alert_is_raised_once_even_when_checked_again(api, client, o4_env, db_session):
    graph = o4_env["graph"]
    _, token = connect(api, client, graph)
    _kill(graph, token, valid=False, subcode=467)
    credential = _credential(db_session)
    service = MetaReaderCredentialService(db_session, credential.workspace_id, AuditLogService(db_session, credential.workspace_id, None))
    service.check(credential)
    service._mark_reconnect(credential, "invalid_token", actor_id=None)
    db_session.commit()
    assert len(_alerts(db_session, severity=AlertSeverity.CRITICAL)) == 1
    deliveries = db_session.execute(sa.select(NotificationDelivery)).scalars().all()
    assert len(deliveries) == 1
    assert deliveries[0].message_template_version == "a3-v1-credential"


def test_password_changed_and_checkpointed_keep_their_own_reason(api, client, o4_env, db_session):
    graph = o4_env["graph"]
    _, first = connect(api, client, graph, label="one")
    _, second = connect(api, client, graph, TokenSpec(user_id="2", readable=(BM_B,)), label="two", bm=BM_B)
    _kill(graph, first, valid=False, subcode=460)
    _kill(graph, second, valid=False, subcode=459)
    credential_check_pass(batch=10)
    db_session.expire_all()
    reasons = {c.label: c.reconnect_reason for c in db_session.execute(sa.select(MetaReaderCredential)).scalars()}
    assert reasons == {"one": "password_changed", "two": "checkpointed"}
    steps = {a.source_snapshot_json["reason"]: a.source_snapshot_json["recommended_next_step"] for a in _alerts(db_session)}
    assert "facebook.com" in steps["password_changed"] and "checkpoint" in steps["checkpointed"]


def test_a_removed_scope_needs_reconnecting(api, client, o4_env, db_session):
    graph = o4_env["graph"]
    _, token = connect(api, client, graph)
    _kill(graph, token, scopes=("ads_read",))
    credential_check_pass(batch=10)
    assert _credential(db_session).reconnect_reason == "scope_missing"


def test_a_changed_vault_key_marks_vault_unavailable(api, client, o4_env, db_session, monkeypatch):
    from cryptography.fernet import Fernet

    connect(api, client, o4_env["graph"])
    monkeypatch.setattr(o4_env["settings"], "credential_vault_key", Fernet.generate_key().decode())
    connections = api.get("/api/v1/meta-connections").json()
    assert connections[0]["reader_source"] == "vault_reconnect_required"
    credential_check_pass(batch=10)
    assert _credential(db_session).reconnect_reason == "vault_unavailable"


def test_reconnect_closes_the_critical_alert(api, client, o4_env, db_session):
    from urllib.parse import parse_qs, urlparse

    from tests.o4_helpers import callback

    graph = o4_env["graph"]
    _, token = connect(api, client, graph)
    _kill(graph, token, valid=False, subcode=463)
    credential_check_pass(batch=10)
    credential = _credential(db_session)
    url = api.post(f"/api/v1/meta-reader-credentials/{credential.id}/reconnect/start").json()["url"]
    code, _ = graph.issue(TokenSpec())
    _, query = callback(client, code=code, state=parse_qs(urlparse(url).query)["state"][0])
    assert query["meta_login"] == "ok"
    [alert] = _alerts(db_session)
    assert alert.status.value == "resolved"


# --------------------------------------------------------------------- expiry and renewal


def _user_credential(api, client, graph, monkeypatch, settings, *, days: float, businesses=((BM_A, "A"),)):
    monkeypatch.setattr(settings, "meta_login_config_kind", "user")
    _, token = connect(
        api, client, graph, TokenSpec(kind="USER", expires_at=in_days(days), businesses=businesses), bm=""
    )
    return token


def test_expiring_within_14_days_raises_one_warning(api, client, o4_env, db_session, monkeypatch):
    graph = o4_env["graph"]
    _user_credential(api, client, graph, monkeypatch, o4_env["settings"], days=10)
    totals = credential_check_pass(batch=10)
    assert totals["expiring"] == 1
    assert totals["renew_not_extended"] == 1  # tried, Meta did not extend: counted, not claimed
    credential_check_pass(batch=10)
    [alert] = _alerts(db_session)
    assert alert.severity == AlertSeverity.WARNING
    assert api.get("/api/v1/meta-reader-credentials").json()["items"][0]["derived_state"] == "expiring"


def test_a_renewal_that_extends_expiry_is_kept_and_audited(api, client, o4_env, db_session, monkeypatch):
    graph = o4_env["graph"]
    token = _user_credential(api, client, graph, monkeypatch, o4_env["settings"], days=10)
    renewed = f"{TOKEN_PREFIX}renewed"
    graph.tokens[renewed] = TokenSpec(kind="USER", expires_at=in_days(60), businesses=((BM_A, "A"),))
    graph.exchanges[token] = renewed
    graph.calls.clear()
    totals = credential_check_pass(batch=10)
    assert totals["renewed"] == 1 and totals["expiring"] == 0
    assert len(graph.calls) <= 3
    assert _credential(db_session).expires_at > in_days(59)
    assert _alerts(db_session) == []
    rows = [r for r in db_session.execute(sa.select(AuditLog)).scalars() if r.action == "meta_reader_credential.renewed"]
    assert rows and rows[-1].metadata_json["via"] == "fb_exchange_token"
    assert TOKEN_PREFIX not in str(rows[-1].metadata_json) + str(rows[-1].after_json)


def test_a_new_business_gets_a_connection_and_a_vanished_one_is_flagged_never_archived(
    api, client, o4_env, db_session, monkeypatch
):
    graph = o4_env["graph"]
    token = _user_credential(
        api, client, graph, monkeypatch, o4_env["settings"], days=50, businesses=((BM_A, "A"), (BM_B, "B"))
    )
    graph.tokens[token].businesses = ((BM_A, "A"), (BM_C, "C"))
    totals = credential_check_pass(batch=10)
    assert totals["businesses_added"] == 1 and totals["businesses_not_listed"] == 1
    db_session.expire_all()
    connections = db_session.execute(sa.select(MetaConnection)).scalars().all()
    assert {c.business_manager_reference for c in connections} == {BM_A, BM_B, BM_C}
    assert all(c.archived_at is None for c in connections)
    [flag] = _alerts(db_session, severity=AlertSeverity.INFO)
    assert BM_B in flag.alert_key


# ------------------------------------------------------------------------ Telegram message


def test_the_critical_message_names_the_reader_and_never_the_token(
    api, client, o4_env, db_session, alert_policy, transport
):
    alert_policy.telegram_chat_id = "-100200300"
    db_session.commit()
    graph = o4_env["graph"]
    _, token = connect(api, client, graph)
    _kill(graph, token, valid=False, subcode=460)
    credential_check_pass(batch=10)
    one_pass(batch=10, recovery=False)
    sent = get_fake_transport().sent
    assert len(sent) == 1
    text = sent[0].text
    assert "CRITICAL" in text and "FB Triều" in text and "password_changed" in text
    assert TOKEN_PREFIX not in text and "o4-test-app-secret" not in text
    assert "/settings#meta-readers" in text
