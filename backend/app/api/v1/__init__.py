from fastapi import APIRouter

from app.api.v1.routers import (
    account_operations,
    ad_accounts,
    alerts,
    audit,
    auth,
    events,
    extension,
    health,
    meta_operations,
    operations,
    preflight,
    readiness,
    references,
    security_sessions,
    system,
    team,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(ad_accounts.router)
api_router.include_router(references.router)
api_router.include_router(readiness.router)
api_router.include_router(events.router)
api_router.include_router(health.router)
api_router.include_router(alerts.router)
api_router.include_router(audit.router)
api_router.include_router(system.router)
api_router.include_router(operations.router)
api_router.include_router(extension.router)
api_router.include_router(extension.account_router)
api_router.include_router(preflight.router)
api_router.include_router(preflight.findings_router)
api_router.include_router(account_operations.router)
api_router.include_router(meta_operations.router)
api_router.include_router(security_sessions.router)
api_router.include_router(team.router)
