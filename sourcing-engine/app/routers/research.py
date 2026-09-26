"""FastAPI routes for the Mergero Regional M&A Sourcing Engine."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.config import get_logger
from app.models.schemas import (
    CompanyResearchRequest,
    CompanyUniverseOutput,
    Phase1Output,
    Phase2Output,
    RegionResearchRequest,
    UniverseSourcingRequest,
)
from app.services import research_service, storage
from app.services.openai_client import ResearchError
from app.services.research_service import Phase1NotFoundError

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1", tags=["research"])


@router.post("/research/region", response_model=Phase1Output)
def research_region(body: RegionResearchRequest) -> Phase1Output:
    """Phase 1: research regional sell-signals, persist, and return the checklist."""
    try:
        return research_service.research_region_signals(
            region=body.region, industry_focus=body.industry_focus
        )
    except ResearchError as exc:
        logger.error("region research failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)
        ) from exc


@router.post("/research/company", response_model=Phase2Output)
def research_company(body: CompanyResearchRequest) -> Phase2Output:
    """Phase 2: load region Phase 1 data, research a company, persist, and return."""
    try:
        return research_service.research_company_signals(
            company_name=body.company_name,
            company_website=body.company_website,
            region=body.region,
        )
    except Phase1NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc
    except ResearchError as exc:
        logger.error("company research failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)
        ) from exc


@router.post("/sourcing/universe", response_model=CompanyUniverseOutput)
def source_universe(body: UniverseSourcingRequest) -> CompanyUniverseOutput:
    """Phase 0: source candidate private companies for a region."""
    try:
        return research_service.source_company_universe(
            region=body.region,
            criteria=body.criteria,
            max_companies=body.max_companies,
        )
    except ResearchError as exc:
        logger.error("universe sourcing failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)
        ) from exc


@router.get("/reports/company/{company_slug}", response_model=Phase2Output)
def get_company_report(company_slug: str) -> Phase2Output:
    """Fetch a previously-saved Phase 2 report by company slug."""
    data = storage.load_company_report_by_slug(company_slug)
    if data is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No report found for company slug '{company_slug}'.",
        )
    return Phase2Output.model_validate(data)
