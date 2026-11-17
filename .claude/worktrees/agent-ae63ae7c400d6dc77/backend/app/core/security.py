"""Password hashing (stdlib PBKDF2) and JWT issuing/verification.

PBKDF2-HMAC-SHA256 from the standard library is used instead of a native bcrypt binding: it
needs no compiled dependency on the target VPS and is the same primitive Django ships by
default. Iterations are stored inside the hash so they can be raised later without a migration.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from app.core.config import get_settings

_ALGORITHM = "pbkdf2_sha256"
_ITERATIONS = 260_000


def hash_password(password: str) -> str:
    if not password:
        raise ValueError("password must not be empty")
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _ITERATIONS).hex()
    return f"{_ALGORITHM}${_ITERATIONS}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, iterations, salt, digest = stored.split("$", 3)
    except ValueError:
        return False
    if algorithm != _ALGORITHM:
        return False
    computed = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iterations)).hex()
    return hmac.compare_digest(computed, digest)


#: A dashboard session. Tokens issued before A5 carry no `token_use` claim and are treated as
#: this, so adding the claim signs nobody out.
TOKEN_USE_DASHBOARD = "dashboard"
#: A browser-extension session: scope-limited, shorter-lived, revocable by installation.
TOKEN_USE_EXTENSION = "extension"


def create_access_token(
    *,
    subject: str,
    workspace_id: str,
    role: str,
    token_use: str = TOKEN_USE_DASHBOARD,
    expires_in_minutes: int | None = None,
    extra_claims: dict[str, Any] | None = None,
) -> tuple[str, datetime]:
    settings = get_settings()
    minutes = (
        expires_in_minutes
        if expires_in_minutes is not None
        else settings.access_token_expire_minutes
    )
    expires_at = datetime.now(UTC) + timedelta(minutes=minutes)
    payload: dict[str, Any] = {
        "sub": subject,
        "workspace_id": workspace_id,
        "role": role,
        "token_use": token_use,
        "exp": expires_at,
        "iat": datetime.now(UTC),
        **(extra_claims or {}),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, expires_at


def decode_access_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
