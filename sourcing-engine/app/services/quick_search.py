"""Registry-first market screen: real companies ranked in seconds with zero LLM calls.

Official register (search + enrichment) -> Eurostat sector context -> Java model ->
deterministic v3 priority. Results use the same Opportunity/CompanyReport shape as deep
research, so the UI and library treat them identically, labelled as a registry screen.
Cached per market so a live demo repeats instantly.
"""
from __future__ import annotations

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Lock

from app.config import get_logger, get_settings
from app.models.schemas import CandidateCompany, Phase1Output, Phase2Output
from app.services import registries, sector_context, storage, structured_model
from app.services.registries import RegistryCompany
from app.services.registries.http import RegistryUnavailable

logger = get_logger(__name__)
CACHE_VERSION = 2
PARTIAL_CACHE_HOURS = 0.25
_locks: dict[str, Lock] = {}
_locks_guard = Lock()
_profiles: dict[tuple[str, str], RegistryCompany] = {}


class UnsupportedMarket(ValueError):
    """No open registry adapter exists for this country yet."""


def _market_lock(name: str) -> Lock:
    with _locks_guard:
        return _locks.setdefault(name, Lock())


def market_id(country: str, industry: str) -> str:
    return hashlib.sha256(json.dumps(["quick", country.casefold(), industry.casefold()]).encode()).hexdigest()[:32]


def profile(country: str, registry_id: str) -> RegistryCompany | None:
    return _profiles.get((country.casefold(), registry_id))


def known_facts_text(company: RegistryCompany) -> str:
    """Registry facts handed to deep research, so paid web searches focus on news and events."""
    parts = [f"{f.field}={f.value} ({f.provenance}, as of {f.as_of})" for f in company.structured_facts()]
    if company.auditor:
        parts.append(f"auditor={company.auditor}")
    parts += [f"{s.label} on {s.date}" for s in company.signals if s.date]
    return "; ".join(parts)


def run(country: str, industry: str, limit: int | None = None) -> dict:
    adapter = registries.adapter_for(country)
    if adapter is None:
        raise UnsupportedMarket(f"Quick search is not available for {country} yet.")
    settings = get_settings()
    limit = limit or settings.quick_search_limit
    path = storage.cache_path("quick", [CACHE_VERSION, country.strip().casefold(), industry.strip().casefold(), limit])
    with _market_lock(str(path)):
        cached = _read_cache(path, settings.quick_cache_hours, country)
        if cached:
            return cached
        started = datetime.now(timezone.utc)
        companies = adapter.search(industry, limit)
        if not companies:
            raise RegistryUnavailable("The official register returned no companies for this market right now.")
        with ThreadPoolExecutor(max_workers=6, thread_name_prefix="registry") as pool:
            companies = list(pool.map(lambda c: _enrich(adapter, c), companies))
        sector = sector_context.get(country, industry)
        framework = Phase1Output(region=country, industry=industry, research_mode="unknown",
                                 summary=_sector_summary(sector),
                                 data_availability="Registry screen from official open data; news and leadership events not yet researched.")
        job_id = market_id(country, industry)

        def score(company: RegistryCompany):
            from app.services.market import persist_result
            report = registry_report(company, country)
            model = structured_model.score(report, industry)
            return persist_result(job_id, candidate(company), report, model, framework, country, industry,
                                  registry=company, sector=sector, save=False)

        with ThreadPoolExecutor(max_workers=6, thread_name_prefix="quick-score") as pool:
            results = list(pool.map(score, companies))
        results.sort(key=lambda r: (-(r["priority"] or 0), r["company"]))
        for company in companies:
            _profiles[(country.casefold(), company.registry_id)] = company
        unavailable = sum(bool(c.notes and any("unavailable" in n for n in c.notes)) for c in companies)
        warnings = [f"Some registry details were temporarily unavailable for {unavailable} companies; their scores use the data that was available."] if unavailable else []
        job = dict(id=job_id, country=country, industry=industry, status="complete", stages=["complete"] * 6, results=results,
                   warnings=warnings, error=None, mode="quick", screened=len(companies), sector=sector,
                   generated_at=datetime.now(timezone.utc).isoformat(),
                   duration_s=(datetime.now(timezone.utc) - started).total_seconds(), cache_hit=False)
        # A screen with registry gaps (e.g. rate-limited accounts) expires quickly so the gaps get retried.
        storage._write_json(path, dict(cached_at=job["generated_at"], partial=bool(unavailable), job=job,
                                       profiles=[c.model_dump() for c in companies]))
        logger.info("quick search complete country=%s industry=%s companies=%d duration_s=%.1f", country, industry, len(companies), job["duration_s"])
        return job


def _read_cache(path, hours: float, country: str) -> dict | None:
    if not path.exists():
        return None
    try:
        envelope = json.loads(path.read_text(encoding="utf-8"))
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(envelope["cached_at"])).total_seconds()
        if not 0 <= age < (min(hours, PARTIAL_CACHE_HOURS) if envelope.get("partial") else hours) * 3600:
            return None
        for data in envelope["profiles"]:
            company = RegistryCompany.model_validate(data)
            _profiles[(country.casefold(), company.registry_id)] = company
        return {**envelope["job"], "cache_hit": True}
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _enrich(adapter, company: RegistryCompany) -> RegistryCompany:
    try:
        return adapter.enrich(company)
    except Exception as exc:   # one company's registry hiccup never sinks the screen
        logger.warning("registry enrich failed company=%s error=%s: %s", company.registry_id, type(exc).__name__, exc)
        company.notes.append("Additional registry details were unavailable.")
        return company


def candidate(company: RegistryCompany) -> CandidateCompany:
    return CandidateCompany(name=company.name, website=company.website, country=company.country, industry=company.industry,
                            registry_id=company.registry_id, source=company.source_url)


def registry_report(company: RegistryCompany, country: str) -> Phase2Output:
    return Phase2Output(company_name=company.name, region=country, website=company.website,
                        structured_facts=company.structured_facts(), verification_complete=False,
                        verification_method="Official registry data; no web research yet",
                        data_gaps=["Recent news, leadership changes and ownership events have not been researched yet. Run deep research."] + company.notes,
                        summary=f"Registry profile from {company.registry}.")


def _sector_summary(sector: dict) -> str:
    if not sector.get("available"):
        return "Sector ageing statistics are not published for this market."
    parts = []
    if sector.get("owner_share") is not None:
        parts.append(f"{sector['owner_share'] * 100:.0f}% of the sector's self-employed owners are 50 or older ({sector['owner_ratio']:.2f}x the national average)")
    if sector.get("workforce_share") is not None:
        parts.append(f"{sector['workforce_share'] * 100:.0f}% of its workforce is 50 or older ({sector['workforce_ratio']:.2f}x)")
    return "Eurostat " + str(sector.get("year")) + ": " + "; ".join(parts) + "."
