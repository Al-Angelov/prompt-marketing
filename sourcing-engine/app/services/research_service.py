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
from datetime import datetime, timezone
import json
import re
from threading import RLock
from pydantic import ValidationError

from app.config import get_logger, get_settings
from app.models.schemas import (
    CompanyUniverseOutput,
    Phase1Output,
    Phase2Output,
)
from app.services import prompts, storage
from app.services.openai_client import ResearchError, run_structured_research
from app.services.verification import verify_report, clean_citations, known_date, public_url

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

    # Keep the requested market identity; do not silently relabel another region.
    if result.region.casefold().strip() != region.casefold().strip():
        raise ResearchError("Regional research identity mismatch")
    if result.research_mode != "web_search" or not result.retrieved_source_urls or not result.signals:
        raise ResearchError("Regional framework requires grounded research")
    if len({s.id for s in result.signals}) != len(result.signals):
        raise ResearchError("Duplicate regional signal identifiers")
    if result.industry and industry_focus and result.industry.casefold().strip() != industry_focus.casefold().strip():
        raise ResearchError("Regional industry identity mismatch")
    result.industry = industry_focus or "All industries"
    for signal in result.signals:
        signal.evidence_urls = [u for u in signal.evidence_urls if u in result.retrieved_source_urls and public_url(u)]
        if not signal.evidence_urls:
            signal.signal_strength = "weak"
    result.generated_at = datetime.now(timezone.utc).isoformat()

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
        "phase0 start region=%s max=%d", region, max_companies
    )

    result = run_structured_research(
        system_prompt=prompts.phase0_system_prompt(),
        user_prompt=prompts.phase0_user_prompt(region, criteria, max_companies),
        schema=CompanyUniverseOutput,
    )

    if result.region.casefold().strip() != region.casefold().strip() or result.research_mode != "web_search":
        raise ResearchError("Ungrounded or mismatched discovery response")
    if not result.criteria:
        result.criteria = criteria

    # Enforce the requested cap defensively.
    if len(result.companies) > max_companies:
        result.companies = result.companies[:max_companies]
    returned = len(result.companies)
    grounded = {}
    retrieved = set(result.retrieved_source_urls)
    for company in result.companies:
        # Older extraction schemas allowed prose in `source`. Recover only an
        # exact retrieved URL, never a guessed website or a substring match.
        source = company.source or ""
        urls = [source.strip(), *re.findall(r'https?://[^\s<>"\[\]]+', source)]
        company.source = next((candidate for url in urls for candidate in (url, url.rstrip('.,;:!?)]}'))
                               if candidate in retrieved and public_url(candidate)), None)
        if company.source:
            grounded[company.name.casefold()] = company
        else:
            logger.warning("discovery candidate excluded: source not retrieved company=%s source=%r", company.name, source[:500])
    result.companies = list(grounded.values())
    logger.info("discovery source validation returned=%d retained=%d", returned, len(result.companies))
    if returned and not result.companies:
        raise ResearchError("Company discovery returned candidates without retrievable sources; refusing an empty success.")
    for company in result.companies:
        if company.website and not public_url(company.website):
            company.website = None
    result.generated_at = datetime.now(timezone.utc).isoformat()

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
    # Verification is owned by the separate verifier, never self-declared by extraction.
    result.verification_complete = False
    result.verification_method = "Not performed"
    result.cache_hit = False
    # Models sometimes return several findings for one signal (e.g. a supporting and a
    # contradicting one). Keep each as its own item so counter-evidence is never merged
    # away; repeats get a suffixed id ("leadership-2") that still maps to its signal.
    base_id, seen = {}, {}
    for evidence in result.signal_evidence:
        original = evidence.signal_id
        seen[original] = seen.get(original, 0) + 1
        if seen[original] > 1:
            evidence.signal_id = f"{original}-{seen[original]}"
        base_id[evidence.signal_id] = original
    retrieved = set(result.retrieved_source_urls)
    for evidence in result.signal_evidence:
        if base_id[evidence.signal_id] not in allowed_ids:
            raise ResearchError("Research response contains an unknown checklist signal.")
        evidence.sources = [url for url in evidence.sources if url in retrieved and url.startswith(("https://", "http://"))]
        evidence.verification_status = "unverified"  # citations alone are not independent corroboration
        evidence.citations = clean_citations(evidence.citations, retrieved)
        if result.research_mode != "web_search" or not evidence.sources or not evidence.evidence_found:
            evidence.evidence_found = None
            evidence.sources = []
            evidence.confidence = "low"
            evidence.verification_status = "insufficient_evidence"
            if base_id[evidence.signal_id] not in result.data_gaps:
                result.data_gaps.append(base_id[evidence.signal_id])
    reported = {base_id[e.signal_id] for e in result.signal_evidence if e.evidence_found}
    result.data_gaps = sorted((set(result.data_gaps) - reported) | (allowed_ids - reported))
    # Only explicitly sourced, dated values survive. Conflicting duplicates become gaps.
    fields = {}
    conflicting = set()
    for fact in result.structured_facts:
        fact.sources = [url for url in fact.sources if url in retrieved and public_url(url)]
        if result.research_mode != "web_search" or not fact.sources or not known_date(fact.as_of) or fact.value is None:
            continue
        if fact.field in fields and fields[fact.field].value != fact.value:
            conflicting.add(fact.field)
        fields[fact.field] = fact
    result.conflicting_structured_facts = [f for f in result.structured_facts if f.field in conflicting]
    result.structured_facts = [fact for key, fact in fields.items() if key not in conflicting]
    result.data_gaps += ["Conflicting structured field: " + key for key in sorted(conflicting)]
    result.researched_at = datetime.now(timezone.utc).isoformat()

    storage.save_company_signals(company_name, region, result.model_dump())
    logger.info(
        "phase2 complete company=%s evidence=%d gaps=%d",
        company_name,
        len(result.signal_evidence),
        len(result.data_gaps),
    )
    return result


