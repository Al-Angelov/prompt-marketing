"""One bounded market workflow, with real progress and duplicate-start protection.
Jobs run outside the request lifetime so hosted gateway time limits do not cut off
multi-company research. Existing per-region and per-company caches are reused.
"""
from concurrent.futures import ThreadPoolExecutor
from threading import RLock
from time import time
from uuid import uuid4
from copy import deepcopy
import hashlib
import json
import re
from datetime import datetime, timezone
from app.models.schemas import CandidateCompany, CompanyReport, Phase2Output
from app.config import get_settings, get_logger
from app import diagnostics
from app.services import registries, research_service, sector_context, structured_model, storage
from app.services.assessment import assess
from app.services.mna_assessment import build_mna_assessment
from app.services.verification import public_url

_jobs = {}
_lock = RLock()
_worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="market")
logger = get_logger(__name__)
MARKET_CACHE_VERSION = 1


def reusable_results(results):
    return bool(results) and all(r["report"]["verification_complete"]
        and r["report"]["structured_model"].get("status") != "unavailable" for r in results)


def completed_path(country, industry):
    settings = get_settings()
    return storage.cache_path("market", [MARKET_CACHE_VERSION, settings.openai_model,
        settings.market_candidate_limit, country.strip().casefold(), industry.strip().casefold()])


def load_completed(country, industry):
    """Replay completed evidence without repeating research after a worker restart."""
    try:
        envelope = json.loads(completed_path(country, industry).read_text(encoding="utf-8"))
        created = envelope["created"]
        job = envelope["job"]
        if not 0 <= time() - created < get_settings().company_cache_hours * 3600:
            return None
        if (job["status"] != "complete" or not reusable_results(job["results"]) or job["warnings"]
                or job["country"].casefold() != country.casefold() or job["industry"].casefold() != industry.casefold()
                or not re.fullmatch(r"[a-f0-9]{32}", job["id"])):
            return None
        for result in job["results"]:
            report = CompanyReport.model_validate(result["report"])
            if not report.verification_complete or report.research_mode != "web_search":
                return None
        return {**job, "cache_hit": True, "_created": created,
                "_key": (country.casefold(), industry.casefold())}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None


def snapshot(job_id):
    with _lock:
        job = _jobs.get(job_id)
        return deepcopy({k: v for k, v in job.items() if not k.startswith("_")}) if job else None


def update(job_id, **fields):
    with _lock:
        _jobs[job_id].update(fields)


def start(country, industry):
    country, industry = country.strip(), industry.strip()
    key = (country.casefold(), industry.casefold())
    with _lock:
        for job_id in list(_jobs):
            job = _jobs[job_id]
            ttl = 3600 if job["status"] == "complete" and reusable_results(job["results"]) and not job["warnings"] else 60
            if job["status"] in ("complete", "error") and time()-job.get("_finished", job["_created"]) > ttl:
                del _jobs[job_id]
        for job in _jobs.values():
            if job["_key"] == key and job["status"] != "error":
                return snapshot(job["id"])
        cached = load_completed(country, industry)
        if cached:
            _jobs[cached["id"]] = cached
            return snapshot(cached["id"])
        settings = get_settings()
        if not settings.openai_api_key or not settings.enable_web_search or not settings.allow_paid_research:
            raise ValueError("Research is temporarily unavailable. Please try again later.")
        if sum(j["status"] == "running" for j in _jobs.values()) >= 3:
            raise ValueError("Research is busy right now. Please try again shortly.")
        job_id = uuid4().hex
        _jobs[job_id] = dict(id=job_id, country=country, industry=industry, status="running", stages=["pending"]*6,
                             results=[], warnings=[], error=None, _key=key, _created=time())
        _worker.submit(run, job_id, country, industry)
        return snapshot(job_id)


