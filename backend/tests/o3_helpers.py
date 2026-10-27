"""Shared helpers for the O3 tests (scheduled discovery + automatic import). Not collected.

`sweep_env` builds on S1's `spend_env`: a placeholder reader credential on the server and the one
provider seam (`spend_service.provider_for_connection`) swapped for the shared fake provider, so a
`production` connection is sweepable and no test can ever build the real provider or open a
socket. The fake is given a *reader* identity, because it stands in for the real provider here —
its own fake identity is never evidence about a real account (`FAKE_IDENTITY_EXTERNAL_ID`).
"""
from __future__ import annotations

import pytest
import sqlalchemy as sa

from app.core.config import get_settings
from app.models.entities import AuditLog
from app.services.meta_provider import DiscoveredAsset, ProviderIdentity

HUB = "1993884657458857"
HUB_NAME = "Hub BM"
READER = ProviderIdentity(external_id="61550000000001", name="adsops-readonly")


@pytest.fixture()
def sweep_env(spend_env, monkeypatch):
    settings = get_settings()
    for name in (
        "discovery_sweep_every_n_passes",
        "discovery_sweep_batch",
        "discovery_stale_after_hours",
        "auto_import_telegram_grace_hours",
    ):
        monkeypatch.setattr(settings, name, getattr(settings, name))
    provider = spend_env["provider"]
    provider.identity = READER
    provider.business_managers.append({"external_id": HUB, "name": HUB_NAME})
    return {**spend_env, "provider": provider}


def connection(api, *, bm: str = HUB, environment: str = "production", label: str = "Hub") -> dict:
    response = api.post(
        "/api/v1/meta-connections",
        json={"label": label, "environment": environment, "business_manager_reference": bm},
    )
    assert response.status_code == 201, response.text
    return response.json()


def automate(api, conn: dict, *, discovery: bool = True, imports: bool = True):
    return api.patch(
        f"/api/v1/meta-connections/{conn['id']}/automation",
        json={"auto_discovery_enabled": discovery, "auto_import_enabled": imports},
    )


def automatic_connection(api, *, imports: bool = True, **kwargs) -> dict:
    conn = connection(api, **kwargs)
    response = automate(api, conn, imports=imports)
    assert response.status_code == 200, response.text
    return response.json()


def stage(provider, *accounts: tuple[str, str], pixels: tuple[str, ...] = (), owners: dict | None = None):
    """Replace the fake's default inventory. `accounts` are `(external_id, edge)`."""
    owners = owners or {}
    provider.discovered_ad_accounts.clear()
    provider.discovered_pixels.clear()
    for external_id, edge in accounts:
        metadata = {"currency": "VND"}
        if external_id in owners:
            owner_id, owner_name = owners[external_id]
            metadata["owner_business_id"] = owner_id
            if owner_name:
                metadata["owner_business_name"] = owner_name
        provider.discovered_ad_accounts.append(
            DiscoveredAsset(external_id, f"Account {external_id}", edge, safe_metadata=metadata)
        )
    for pixel in pixels:
        provider.discovered_pixels.append(DiscoveredAsset(pixel, f"Pixel {pixel}", "adspixels"))


def audit_rows(db_session, *actions: str) -> list[AuditLog]:
    db_session.expire_all()
    stmt = sa.select(AuditLog).order_by(AuditLog.created_at.asc())
    if actions:
        stmt = stmt.where(AuditLog.action.in_(actions))
    return list(db_session.execute(stmt).scalars().all())
