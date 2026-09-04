from fastapi import APIRouter

from app.api.v1.routers import ad_accounts, audit, auth, events, readiness, references, system

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(ad_accounts.router)
api_router.include_router(references.router)
api_router.include_router(readiness.router)
api_router.include_router(events.router)
api_router.include_router(audit.router)
api_router.include_router(system.router)