# One worker per container. Locks prevent concurrent clicks from duplicating paid calls.
# Durable cache keys include model, region, industry, company identity and schema version.
_research_lock = RLock()


def _cached(kind, identity, hours, schema, create):
    settings = get_settings()
    if not settings.enable_web_search:
        raise ResearchError("Live research requires ENABLE_WEB_SEARCH=true")
    path = storage.cache_path(kind, [4 if kind == "universe" else 3, settings.openai_model, *identity])
    if not _research_lock.acquire(timeout=1):
        raise ResearchError("Research already in progress; retry after it completes")
    try:
        if path.exists():
            try:
                envelope = json.loads(path.read_text(encoding="utf-8"))
                age = (datetime.now(timezone.utc) - datetime.fromisoformat(envelope["cached_at"])).total_seconds()
                if 0 <= age < hours * 3600 and envelope["value"].get("schema_version") == 2:
                    result = schema.model_validate(envelope["value"])
                    if result.research_mode == "web_search":
                        result.cache_hit = True
                        return result
            except (OSError, ValueError, TypeError, KeyError, ValidationError):
                pass  # invalid/old caches are never shown as new evidence
        result = create()
        if result.research_mode != "web_search":
            raise ResearchError("Ungrounded research cannot populate the live cache")
        # Keep incomplete verification available to the caller but retry on next investigation.
        if not isinstance(result, Phase2Output) or result.verification_complete:
            storage._write_json(path, {"cached_at": datetime.now(timezone.utc).isoformat(), "value": result.model_dump()})
        return result
    finally:
        _research_lock.release()


def cached_region(region: str, industry_focus: Optional[str] = None) -> Phase1Output:
    region = region.strip()
    return _cached("region", [region.casefold(), (industry_focus or "").strip().casefold()], get_settings().region_cache_hours, Phase1Output,
                   lambda: research_region_signals(region, industry_focus))


def cached_universe(region: str, criteria: str, max_companies: int = 5) -> CompanyUniverseOutput:
    return _cached("universe", [region.strip().casefold(), criteria.strip().casefold(), max_companies], 24, CompanyUniverseOutput,
                   lambda: source_company_universe(region.strip(), criteria.strip(), max_companies))


def investigate_company(company_name: str, company_website: Optional[str], region: str, industry_focus: Optional[str] = None, framework: Optional[Phase1Output] = None, on_verification=None) -> Phase2Output:
    company_name, region = company_name.strip(), region.strip()
    if company_website and not public_url(company_website):
        raise ResearchError("Company website must be an HTTP(S) URL")
    def create():
        regional_framework = framework or cached_region(region, industry_focus)
        report = research_company_signals(company_name, company_website, region, regional_framework.model_dump())
        if report.research_mode != "web_search":
            raise ResearchError("Live investigation requires web-search grounding")
        if on_verification:
            on_verification()
        report = verify_report(report)
        storage.save_company_signals(company_name, region, report.model_dump())
        return report
    return _cached("company", [region.casefold(), company_name.casefold(), company_website or "", (industry_focus or "").casefold()], get_settings().company_cache_hours, Phase2Output, create)


__all__ = [
    "ResearchError",
    "Phase1NotFoundError",
    "research_region_signals",
    "source_company_universe",
    "research_company_signals",
]
