"""FastAPI application entrypoint for the Mergero Regional M&A Sourcing Engine."""

from __future__ import annotations

from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, Request

from app import diagnostics
from app.config import configure_logging, get_logger, get_settings
from app.routers import research, market, quick, diagnostics as diagnostics_router

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
app.include_router(quick.router)
app.include_router(diagnostics_router.router)


@app.middleware("http")
async def _trace_requests(request: Request, call_next):
    """One trace id per request; logs method, path, status and duration only
    (never bodies or headers). Unhandled crashes are logged with a traceback."""
    token = diagnostics.set_trace("req-" + uuid4().hex[:12])
    started = perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("request crashed method=%s path=%s duration_ms=%d", request.method, request.url.path, (perf_counter() - started) * 1000)
        raise
    else:
        if response.status_code >= 400:
            log = logger.warning
        elif request.url.path == "/health":
            return response  # container health probes every few seconds; not worth a line
        else:
            log = logger.info
        log("request method=%s path=%s status=%d duration_ms=%d", request.method, request.url.path, response.status_code, (perf_counter() - started) * 1000)
        return response
    finally:
        diagnostics.reset_trace(token)


@app.on_event("startup")
def _on_startup() -> None:
    settings = get_settings()
    logger.info(
        "startup model=%s web_search=%s paid_research=%s storage=%s logs=%s model_api=%s",
        settings.openai_model,
        settings.enable_web_search,
        settings.allow_paid_research,
        settings.storage_path,
        settings.log_path,
        settings.model_api_url,
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
