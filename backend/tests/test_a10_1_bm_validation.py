"""A10.1 — configured Business Manager validation, against a real PostgreSQL session.

Validation is a gate, not a formality: asset discovery may only run after the configured BM has
actually been read back. These tests pin the ways it is allowed to refuse, because each refusal
is a different instruction to the operator — a missing configuration is fixed in the server, an
expired token is fixed in Business Settings, and a BM that does not match the configured one
means the run would have attributed somebody else's assets to this configuration.
"""
from __future__ import annotations

import pytest
import sqlalchemy as sa

from app.core.enums import DiscoveryRunStatus, DiscoveryTrigger, MetaEnvironment
from app.models.entities import AuditLog
from app.models.meta_operations import MetaConnection
from app.services.audit import AuditLogService
from app.services.meta_discovery import MetaDiscoveryService
from app.services.meta_provider import (
    CapabilityCheck,
    FakeMetaBusinessProvider,
    MetaFailureCode,
)

BM = "1993884657458857"


@pytest.fixture()
def audit(session, workspace, owner):
    return AuditLogService(session, workspace.id, owner["user"].id)


@pytest.fixture()
def connection(session, workspace, owner):
    row = MetaConnection(
        workspace_id=workspace.id,
        label="Fake connection",
        environment=MetaEnvironment.FAKE,
        created_by=owner["user"].id,
    )
    session.add(row)
    session.commit()
    return row


def _service(session, workspace, audit, provider, *, business_id=BM):
    return MetaDiscoveryService(
        session, workspace.id, audit, provider=provider, business_id=business_id
    )


def _provider_seeing(*businesses: dict[str, str]) -> FakeMetaBusinessProvider:
    fake = FakeMetaBusinessProvider()
    fake.business_managers.extend(businesses)
    return fake


def test_a_validated_business_manager_records_its_name(session, workspace, audit, connection):
    provider = _provider_seeing({"external_id": BM, "name": "Quảng Cáo Top"})

    run = _service(session, workspace, audit, provider).validate_configured_business_manager(
        connection
    )

    assert run.status == DiscoveryRunStatus.SUCCEEDED
    assert run.configured_business_manager_reference == BM
    assert run.configured_business_manager_name == "Quảng Cáo Top"
    assert run.completed_at is not None
    assert run.failure_code is None


def test_an_unconfigured_business_id_never_calls_the_provider(
    session, workspace, audit, connection
):
    """Meta will not name the business behind a system user token, so an unset id is a dead end.
    Spending a call to rediscover that would be waste charged against a real rate limit."""
    provider = _provider_seeing({"external_id": BM, "name": "Quảng Cáo Top"})

    run = _service(
        session, workspace, audit, provider, business_id=""
    ).validate_configured_business_manager(connection)

    assert run.status == DiscoveryRunStatus.FAILED
    assert run.failure_code == MetaFailureCode.NOT_CONFIGURED.value
    assert provider.calls == []


def test_a_refused_capability_keeps_its_own_reason(session, workspace, audit, connection):
    """`token_expired` and `not_configured` send the operator to completely different places."""
    provider = _provider_seeing({"external_id": BM, "name": "Quảng Cáo Top"})
    provider.capability = CapabilityCheck(
        False, False, False, False, reason=MetaFailureCode.TOKEN_EXPIRED
    )

    run = _service(session, workspace, audit, provider).validate_configured_business_manager(
        connection
    )

    assert run.status == DiscoveryRunStatus.FAILED
    assert run.failure_code == MetaFailureCode.TOKEN_EXPIRED.value
    assert run.configured_business_manager_name is None


def test_a_different_business_manager_is_not_accepted_as_the_configured_one(
    session, workspace, audit, connection
):
    """The capability can be satisfied by *a* BM. Accepting that as *the* configured BM would
    attribute another business's assets to this configuration."""
    provider = _provider_seeing({"external_id": "999999", "name": "Someone else's BM"})

    run = _service(session, workspace, audit, provider).validate_configured_business_manager(
        connection
    )

    assert run.status == DiscoveryRunStatus.FAILED
    assert run.failure_code == MetaFailureCode.NOT_CONFIGURED.value


def test_the_run_captures_the_environment_that_produced_it(
    session, workspace, audit, connection
):
    """A connection can be edited later; an observation must keep saying which environment it
    actually came from."""
    provider = _provider_seeing({"external_id": BM, "name": "Quảng Cáo Top"})

    run = _service(session, workspace, audit, provider).validate_configured_business_manager(
        connection, trigger=DiscoveryTrigger.INTERNAL_TEST
    )

    assert run.provider_environment == MetaEnvironment.FAKE
    assert run.trigger == DiscoveryTrigger.INTERNAL_TEST


def test_every_validation_writes_a_redacted_audit_row(session, workspace, audit, connection):
    provider = _provider_seeing({"external_id": BM, "name": "Quảng Cáo Top"})

    run = _service(session, workspace, audit, provider).validate_configured_business_manager(
        connection
    )
    session.flush()  # SessionLocal is autoflush=False project-wide

    row = session.execute(
        sa.select(AuditLog).where(AuditLog.entity_id == str(run.id))
    ).scalar_one()

    assert row.action == "meta_discovery.business_manager_validated"
    assert row.after_json["business_manager_reference"] == BM
    assert row.after_json["status"] == "succeeded"


def test_a_discovery_run_records_which_identity_read_it(session, workspace, audit, connection):
    """Measured on 2026-09-11: the same Business Manager returned four ad accounts to an Employee
    system user and eight to an Admin one. An inventory is therefore a fact about the reader as
    much as about the BM.

    Without this recorded, a later run by a narrower token shows fewer assets, reports
    `complete` — truthfully, every required edge answered — and licenses
    `missing_from_latest_discovery` for records a broader token had just confirmed exist.
    """
    provider = _provider_seeing({"external_id": BM, "name": "Quảng Cáo Top"})
    service = _service(session, workspace, audit, provider)

    run = service.validate_configured_business_manager(connection)
    service.discover_assets(run)

    assert run.provider_actor_external_id == "fake-system-user"
    assert run.provider_actor_name == "Fake system user"
    # Identity is established before the assets it qualifies, not after.
    methods = [method for method, _ in provider.calls]
    assert methods.index("identify") < methods.index("discover_ad_accounts")


def test_validation_calls_the_provider_at_most_twice(session, workspace, audit, connection):
    """Rate-limit budget on a real BM is a real cost, and this is the step that runs before
    every discovery."""
    provider = _provider_seeing({"external_id": BM, "name": "Quảng Cáo Top"})

    _service(session, workspace, audit, provider).validate_configured_business_manager(connection)

    # Named exactly, not counted with `<=`: a bound alone is also satisfied by zero calls, so it
    # would keep passing if the provider were never reached at all.
    assert [method for method, _ in provider.calls] == [
        "check_capability",
        "list_business_managers",
    ]
