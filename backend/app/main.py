from __future__ import annotations

from contextlib import asynccontextmanager

import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.middleware import RequestContextMiddleware, SecurityHeadersMiddleware
from app.api.v1 import api_router
from app.bootstrap import bootstrap_owner
from app.core.config import get_settings
from app.core.errors import install_exception_handlers
from app.core.logging import configure_logging
from app.db.session import SessionLocal, engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)
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
        description=(
            "AdsOps Control Center — account registry and evidence-based operational readiness. "
            "Readiness states are internal operational states; they are not platform approvals "
            "and do not guarantee that an account cannot be restricted."
        ),
        lifespan=lifespan,
    )

    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )
    app.add_middleware(RequestContextMiddleware)

    install_exception_handlers(app)
    app.include_router(api_router, prefix=settings.api_prefix)

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
