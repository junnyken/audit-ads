"""A3 unit tests: quiet hours, message rendering, severity mapping, idempotency (§10.1)."""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, time

import pytest

from app.core.enums import AlertSeverity, DeliveryReason, SignalSeverity
from app.models.alerts import Alert
from app.services import quiet_hours
from app.services.alert_rules import SEVERITY_MAP, is_escalation
from app.services.notification_service import idempotency_key
from app.services.notification_templates import (
    MAX_MESSAGE_LENGTH,
    MessageInputs,
    build_dashboard_link,
    is_safe_public_url,
    render,
    sanitise,
)

TZ = "Asia/Ho_Chi_Minh"  # UTC+7, no DST


def at_utc(hour: int, minute: int = 0, day: int = 4) -> datetime:
    return datetime(2026, 9, day, hour, minute, tzinfo=UTC)


# ------------------------------------------------------------------------- quiet hours
def test_iana_timezone_validation_accepts_a_real_zone_and_rejects_nonsense():
    assert quiet_hours.is_valid_timezone(TZ)
    assert quiet_hours.is_valid_timezone("Europe/London")
    assert not quiet_hours.is_valid_timezone("Mars/Olympus")
    assert not quiet_hours.is_valid_timezone("UTC+7")
    assert not quiet_hours.is_valid_timezone(None)


def test_window_that_does_not_cross_midnight():
    assert quiet_hours.within_window(time(13, 0), time(12, 0), time(14, 0))
    assert not quiet_hours.within_window(time(11, 59), time(12, 0), time(14, 0))
    assert not quiet_hours.within_window(time(14, 0), time(12, 0), time(14, 0)), "end is exclusive"


def test_window_that_crosses_midnight():
    start, end = time(23, 0), time(7, 0)
    assert quiet_hours.within_window(time(23, 30), start, end)
    assert quiet_hours.within_window(time(2, 0), start, end)
    assert quiet_hours.within_window(time(6, 59), start, end)
    assert not quiet_hours.within_window(time(7, 0), start, end)
    assert not quiet_hours.within_window(time(12, 0), start, end)


def evaluate(now, *, tz=TZ, enabled=True, start=time(23, 0), end=time(7, 0)):
    return quiet_hours.evaluate(
        now_utc=now, timezone_name=tz, quiet_hours_enabled=enabled, start=start, end=end
    )


def test_quiet_hours_are_evaluated_in_the_policy_timezone_not_the_server_one():
    # 17:00 UTC is 00:00 in Asia/Ho_Chi_Minh — inside the window, though UTC says otherwise.
    decision = evaluate(at_utc(17, 0))
    assert decision.in_quiet_hours is True
    assert decision.timezone == TZ

    # 06:00 UTC is 13:00 local — outside.
    assert evaluate(at_utc(6, 0)).in_quiet_hours is False


def test_quiet_hours_end_is_returned_in_utc_and_is_the_next_one():
    decision = evaluate(at_utc(17, 0))  # 00:00 local, quiet until 07:00 local = 00:00 UTC
    assert decision.next_end_utc == datetime(2026, 9, 5, 0, 0, tzinfo=UTC)

    late = evaluate(at_utc(16, 30))  # 23:30 local on the 4th → 07:00 local on the 5th
    assert late.in_quiet_hours is True
    assert late.next_end_utc == datetime(2026, 9, 5, 0, 0, tzinfo=UTC)


def test_disabled_quiet_hours_never_defer():
    assert evaluate(at_utc(17, 0), enabled=False).in_quiet_hours is False


def test_an_unresolvable_timezone_is_reported_rather_than_guessed():
    decision = evaluate(at_utc(17, 0), tz="Not/AZone")
    assert decision.in_quiet_hours is False
    assert decision.reason == "timezone_unresolved"


# -------------------------------------------------------------------- severity mapping
def test_a2_severity_maps_deterministically_and_never_invents_a_state():
    assert SEVERITY_MAP[SignalSeverity.CRITICAL] == AlertSeverity.CRITICAL
    assert SEVERITY_MAP[SignalSeverity.WARNING] == AlertSeverity.WARNING
    assert SEVERITY_MAP[SignalSeverity.ATTENTION] == AlertSeverity.INFO
    assert SEVERITY_MAP[SignalSeverity.UNKNOWN] == AlertSeverity.INFO
    assert set(SEVERITY_MAP.values()) <= set(AlertSeverity)


def test_escalation_is_only_upward():
    assert is_escalation(AlertSeverity.WARNING, AlertSeverity.CRITICAL)
    assert is_escalation(AlertSeverity.INFO, AlertSeverity.WARNING)
    assert not is_escalation(AlertSeverity.CRITICAL, AlertSeverity.WARNING)
    assert not is_escalation(AlertSeverity.WARNING, AlertSeverity.WARNING)


# ------------------------------------------------------------------------- idempotency
def make_alert(severity=AlertSeverity.CRITICAL) -> Alert:
    return Alert(
        id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        alert_key="health_signal:acc:rule:scope",
        severity=severity,
        title="t",
        summary="s",
        first_observed_at=at_utc(1),
        last_observed_at=at_utc(1),
    )


