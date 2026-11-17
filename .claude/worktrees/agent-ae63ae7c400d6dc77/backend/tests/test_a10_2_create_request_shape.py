"""A10.2 — the create request matches what Meta's endpoint actually takes.

A7 shaped `CreateAccountRequest` against the fake provider, which accepts anything, so the shape
was never checked against the real API. A10.2 read Meta's documented
`POST /{business-id}/adaccount` and found three mismatches: `timezone_id` is an integer (the
product only had a free-text `timezone`), `country` is not a parameter Meta accepts, and three
required parameters were missing entirely.

These tests pin the resolution, especially the one that is easy to get wrong: a field that is
sent to Meta must also be inside the preview hash, or an operator can confirm one thing and have
another created.
"""
from __future__ import annotations

import pytest

from app.core.enums import MetaBatchItemStatus, MetaEnvironment
from app.models.meta_operations import MetaConnection
from app.services.audit import AuditLogService
from app.services.meta_account_creation import AccountCreationBatchService, DraftAccountItem
from app.services.meta_provider import CreateAccountRequest, reset_fake_provider


@pytest.fixture()
def audit(session, workspace, owner):
    return AuditLogService(session, workspace.id, owner["user"].id)


@pytest.fixture()
def connection(session, workspace, owner):
    row = MetaConnection(
        workspace_id=workspace.id,
        label="Fake",
        environment=MetaEnvironment.FAKE,
        created_by=owner["user"].id,
    )
    session.add(row)
    session.commit()
    return row


@pytest.fixture()
def service(session, workspace, audit, owner):
    return AccountCreationBatchService(session, workspace.id, audit, owner["user"].id)


def _draft(service, connection, **item_kwargs):
    return service.create_draft(
        meta_connection_id=connection.id,
        business_manager_external_id="1993884657458857",
        items=[DraftAccountItem(name="Pilot", currency="VND", **item_kwargs)],
    )


def test_timezone_id_survives_draft_to_stored_item(service, connection):
    batch = _draft(service, connection, timezone_id=52)

    assert service.list_items(batch)[0].timezone_id == 52


def test_timezone_id_is_optional_at_draft_time(service, connection):
    """A draft is useful before the identifier is known. Refusing it here would push operators
    to invent one, which is the outcome this whole separation exists to prevent."""
    batch = _draft(service, connection)

    assert service.list_items(batch)[0].timezone_id is None


def test_changing_timezone_id_invalidates_a_confirmation(session, service, connection):
    """The property worth protecting. `timezone_id` is sent to Meta and lands on a permanent
    artifact, so a change between preview and confirm must break the hash — a transmitted field
    missing from the hash is precisely the gap the hash exists to close."""
    from app.core.errors import ConflictError

    batch = _draft(service, connection, timezone_id=52)
    stale_hash = service.preview(batch)["preview_hash"]

    item = service.list_items(batch)[0]
    item.timezone_id = 70
    session.flush()

    with pytest.raises(ConflictError):
        service.confirm(batch, preview_hash=stale_hash)


def test_the_free_text_timezone_is_kept_separately_from_the_identifier(service, connection):
    """Two fields, not one: `timezone` is for a person to read, `timezone_id` is what gets sent.
    Collapsing them is how a real ad account ends up stamped with a guessed value."""
    batch = _draft(service, connection, timezone="Asia/Ho_Chi_Minh", timezone_id=52)
    item = service.list_items(batch)[0]

    assert item.timezone == "Asia/Ho_Chi_Minh"
    assert item.timezone_id == 52


def test_the_request_handed_to_a_provider_carries_the_identifier(service, connection):
    """End to end through the engine: whatever the provider receives must include the value the
    operator confirmed."""
    seen: list[CreateAccountRequest] = []

    fake = reset_fake_provider()
    original = fake.create_ad_account

    def _record(request):
        seen.append(request)
        return original(request)

    fake.create_ad_account = _record  # type: ignore[method-assign]
    try:
        batch = _draft(service, connection, timezone="Asia/Ho_Chi_Minh", timezone_id=52)
        service.confirm(batch, preview_hash=service.preview(batch)["preview_hash"])
        service.run(batch, fake)
    finally:
        fake.create_ad_account = original  # type: ignore[method-assign]

    assert len(seen) == 1
    assert seen[0].timezone_id == 52
    # `country` is still carried for A1's registry record even though Meta does not accept it.
    assert "country" in CreateAccountRequest.__dataclass_fields__
    assert service.list_items(batch)[0].status == MetaBatchItemStatus.SUCCEEDED
