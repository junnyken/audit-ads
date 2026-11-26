"""Standalone P0 checks. Run with pytest --noconftest (no DB reset/import)."""
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_write_context
from app.api.v1.routers.facebook_identities import router
from app.core.errors import install_exception_handlers
from tests.schema_reset_guard import require_test_schema_reset


def test_legacy_import_rejects_credentials_and_never_mutates():
    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(router, prefix="/api/v1")
    context = SimpleNamespace(session=Mock(), commit=Mock())
    app.dependency_overrides[get_write_context] = lambda: context
    with TestClient(app) as client, patch(
        "app.services.meta_graph_transport.fetch_facebook_identity_and_businesses"
    ) as transport:
        for payload in ({"access_token": "test-only-never-real"}, {"nested": {"token": "test-only"}}):
            response = client.post("/api/v1/facebook-identities/auto-connect-token", json=payload)
            assert response.status_code == 422
            assert response.json()["error"]["code"] == "forbidden_field"
            assert "test-only" not in response.text
        response = client.post("/api/v1/facebook-identities/auto-connect-token", json={})
        assert response.status_code == 422
        assert response.json()["error"]["details"]["reason"] == "official_login_required"
        transport.assert_not_called()
        context.commit.assert_not_called()
        assert not context.session.mock_calls


def test_legacy_import_requires_authentication():
    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(router, prefix="/api/v1")
    with TestClient(app) as client:
        response = client.post("/api/v1/facebook-identities/auto-connect-token", json={})
        assert response.status_code == 401


@pytest.mark.parametrize("url,env", [
    ("postgresql://u:p@localhost/production", {"ENVIRONMENT": "test", "ADSOPS_ALLOW_TEST_SCHEMA_RESET": "1"}),
    ("postgresql://u:p@localhost/app_test", {"ENVIRONMENT": "production", "ADSOPS_ALLOW_TEST_SCHEMA_RESET": "1"}),
    ("postgresql://u:p@localhost/app_test", {"ENVIRONMENT": "test"}),
    ("sqlite:///:memory:", {"ENVIRONMENT": "test", "ADSOPS_ALLOW_TEST_SCHEMA_RESET": "1"}),
    ("not-a-url", {}),
])
def test_schema_reset_refuses_unsafe_or_unapproved_target(url, env):
    with pytest.raises(RuntimeError, match="reset refused") as error:
        require_test_schema_reset(url, env)
    assert url not in str(error.value)


def test_schema_reset_allows_explicit_verified_test_target():
    require_test_schema_reset("postgresql+psycopg://u:p@localhost/app_test", {
        "ENVIRONMENT": "test", "ADSOPS_ALLOW_TEST_SCHEMA_RESET": "1",
    })