def run(job_id, country, industry):
    from app.services import quick_search   # imports persist_result from this module
    # Worker threads don't inherit the request's trace; tag all job lines with the job id.
    trace = diagnostics.set_trace("job-" + job_id[:12])
    started = time()
    logger.info("market job start job=%s country=%s industry=%s model=%s", job_id, country, industry, get_settings().openai_model)
    try:
        update(job_id, stages=["running", "pending", "pending", "pending", "pending", "pending"])
        framework = research_service.cached_region(country, industry)
        logger.info("stage 1/6 market framework ready signals=%d sources=%d cache_hit=%s", len(framework.signals), len(framework.retrieved_source_urls), framework.cache_hit)
        update(job_id, stages=["complete", "running", "pending", "pending", "pending", "pending"])
        limit = get_settings().market_candidate_limit
        registry_profiles = {}
        if registries.supported(country):
            # Registry-first: the quick screen already ranked real companies from the official
            # register, so deep research goes to the most promising ones. No discovery LLM calls.
            screen = quick_search.run(country, industry)
            chosen = research_candidates(screen["results"], limit)
            companies = [CandidateCompany(name=r["company"], website=r["report"]["company"].get("website"), country=country,
                                          industry=industry, registry_id=r["report"]["company"].get("registry_id"),
                                          source=r["report"]["company"].get("discovery_source")) for r in chosen]
            registry_profiles = {r["company"].casefold(): quick_search.profile(country, r["report"]["company"]["registry_id"]) for r in chosen}
            logger.info("stage 2/6 registry candidates=%d names=%s", len(companies), [c.name for c in companies])
        else:
            criteria = f"Privately held companies in {industry} in {country}. Return at most {limit} well-sourced candidates. Use this market framework to guide discovery: " + json.dumps(framework.model_dump(exclude={"cache_hit", "generated_at"}), ensure_ascii=False)
            candidates = research_service.cached_universe(country, criteria, limit)
            companies = candidates.companies
            logger.info("stage 2/6 candidates found=%d names=%s cache_hit=%s", len(companies), [c.name for c in companies], candidates.cache_hit)
        update(job_id, stages=["complete", "complete", "running", "pending", "pending", "pending"])
        reports, warnings = [], []
        labels = {signal.id: signal.name for signal in framework.signals}
        eligible = []
        for company in companies:
            # A mismatched market is not silently relabeled to the user's country.
            if not company.country or company.country.casefold().strip() != country.casefold():
                logger.warning("candidate excluded: country mismatch company=%s country=%s expected=%s", company.name, company.country, country)
                warnings.append(f"A candidate outside {country} was excluded.")
            else:
                eligible.append(company)

        def research(company):
            profile = registry_profiles.get(company.name.casefold())
            try:
                report = research_service.investigate_company(company.name, company.website, country, industry_focus=industry, framework=framework,
                    on_verification=lambda: update(job_id, stages=["complete", "complete", "running", "running", "pending", "pending"]),
                    known_facts=quick_search.known_facts_text(profile) if profile else None)
            except research_service.ResearchError as exc:
                logger.error("company research failed company=%s reason=%s", company.name, exc, exc_info=True)
                return company, None, profile
            report.data_gaps = ["No supporting public evidence: " + labels[gap] if gap in labels else gap for gap in report.data_gaps]
            if profile:
                report.structured_facts = merge_facts(profile.structured_facts(), report.structured_facts)
            logger.info("company researched company=%s evidence=%d gaps=%d verified=%s cache_hit=%s", company.name,
                        len(report.signal_evidence), len(report.data_gaps), report.verification_complete, report.cache_hit)
            return company, report, profile

        # Companies are independent, so research them concurrently (per-company cache locks prevent duplicates).
        with ThreadPoolExecutor(max_workers=max(1, min(3, len(eligible))), thread_name_prefix="company") as pool:
            outcomes = list(pool.map(lambda c: diagnostics_wrap("job-" + job_id[:12], research, c), eligible))
        for company, report, profile in outcomes:
            if report is None:
                warnings.append(f"Research for {company.name} could not be completed.")
                failed = Phase2Output(company_name=company.name, website=company.website, region=country,
                                      data_gaps=["Company research unavailable; no evidence substituted."],
                                      warnings=["Research failed; score reflects no established evidence."],
                                      structured_facts=profile.structured_facts() if profile else [])
                persist_result(job_id, company, failed, None, framework, country, industry, registry=profile)
            else:
                reports.append((company, report, profile))
        if companies and not reports:
            logger.error("no candidate could be researched; failing job candidates=%d", len(companies))
            raise ValueError("We couldn't verify the companies found. Please try again later or choose another market.")
        update(job_id, stages=["complete", "complete", "complete", "complete", "running", "pending"])
        scored = [(company, report, profile, structured_model.score(report, industry)) for company, report, profile in reports]
        logger.info("stage 5/6 structured model scored=%d unavailable=%d", sum(m is not None for *_, m in scored), sum(m is None for *_, m in scored))
        sector = sector_context.get(country, industry)
        update(job_id, stages=["complete"]*5 + ["running"])
        results = [persist_result(job_id, company, report, model, framework, country, industry, registry=profile, sector=sector)
                   for company, report, profile, model in scored]
        results.sort(key=lambda r: (r["priority"] is not None, r["priority"] or 0), reverse=True)
        completed = dict(status="complete", stages=["complete"]*6, results=results, warnings=warnings)
        if not warnings and reusable_results(results):
            try:
                storage._write_json(completed_path(country, industry), {"created": time(), "job": {**snapshot(job_id), **completed}})
            except OSError:
                logger.warning("completed market cache unavailable job=%s", job_id, exc_info=True)
        update(job_id, **completed, _finished=time())
        logger.info("market job complete results=%d warnings=%d duration_s=%.1f", len(results), len(warnings), time() - started)
    except Exception as exc:
        # Users get a generic message; the log keeps the real cause and traceback.
        logger.error("market job failed after %.1fs: %s: %s", time() - started, type(exc).__name__, exc, exc_info=True)
        update(job_id, status="error", error="We couldn't complete this research. Please try again later.")
    finally:
        diagnostics.reset_trace(trace)


