"""Legacy retirement contracts, standalone no database/network/provider access."""
import uuid
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.api.v1.routers.extension import (
    ExtensionPackageBundleRequest,
    LegacyPackageRetired,
    package_extension_bundle,
)
from app.api.v1.routers.playbooks import (
    PlaybookRecordRunInput,
    UnverifiedPlaybookExecutionRetired,
    record_playbook_run,
)


def test_legacy_extension_renderer_is_never_called():
    ctx = SimpleNamespace(session=Mock(), audit=Mock())
    with pytest.raises(LegacyPackageRetired) as exc:
        package_extension_bundle(ctx, ExtensionPackageBundleRequest())
    assert exc.value.status_code == 410
    assert exc.value.code == 'legacy_extension_package_retired'
    ctx.session.assert_not_called()
    assert ctx.session.mock_calls == []
    assert ctx.audit.mock_calls == []


def test_client_execution_claim_cannot_mutate_run_count_or_audit():
    ctx = SimpleNamespace(session=Mock(), audit=Mock())
    payload = PlaybookRecordRunInput.model_construct()
    with pytest.raises(UnverifiedPlaybookExecutionRetired) as exc:
        record_playbook_run(ctx, uuid.uuid4(), payload)
    assert exc.value.status_code == 410
    assert ctx.session.mock_calls == []
    assert ctx.audit.mock_calls == []
