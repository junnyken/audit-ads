"""Project-standard error envelope.

Every failure returned by the API has the shape::

    {"error": {"code": "...", "message": "...", "details": {...}, "request_id": "..."}}

The request/correlation id lets the operator quote one string when reporting a problem
(A1 §G.7 requires the UI to surface it).
"""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.context import get_request_id


class DomainError(Exception):
    """Base class for expected, user-actionable failures."""

    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "domain_error"

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class NotFoundError(DomainError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"


class ConflictError(DomainError):
    status_code = status.HTTP_409_CONFLICT
    code = "conflict"


class ValidationError(DomainError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "validation_error"


class ForbiddenFieldError(ValidationError):
    """A secret-bearing field reached the API. It is refused, never stored."""

    code = "forbidden_field"


class AuthenticationError(DomainError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "not_authenticated"


class AuthorizationError(DomainError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "not_authorized"


class ArchivedEntityError(ConflictError):
    code = "entity_archived"


def error_payload(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
            "request_id": get_request_id(),
        }
    }


def install_exception_handlers(app: Any) -> None:
    @app.exception_handler(DomainError)
    async def _domain(_: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(exc.code, exc.message, exc.details),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        # errors() can carry the rejected input; drop it so a secret in a bad payload is not
        # echoed back to the client or into access logs.
        details = [
            {"loc": list(err.get("loc", ())), "type": err.get("type"), "msg": err.get("msg")}
            for err in exc.errors()
        ]
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=error_payload("validation_error", "Request payload is not valid.", {"errors": details}),
        )

    @app.exception_handler(HTTPException)
    async def _http(_: Request, exc: HTTPException) -> JSONResponse:
        code = {401: "not_authenticated", 403: "not_authorized", 404: "not_found"}.get(
            exc.status_code, "http_error"
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(code, str(exc.detail)),
            headers=getattr(exc, "headers", None),
        )
