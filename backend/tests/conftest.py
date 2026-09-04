from __future__ import annotations

import os
import uuid

# Configured before any application module reads settings.
os.environ.setdefault(
    "DATABASE_URL", "postgresql+psycopg://adsops:adsops@localhost:5434/adsops_test"
)
os.environ.setdefault("JWT_SECRET", "test-secret-not-used-in-production")
os.environ.setdefault("BOOTSTRAP_OWNER_EMAIL", "")
os.environ.setdefault("BOOTSTRAP_OWNER_PASSWORD", "")
os.environ.setdefault("ENVIRONMENT", "test")

import pytest  # noqa: E402
import sqlalchemy as sa  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from app.core.enums import WorkspaceRole  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.entities import User, Workspace, WorkspaceMember  # noqa: E402

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(scope="session", autouse=True)
def migrated_database():
    """Drop and rebuild the test schema with Alembic.

    Running the real migration (instead of `metadata.create_all`) means every test session is
    also a clean-database migration verification.
    """
    with engine.begin() as connection:
        connection.execute(sa.text("DROP SCHEMA public CASCADE"))
        connection.execute(sa.text("CREATE SCHEMA public"))
    config = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))
    command.upgrade(config, "head")
    yield


@pytest.fixture()
def db_session(migrated_database):
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()
        with engine.begin() as connection:
            tables = connection.execute(
                sa.text(
                    "SELECT tablename FROM pg_tables WHERE schemaname='public' "
                    "AND tablename <> 'alembic_version'"
                )
            ).scalars().all()
            if tables:
                joined = ", ".join(f'"{table}"' for table in tables)
                connection.execute(sa.text(f"TRUNCATE {joined} RESTART IDENTITY CASCADE"))


def _create_workspace(session, *, name: str, email: str, password: str = "correct-horse-battery"):
    workspace = Workspace(name=name, slug=f"{name.lower().replace(' ', '-')}-{uuid.uuid4().hex[:6]}")
    user = User(email=email, full_name=name, password_hash=hash_password(password), is_active=True)
    session.add_all([workspace, user])
    session.flush()
    session.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=WorkspaceRole.OWNER))
    session.commit()
    return workspace, user, password


@pytest.fixture()
def app(db_session):
    return create_app()


@pytest.fixture()
def client(app):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def owner(db_session):
    workspace, user, password = _create_workspace(
        db_session, name="Primary", email="owner@example.com"
    )
    return {"workspace": workspace, "user": user, "password": password}


@pytest.fixture()
def other_owner(db_session):
    workspace, user, password = _create_workspace(
        db_session, name="Secondary", email="other@example.com"
    )
    return {"workspace": workspace, "user": user, "password": password}


def login(client: TestClient, email: str, password: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture()
def auth(client, owner) -> dict[str, str]:
    return login(client, owner["user"].email, owner["password"])


@pytest.fixture()
def other_auth(client, other_owner) -> dict[str, str]:
    return login(client, other_owner["user"].email, other_owner["password"])


@pytest.fixture()
def api(client, auth):
    """Thin helper so tests read as API calls rather than header plumbing."""

    class Api:
        def get(self, url, **kwargs):
            return client.get(url, headers=auth, **kwargs)

        def post(self, url, **kwargs):
            return client.post(url, headers=auth, **kwargs)

        def patch(self, url, **kwargs):
            return client.patch(url, headers=auth, **kwargs)

    return Api()
