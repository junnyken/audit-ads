from __future__ import annotations

from contextlib import asynccontextmanager

import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.middleware import RequestContextMiddleware, SecurityHeadersMiddleware
from app.api.rate_limit_middleware import RateLimitMiddleware
from app.api.v1 import api_router
from app.bootstrap import bootstrap_owner
from app.core.config import get_settings
from app.core.errors import install_exception_handlers
from app.core.logging import configure_logging
from app.core.production_checks import enforce, is_production
from app.db.session import SessionLocal, engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)

    # Validate before anything else. A production process that boots with a placeholder secret
    # or the pilot password still active looks healthy from outside, which is worse than a
    # refusal: `enforce` raises in production and only warns elsewhere.
    import logging as _logging

    for finding in enforce(settings):
        _logging.getLogger(__name__).warning(
            "configuration finding", extra={"code": finding.code, "severity": finding.severity}
        )

    with SessionLocal() as session:
        try:
            bootstrap_owner(session)
        except Exception:  # pragma: no cover - startup must not crash on a cold database
            session.rollback()
            import logging

            logging.getLogger(__name__).exception("bootstrap failed")
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        # The OpenAPI schema is a map of the whole API. Publishing it to the internet is a
        # gift to anyone probing the deployment, so production serves no docs by default.
        docs_url="/docs" if settings.enable_api_docs else None,
        redoc_url="/redoc" if settings.enable_api_docs else None,
        openapi_url="/openapi.json" if settings.enable_api_docs else None,
        description=(
            "AdsOps Control Center — account registry and evidence-based operational readiness. "
            "Readiness states are internal operational states; they are not platform approvals "
            "and do not guarantee that an account cannot be restricted."
        ),
        lifespan=lifespan,
    )

    # Starlette runs middleware in REVERSE registration order, so the first registered is
    # innermost. The rate limiter goes first — and therefore innermost — on purpose: its 429 is
    # generated in middleware rather than by the router, so everything that must decorate a
    # response has to sit outside it. Inside CORS, a browser would render the refusal as an
    # opaque CORS failure instead of "you are being rate limited"; inside the security-header
    # and request-context layers, the refusal would lose its headers and its request id. It
    # still short-circuits before any route, session or database work.
    app.add_middleware(RateLimitMiddleware, settings=settings)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID", "Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining"],
    )
    app.add_middleware(RequestContextMiddleware)

    install_exception_handlers(app)
    app.include_router(api_router, prefix=settings.api_prefix)

    if is_production(settings) and settings.enable_api_docs:
        import logging as _log

        _log.getLogger(__name__).warning("api docs are enabled in a production environment")

    @app.get("/health/live", tags=["health"])
    def health_live() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/ready", tags=["health"])
    def health_ready() -> JSONResponse:
        try:
            with engine.connect() as connection:
                connection.execute(sa.text("SELECT 1"))
        except Exception:
            return JSONResponse(
                status_code=503, content={"status": "unavailable", "database": "unreachable"}
            )
        return JSONResponse(status_code=200, content={"status": "ok", "database": "reachable"})

    return app


app = create_app()