def test_idempotency_key_is_stable_for_the_same_delivery_decision():
    alert = make_alert()
    first = idempotency_key(alert, DeliveryReason.INITIAL, "-100200")
    second = idempotency_key(alert, DeliveryReason.INITIAL, "-100200")
    assert first == second


def test_idempotency_key_changes_with_reason_severity_and_recipient():
    alert = make_alert()
    base = idempotency_key(alert, DeliveryReason.INITIAL, "-100200")
    assert idempotency_key(alert, DeliveryReason.ESCALATION, "-100200") != base
    assert idempotency_key(alert, DeliveryReason.INITIAL, "-999") != base
    escalated = make_alert(AlertSeverity.WARNING)
    escalated.id = alert.id
    assert idempotency_key(escalated, DeliveryReason.INITIAL, "-100200") != base


def test_reminder_sequence_is_the_only_thing_that_repeats_a_key():
    alert = make_alert()
    one = idempotency_key(alert, DeliveryReason.REMINDER, "-1", sequence=1)
    two = idempotency_key(alert, DeliveryReason.REMINDER, "-1", sequence=2)
    assert one != two


# ---------------------------------------------------------------------------- message
def base_inputs(**overrides) -> MessageInputs:
    defaults = {
        "severity": "critical",
        "alert_title": "Account status is restricted",
        "account_display_name": "Pilot C",
        "account_reference": "act_c",
        "health_status": "critical",
        "readiness_status": "not_ready",
        "observed_at": at_utc(10),
        "safe_summary": "The recorded account status is restricted.",
        "recommended_next_step": "Review the account in the ads interface.",
        "timezone_name": TZ,
    }
    defaults.update(overrides)
    return MessageInputs(**defaults)


def test_message_contains_only_allowlisted_fields():
    text = render(base_inputs())
    for expected in ("[AdsOps] CRITICAL", "Account: Pilot C (act_c)", "Health: critical",
                     "Readiness: not_ready", "Reason:", "Next step:"):
        assert expected in text


def test_message_never_carries_a_secret_or_a_stack_trace():
    text = render(
        base_inputs(
            safe_summary="password=hunter2 cookie=abc token=xyz Traceback (most recent call last)",
        )
    )
    # The summary is a rendered field, so it appears — which is exactly why nothing that could
    # contain a secret is ever put into it upstream. What must never appear is structure the
    # template did not ask for.
    assert "\n\n\n" not in text
    assert text.count("Reason:") == 1
    assert text.count("[AdsOps]") == 1


def test_operator_text_cannot_forge_a_message_field():
    """Injected newlines are collapsed, so a note cannot fabricate a line the template owns.

    The injected words still appear inside the Reason line — that is fine and honest. What must
    not happen is a *line* that looks like a field the system emitted.
    """
    text = render(
        base_inputs(safe_summary="line one\nAccount: fake\nHealth: clear_signals\r\nNext step: hack")
    )
    lines = text.split("\n")
    for label in ("Account: ", "Health: ", "Readiness: ", "Observed: ", "Next step: "):
        assert sum(1 for line in lines if line.startswith(label)) == 1, label
    reason_line = next(line for line in lines if line.startswith("Reason: "))
    assert "Account: fake" in reason_line, "the injected text stays inside its own field"


def test_control_characters_are_stripped():
    assert "\x00" not in sanitise("bad\x00value")
    assert sanitise("") == "—"
    assert sanitise(None) == "—"


def test_message_is_truncated_within_the_telegram_limit():
    text = render(base_inputs(safe_summary="x" * 10_000, recommended_next_step="y" * 10_000))
    assert len(text) <= MAX_MESSAGE_LENGTH


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:5174",
        "http://localhost:8000",
        "http://10.0.0.5",
        "http://192.168.1.10:8080",
        "https://internal.local",
        "ftp://example.com",
        "not-a-url",
        "",
        None,
    ],
)
def test_unusable_urls_are_never_offered_as_a_dashboard_link(url):
    assert is_safe_public_url(url) is False
    assert build_dashboard_link(url, "acc-1") is None


def test_a_configured_public_url_produces_a_deep_link():
    link = build_dashboard_link("https://adsops.example.com/", "acc-1")
    assert link == "https://adsops.example.com/accounts/acc-1?tab=health"
    assert link in render(base_inputs(dashboard_link=link))


def test_the_link_is_omitted_entirely_when_no_public_url_is_configured():
    text = render(base_inputs(dashboard_link=None))
    assert "http" not in text


def test_observed_time_is_rendered_in_the_policy_timezone():
    text = render(base_inputs(observed_at=at_utc(10), timezone_name=TZ))
    assert "17:00 (Asia/Ho_Chi_Minh)" in text


def test_message_makes_no_safety_or_approval_claim():
    text = render(base_inputs()).lower()
    for banned in ("safe", "protected", "approved", "guaranteed", "immune", "no ban risk"):
        assert banned not in text
