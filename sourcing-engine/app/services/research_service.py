"""Core pipeline orchestration for the regional sell-signal research engine.

Exposes the three pipeline functions:
  - research_region_signals   (Phase 1)
  - source_company_universe   (Phase 0, optional)
  - research_company_signals  (Phase 2)

Each function builds prompts, calls OpenAI via the client wrapper, validates the
result against a Pydantic schema, persists it, and returns the typed model.
"""

from __future__ import annotations

from typing import Optional

from app.config import get_logger
from app.models.schemas import (
    CompanyUniverseOutput,
    Phase1Output,
    Phase2Output,
)
from app.services import prompts, storage
from app.services.openai_client import ResearchError, run_structured_research

logger = get_logger(__name__)


class Phase1NotFoundError(RuntimeError):
    """Raised when Phase 2 is requested but no Phase 1 data exists for the region."""


def research_region_signals(
    region: str, industry_focus: Optional[str] = None
) -> Phase1Output:
    """Phase 1: research the regional sell-signal checklist and persist it."""
    logger.info("phase1 start region=%s industry_focus=%s", region, industry_focus)

    result = run_structured_research(
        system_prompt=prompts.phase1_system_prompt(),
        user_prompt=prompts.phase1_user_prompt(region, industry_focus),
        schema=Phase1Output,
    )

    # Ensure the region label is present even if the model omitted it.
    if not result.region:
        result.region = region

    storage.save_region_signals(region, result.model_dump())
    logger.info(
        "phase1 complete region=%s signals=%d", region, len(result.signals)
    )
    return result


def source_company_universe(
    region: str, criteria: str, max_companies: int = 15
) -> CompanyUniverseOutput:
    """Phase 0 (optional): source candidate private companies for a region."""
    logger.info(
        "phase0 start region=%s max=%d criteria=%s", region, max_companies, criteria
    )

    result = run_structured_research(
        system_prompt=prompts.phase0_system_prompt(),
        user_prompt=prompts.phase0_user_prompt(region, criteria, max_companies),
        schema=CompanyUniverseOutput,
    )

    if not result.region:
        result.region = region
    if not result.criteria:
        result.criteria = criteria

    # Enforce the requested cap defensively.
    if len(result.companies) > max_companies:
        result.companies = result.companies[:max_companies]

    logger.info("phase0 complete region=%s companies=%d", region, len(result.companies))
    return result


def research_company_signals(
    company_name: str,
    company_website: Optional[str],
    region: str,
    phase1_data: Optional[dict] = None,
) -> Phase2Output:
    """Phase 2: research one company against the region's Phase 1 checklist.

    If `phase1_data` is not supplied, it is loaded from disk. Raises
    Phase1NotFoundError if no Phase 1 data exists for the region.
    """
    logger.info("phase2 start company=%s region=%s", company_name, region)

    if phase1_data is None:
        phase1_data = storage.load_region_signals(region)
    if phase1_data is None:
        raise Phase1NotFoundError(
            f"No Phase 1 signals found for region '{region}'. "
            f"Run POST /api/v1/research/region first."
        )

    result = run_structured_research(
        system_prompt=prompts.phase2_system_prompt(),
        user_prompt=prompts.phase2_user_prompt(
            company_name, company_website, region, phase1_data
        ),
        schema=Phase2Output,
    )

    # Never relabel another company's output as this company's research.
    if result.company_name.casefold().strip() != company_name.casefold().strip():
        raise ResearchError("Research response company does not match the request.")
    if result.region.casefold().strip() != region.casefold().strip():
        raise ResearchError("Research response region does not match the request.")
    if not result.website:
        result.website = company_website

    allowed_ids = {signal["id"] for signal in phase1_data.get("signals", [])}
    retrieved = set(result.retrieved_source_urls)
    for evidence in result.signal_evidence:
        if evidence.signal_id not in allowed_ids:
            raise ResearchError("Research response contains an unknown checklist signal.")
        evidence.sources = [url for url in evidence.sources if url in retrieved and url.startswith(("https://", "http://"))]
        evidence.verification_status = "unverified"  # citations alone are not independent corroboration
        if result.research_mode != "web_search" or not evidence.sources or not evidence.evidence_found:
            evidence.evidence_found = None
            evidence.sources = []
            evidence.confidence = "low"
            evidence.verification_status = "insufficient_evidence"
            if evidence.signal_id not in result.data_gaps:
                result.data_gaps.append(evidence.signal_id)
    reported = {e.signal_id for e in result.signal_evidence if e.evidence_found}
    result.data_gaps = sorted(allowed_ids - reported)

    storage.save_company_signals(company_name, region, result.model_dump())
    logger.info(
        "phase2 complete company=%s evidence=%d gaps=%d",
        company_name,
        len(result.signal_evidence),
        len(result.data_gaps),
    )
    return result


__all__ = [
    "ResearchError",
    "Phase1NotFoundError",
    "research_region_signals",
    "source_company_universe",
    "research_company_signals",
]
