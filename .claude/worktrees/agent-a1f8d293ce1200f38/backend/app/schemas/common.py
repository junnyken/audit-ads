"""Shared request/response schema plumbing.

`StrictPayload` is the security boundary for request bodies: a payload carrying a
secret-bearing field name is refused outright rather than quietly dropped, so an operator
never believes a credential was stored somewhere in this product.
"""
from __future__ import annotations

from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, model_validator

from app.core.errors import ForbiddenFieldError
from app.core.redaction import find_sensitive_keys, looks_like_credential_value

T = TypeVar("T")


class StrictPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @model_validator(mode="before")
    @classmethod
    def _reject_sensitive_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            offending = find_sensitive_keys(data)
            if offending:
                raise ForbiddenFieldError(
                    "This product never stores credentials or session material. "
                    "Remove these fields and retry.",
                    details={"fields": offending},
                )
        return data


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    page: int
    page_size: int
    total: int
    total_pages: int


def page_response(items: list[Any], *, page: int, page_size: int, total: int) -> dict[str, Any]:
    return {
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": (total + page_size - 1) // page_size if page_size else 0,
    }


def reject_credential_like(value: str | None, *, field: str) -> str | None:
    """Value-level guard for reference fields that operators might paste a connection string into."""
    if value and looks_like_credential_value(value):
        raise ForbiddenFieldError(
            f"'{field}' looks like a connection string or credential. Store an opaque operator "
            "label instead — this product does not hold proxy or account secrets.",
            details={"field": field},
        )
    return value