def merge_facts(official, researched):
    """Official registry values win; researched facts only fill fields the registry lacks."""
    have = {f.field for f in official}
    return official + [f for f in researched if f.field not in have]


def research_candidates(results, limit):
    """Use scarce deep-research slots on observable businesses, then priority.

    A high demographic score on an opaque micro-company is a weak research lead.
    This only chooses the research queue; it never adds points to seller intent.
    """
    candidates = [r for r in results if r.get("report", {}).get("company", {}).get("registry_profile")]
    def coverage(r):
        company = r["report"]["company"]
        profile = company["registry_profile"]
        website = company.get("website")
        return (bool(website and public_url(website)),
                sum(profile.get(key) is not None for key in ("employees", "revenue_eur", "accounts_year")),
                r.get("priority") or 0)
    return sorted(candidates, key=coverage, reverse=True)[:limit]


def diagnostics_wrap(trace, function, *args):
    """Worker threads don't inherit the job's trace id; restore it for log correlation."""
    token = diagnostics.set_trace(trace)
    try:
        return function(*args)
    finally:
        diagnostics.reset_trace(token)


def persist_result(job_id, company, report, model, framework, country, industry, registry=None, sector=None, save=True):
    result = assess(report, model, country, industry, framework=framework,
                    registry_signals=registry.signals if registry else None, sector=sector)
    website = next((url for url in (report.website, company.website) if url and public_url(url)), None)
    identity = json.dumps([company.name, company.website, country, industry], ensure_ascii=False)
    report_id = hashlib.sha256(identity.encode()).hexdigest()[:24]
    structured = dict(model) if model else dict(status="insufficient_data" if len(report.structured_facts) < 2 else "unavailable",
                                               probability=None, percentile=None, coverage=0, metadata={})
    inputs = structured_model.inputs_for(report, industry)
    structured["inputs"] = {**{field: None for field in sorted(structured_model.FIELDS)}, **inputs}
    structured["observed_coverage"] = len(structured_model.FIELDS.intersection(inputs)) / 11
    structured["synthetic_training"] = model["metadata"]["syntheticTraining"] if model else None
    structured["label"] = "synthetic / demonstration model" if result["structured"]["synthetic"] else "Structured acquisition propensity"
    artifact = CompanyReport(report_id=report_id, research_mode=report.research_mode,
        verification_complete=report.verification_complete, verification_method=report.verification_method,
        company=dict(name=company.name, country=country, industry=industry, website=website,
                     registry_id=company.registry_id, discovery_source=company.source,
                     registry_profile=registry_profile(registry) if registry else None),
        market_context=framework, signals=report.signal_evidence,
        contradictions=[c for c, e in zip(report.signal_evidence, result["evidence"]) if e["status"] == "Conflicting"],
        structured_facts=report.structured_facts, conflicting_structured_facts=report.conflicting_structured_facts,
        structured_model=structured, priority_score=result["priority"], confidence=result["confidence"],
        score_breakdown=result["score_breakdown"], why_now=result["why_now"], transaction_hypothesis=result["conversation"],
        sources=sorted(set(report.retrieved_source_urls) | set(framework.retrieved_source_urls) | ({company.source} if company.source else set())),
        data_gaps=report.data_gaps, warnings=result["warnings"], generated_at=datetime.now(timezone.utc).isoformat(),
        research_summary=report.summary, business_findings=report.business_findings,
        contact_routes=report.contact_routes, mna_assessment=build_mna_assessment(report, result["evidence"]))
    result["report"] = artifact.model_dump()
    if save:
        storage.save_final_report(job_id, result["report"])
    return result


def registry_profile(company):
    """Company-level registry data for the report. Officer birth years are reduced to the owner-age proxy."""
    return dict(registry=company.registry, registry_id=company.registry_id, source_url=company.source_url,
                activity_code=company.activity_code, founded=company.founded, employees=company.employees,
                employees_note=company.employees_note, revenue_eur=company.revenue_eur, accounts_year=company.accounts_year,
                revenue_growth=company.revenue_growth, operating_margin=company.operating_margin, net_margin=company.net_margin,
                leverage=company.leverage, auditor=company.auditor, owner_age_proxy=company.owner_age,
                family_indicator=company.family_indicator, signals=[s.model_dump() for s in company.signals],
                notes=company.notes, fetched_at=company.fetched_at)
