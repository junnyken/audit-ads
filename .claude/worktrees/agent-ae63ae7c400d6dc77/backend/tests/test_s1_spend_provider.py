"""S1 — `read_account_spend()` on the real provider (stub transport) and on the fake provider.

**Nothing here touches the network.** The real provider runs against a scripted transport; if any
test here ever opened a socket, that would be the bug (rule 22).
"""
from __future__ import annotations

import inspect
import json
from dataclasses import dataclass, field
from datetime import UTC, datetime

import pytest

from app.services import meta_graph_transport
from app.services.meta_graph_transport import GraphResponse
from app.services.meta_provider import (
    DailySpend,
    FakeMetaBusinessProvider,
    MetaFailureCode,
    SpendRead,
)
from app.services.meta_real_provider import (
    SPEND_ACCOUNT_FIELDS,
    SPEND_INSIGHTS_FIELDS,
    RealMetaBusinessProvider,
)

NOW = datetime(2026, 10, 25, 19, 0, tzinfo=UTC)  # 02:00 on the 26th in Asia/Ho_Chi_Minh

NODE = {
    "account_id": "123456789",
    "currency": "VND",
    "timezone_name": "Asia/Ho_Chi_Minh",
    "account_status": 1,
    "disable_reason": 0,
    "amount_spent": "123456700",
    "spend_cap": "200000000",
    "balance": "0",
}


@dataclass
class ScriptedTransport:
    """Answers each GET from a script, in order, and records what was asked."""

    answers: list[GraphResponse]
    calls: list[tuple[str, dict | None]] = field(default_factory=list)

    def get(self, path: str, params: dict | None = None) -> GraphResponse:
        self.calls.append((path, params))
        return self.answers.pop(0)

    def post(self, path, data=None):  # pragma: no cover - a spend read must never reach this
        raise AssertionError("read_account_spend must never POST")


def provider(*answers: GraphResponse) -> tuple[RealMetaBusinessProvider, ScriptedTransport]:
    transport = ScriptedTransport(list(answers))
    return RealMetaBusinessProvider(transport=transport, business_id="1993884657458857"), transport


def insights(*rows: dict) -> GraphResponse:
    return GraphResponse(ok=True, payload={"data": list(rows)})


# -------------------------------------------------------------------------- real provider


def test_two_gets_with_exactly_the_allowlisted_fields():
    real, transport = provider(GraphResponse(ok=True, payload=NODE), insights())
    read = real.read_account_spend("act_123456789", now=NOW)

    assert read.ok
    assert [path for path, _ in transport.calls] == ["act_123456789", "act_123456789/insights"]
    assert transport.calls[0][1] == {"fields": SPEND_ACCOUNT_FIELDS}
    params = transport.calls[1][1]
    assert params["fields"] == SPEND_INSIGHTS_FIELDS
    assert params["time_increment"] == "1"
    assert params["level"] == "account"
    # The window is the account's own local dates: 8 days ending on the local "today".
    assert json.loads(params["time_range"]) == {"since": "2026-10-19", "until": "2026-10-26"}
    assert (read.window_since, read.window_until) == ("2026-10-19", "2026-10-26")


def test_no_field_requested_ever_mentions_funding():
    assert "funding" not in SPEND_ACCOUNT_FIELDS.lower()
    assert "funding" not in SPEND_INSIGHTS_FIELDS.lower()
    real, transport = provider(GraphResponse(ok=True, payload=NODE), insights())
    real.read_account_spend("123456789", now=NOW)
    assert "funding" not in json.dumps(transport.calls).lower()


def test_raw_strings_are_kept_exactly_as_meta_sent_them():
    real, _ = provider(
        GraphResponse(ok=True, payload=NODE),
        insights({"date_start": "2026-10-25", "date_stop": "2026-10-25", "spend": "1234567.89",
                  "account_currency": "VND"}),
    )
    read = real.read_account_spend("123456789", now=NOW)
    assert read.amount_spent_raw == "123456700"  # not divided by 100, not converted
    assert read.spend_cap_raw == "200000000"
    assert read.balance_raw == "0"
    assert read.account_status_raw == "1" and read.disable_reason_raw == "0"
    assert read.daily == (DailySpend("2026-10-25", "2026-10-25", "1234567.89", "VND"),)


