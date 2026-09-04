"""Request-scoped correlation id, readable from anywhere without threading it through calls."""
from __future__ import annotations

import uuid
from contextvars import ContextVar

_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)


def set_request_id(value: str | None) -> str:
    resolved = value or uuid.uuid4().hex
    _request_id.set(resolved)
    return resolved


def get_request_id() -> str | None:
    return _request_id.get()
