"""FastAPI application entrypoint for the Mergero Regional M&A Sourcing Engine."""

from __future__ import annotations

from fastapi import FastAPI

from app.config import configure_logging, get_logger, get_settings
from app.routers import research, market

configure_logging()
logger = get_logger(__name__)

app = FastAPI(
    title="Mergero Regional M&A Sourcing Engine",
    description=(
        "Two-phase regional sell-signal research pipeline. Phase 1 builds a "
        "regionally-grounded sell-signal checklist; Phase 2 gathers public "
        "evidence for each signal against a target company. This service "
        "gathers evidence and deterministically ranks research priorities."
    ),
    version="1.0.0",
)

app.include_router(research.router)
app.include_router(market.router)


@app.on_event("startup")
def _on_startup() -> None:
    settings = get_settings()
    logger.info(
        "startup model=%s web_search=%s storage=%s",
        settings.openai_model,
        settings.enable_web_search,
        settings.storage_path,
    )
    if not settings.openai_api_key:
        logger.warning("OPENAI_API_KEY not set — research calls will fail until configured.")


@app.get("/health", tags=["health"])
def health() -> dict:
    """Liveness probe."""
    settings = get_settings()
    return {"status": "ok", "research_configured": bool(settings.openai_api_key and settings.enable_web_search and settings.allow_paid_research), "authentication_configured": bool(settings.sourcing_api_token), "schema_version": 2}


@app.get("/", tags=["health"])
def root() -> dict:
    """Basic service metadata."""
    return {
        "service": "mergero-regional-sourcing-engine",
        "docs": "/docs",
        "endpoints": [
            "POST /api/v1/research/region",
            "POST /api/v1/research/company",
            "POST /api/v1/sourcing/universe",
            "GET /api/v1/reports/company/{company_slug}",
        ],
    }
