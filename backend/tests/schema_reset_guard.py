"""Fail-closed precondition for destructive PostgreSQL test fixtures."""
from collections.abc import Mapping

from sqlalchemy.engine import make_url


def require_test_schema_reset(database_url: str, environment: Mapping[str, str]) -> None:
    """Operator must first verify isolation; a database suffix alone is not authority."""
    try:
        url = make_url(database_url)
        valid_target = (
            url.get_backend_name() == "postgresql"
            and bool(url.database)
            and url.database.endswith("_test")
        )
    except Exception:
        valid_target = False
    if (
        environment.get("ADSOPS_ALLOW_TEST_SCHEMA_RESET") != "1"
        or environment.get("ENVIRONMENT") != "test"
        or not valid_target
    ):
        raise RuntimeError(
            "Test schema reset refused. Verify an isolated PostgreSQL *_test database, "
            "set ENVIRONMENT=test and ADSOPS_ALLOW_TEST_SCHEMA_RESET=1."
        )
