"""Shared fixtures-as-functions for the S1 spend tests. Not collected (no `test_` prefix).

`spend_env` gives the server a placeholder reader credential and swaps the one provider seam,
`spend_service.provider_for_connection`, for the shared fake provider — so a `production`
connection is observable, and no test can ever build the real provider or open a socket.
"""
from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.core.config import get_settings
from app.services import spend_service
from app.services.meta_provider import DailySpend, SpendRead

TZ = "Asia/Ho_Chi_Minh"
PLACEHOLDER_READER = "placeholder-reader-for-tests"


@pytest.fixture()
def spend_env(monkeypatch, meta_provider):
    settings = get_settings()
    previous = (
        settings.meta_access_token,
        dict(settings.meta_access_tokens_by_business),
        settings.meta_business_id,
        settings.spend_sweep_every_n_passes,
        settings.spend_sweep_batch,
    )
    settings.meta_access_token = PLACEHOLDER_READER
    settings.meta_access_tokens_by_business = {}
    settings.meta_business_id = ""
    built: list = []

    def fake_provider(reader):
        built.append(reader)
        return meta_provider

    monkeypatch.setattr(spend_service, "provider_for_connection", fake_provider)
    yield {"provider": meta_provider, "built": built, "settings": settings}
    (
        settings.meta_access_token,
        settings.meta_access_tokens_by_business,
        settings.meta_business_id,
        settings.spend_sweep_every_n_passes,
        settings.spend_sweep_batch,
    ) = previous


def make_bm(api, external_id: str, name: str = "BM") -> dict:
    response = api.post("/api/v1/business-managers", json={"name": name, "external_id": external_id})
    assert response.status_code == 201, response.text
    return response.json()


def make_account(api, *, bm: dict | None, external_id: str | None, currency: str | None = "VND",
                 name: str | None = None) -> dict:
    payload = {"display_name": name or f"Account {external_id}", "currency": currency}
    if external_id:
        payload["external_account_id"] = external_id
    if bm:
        payload["business_manager_id"] = bm["id"]
    response = api.post("/api/v1/ad-accounts", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def make_connection(api, *, bm_external_id: str, environment: str = "production", label: str = "Conn") -> dict:
    response = api.post(
        "/api/v1/meta-connections",
        json={"label": label, "environment": environment, "business_manager_reference": bm_external_id},
    )
    assert response.status_code == 201, response.text
    return response.json()


def local_today(now: datetime | None = None) -> date:
    return (now or datetime.now(UTC)).astimezone(ZoneInfo(TZ)).date()


def good_read(
    spend_by_offset: dict[int, str],
    *,
    currency: str = "VND",
    row_currency: str | None = None,
    amount_spent: str | None = "1000",
    spend_cap: str | None = None,
    timezone_name: str | None = TZ,
    now: datetime | None = None,
) -> SpendRead:
    """A successful read. `spend_by_offset` maps "days before local today" to Meta's raw spend;
    offset 0 is today's still-running day. Offsets not given have no row at all."""
    today = local_today(now)
    rows = tuple(
        DailySpend(
            (today - timedelta(days=offset)).isoformat(),
            (today - timedelta(days=offset)).isoformat(),
            value,
            row_currency or currency,
        )
        for offset, value in sorted(spend_by_offset.items(), reverse=True)
    )
    return SpendRead(
        ok=True,
        currency=currency,
        timezone_name=timezone_name,
        account_status_raw="1",
        disable_reason_raw="0",
        amount_spent_raw=amount_spent,
        spend_cap_raw=spend_cap,
        balance_raw="0",
        daily=rows,
        window_since=(today - timedelta(days=7)).isoformat(),
        window_until=today.isoformat(),
    )