def test_a_day_without_a_row_is_not_inserted():
    real, _ = provider(
        GraphResponse(ok=True, payload=NODE),
        insights(
            {"date_start": "2026-10-23", "date_stop": "2026-10-23", "spend": "10"},
            {"date_start": "2026-10-25", "date_stop": "2026-10-25", "spend": "0"},
        ),
    )
    read = real.read_account_spend("123456789", now=NOW)
    assert [d.date_start for d in read.daily] == ["2026-10-23", "2026-10-25"]
    assert read.daily[1].spend == "0", "a zero Meta sent is a real zero and is kept"


def test_missing_spend_cap_stays_none_not_zero():
    node = {k: v for k, v in NODE.items() if k != "spend_cap"}
    real, _ = provider(GraphResponse(ok=True, payload=node), insights())
    assert real.read_account_spend("123456789", now=NOW).spend_cap_raw is None


@pytest.mark.parametrize(
    "code",
    [
        MetaFailureCode.TOKEN_EXPIRED,
        MetaFailureCode.RATE_LIMITED,
        MetaFailureCode.PERMISSION_MISSING,
        MetaFailureCode.PROVIDER_SERVER_ERROR,
        MetaFailureCode.INVALID_REQUEST,
        MetaFailureCode.TIMEOUT,
    ],
)
def test_a_node_failure_is_a_failed_read_with_its_code_and_no_second_call(code):
    real, transport = provider(GraphResponse(ok=False, failure_code=code, failure_summary="safe"))
    read = real.read_account_spend("123456789", now=NOW)
    assert read.ok is False and read.failure_code is code
    assert len(transport.calls) == 1, "no retry, and no insights read after a refused node"


def test_an_insights_failure_keeps_the_node_data_but_is_not_a_success():
    real, _ = provider(
        GraphResponse(ok=True, payload=NODE),
        GraphResponse(ok=False, failure_code=MetaFailureCode.RATE_LIMITED, failure_summary="slow"),
    )
    read = real.read_account_spend("123456789", now=NOW)
    assert read.ok is False and read.failure_code is MetaFailureCode.RATE_LIMITED
    assert read.currency == "VND"
    assert read.daily == ()


def test_a_non_numeric_id_is_refused_without_a_call():
    real, transport = provider()
    read = real.read_account_spend("fake000000000001", now=NOW)
    assert read.ok is False and read.failure_code is MetaFailureCode.INVALID_REQUEST
    assert transport.calls == []


def test_an_unusable_timezone_falls_back_to_utc_dates_for_the_window_only():
    node = {**NODE, "timezone_name": "Mars/Olympus"}
    real, transport = provider(GraphResponse(ok=True, payload=node), insights())
    read = real.read_account_spend("123456789", now=NOW)
    assert read.timezone_name == "Mars/Olympus", "what Meta sent is kept; rules refuse to use it"
    assert json.loads(transport.calls[1][1]["time_range"])["until"] == "2026-10-25"


def test_the_transport_was_not_changed_for_s1():
    """Rule 20: the Graph transport stays GET plus the one ad-account create. S1 adds no verb and
    no writable path."""
    source = inspect.getsource(meta_graph_transport)
    assert meta_graph_transport._WRITABLE_PATH.pattern == r"^\d{1,30}/adaccount$"
    assert "insights" not in source and "spend" not in source


# -------------------------------------------------------------------------- fake provider


def test_the_fake_provider_never_invents_spend():
    fake = FakeMetaBusinessProvider()
    read = fake.read_account_spend("123", now=NOW)
    assert read.ok is False and read.failure_code is MetaFailureCode.NOT_CONFIGURED
    assert read.daily == () and read.amount_spent_raw is None
    assert fake.calls == [("read_account_spend", "123")]


def test_the_fake_provider_answers_what_was_staged_in_order():
    fake = FakeMetaBusinessProvider()
    first = SpendRead(ok=True, currency="VND")
    second = SpendRead(ok=False, failure_code=MetaFailureCode.RATE_LIMITED)
    fake.queue_spend_result("123", first)
    fake.queue_spend_result("123", second)
    assert fake.read_account_spend("123", now=NOW) is first
    assert fake.read_account_spend("123", now=NOW) is second
    assert fake.read_account_spend("123", now=NOW).failure_code is MetaFailureCode.NOT_CONFIGURED
