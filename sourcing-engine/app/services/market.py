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
from datetime import datetime, timezone
from app.models.schemas import CompanyReport, Phase2Output
from app.config import get_settings, get_logger
from app import diagnostics
from app.services import research_service, structured_model, storage
from app.services.assessment import assess
from app.services.verification import public_url

_jobs = {}
_lock = RLock()
_worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="market")
logger = get_logger(__name__)


def snapshot(job_id):
    with _lock:
        job = _jobs.get(job_id)
        return deepcopy({k: v for k, v in job.items() if not k.startswith("_")}) if job else None


def update(job_id, **fields):
    with _lock:
        _jobs[job_id].update(fields)


def start(country, industry):
    key = (country.casefold(), industry.casefold())
    with _lock:
        for job_id in list(_jobs):
            if _jobs[job_id]["status"] in ("complete", "error") and time()-_jobs[job_id]["_created"] > 3600:
                del _jobs[job_id]
        for job in _jobs.values():
            if job["_key"] == key and job["status"] != "error":
                return snapshot(job["id"])
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
        criteria = f"Privately held companies in {industry} in {country}. Return at most {limit} well-sourced candidates. Use this market framework to guide discovery: " + json.dumps(framework.model_dump(exclude={"cache_hit", "generated_at"}), ensure_ascii=False)
        candidates = research_service.cached_universe(country, criteria, limit)
        logger.info("stage 2/6 candidates found=%d names=%s cache_hit=%s", len(candidates.companies), [c.name for c in candidates.companies], candidates.cache_hit)
        update(job_id, stages=["complete", "complete", "running", "pending", "pending", "pending"])
        reports, warnings = [], []
        for company in candidates.companies:
            # A mismatched market is not silently relabeled to the user's country.
            if not company.country or company.country.casefold().strip() != country.casefold():
                logger.warning("candidate excluded: country mismatch company=%s country=%s expected=%s", company.name, company.country, country)
                warnings.append(f"A candidate outside {country} was excluded.")
                continue
            try:
                report = research_service.investigate_company(company.name, company.website, country, industry_focus=industry, framework=framework,
                    on_verification=lambda: update(job_id, stages=["complete", "complete", "running", "running", "pending", "pending"]))
                labels = {signal.id: signal.name for signal in framework.signals}
                report.data_gaps = ["No supporting public evidence: " + labels[gap] if gap in labels else gap for gap in report.data_gaps]
                reports.append((company, report))
                logger.info("company researched company=%s evidence=%d gaps=%d verified=%s cache_hit=%s", company.name,
                            len(report.signal_evidence), len(report.data_gaps), report.verification_complete, report.cache_hit)
            except research_service.ResearchError as exc:
                logger.error("company research failed company=%s reason=%s", company.name, exc, exc_info=True)
                warnings.append(f"Research for {company.name} could not be completed.")
                failed = Phase2Output(company_name=company.name, website=company.website, region=country,
                                      data_gaps=["Company research unavailable; no evidence substituted."],
                                      warnings=["Research failed; score reflects no established evidence."])
                persist_result(job_id, company, failed, None, framework, country, industry)
        if candidates.companies and not reports:
            logger.error("no candidate could be researched; failing job candidates=%d", len(candidates.companies))
            raise ValueError("We couldn't verify the companies found. Please try again later or choose another market.")
        update(job_id, stages=["complete", "complete", "complete", "complete", "running", "pending"])
        scored = [(company, report, structured_model.score(report, industry)) for company, report in reports]
        logger.info("stage 5/6 structured model scored=%d unavailable=%d", sum(m is not None for _, _, m in scored), sum(m is None for _, _, m in scored))
        update(job_id, stages=["complete"]*5 + ["running"])
        results = [persist_result(job_id, company, report, model, framework, country, industry) for company, report, model in scored]
        results.sort(key=lambda r: (r["priority"] is not None, r["priority"] or 0), reverse=True)
        update(job_id, status="complete", stages=["complete"]*6, results=results, warnings=warnings)
        logger.info("market job complete results=%d warnings=%d duration_s=%.1f", len(results), len(warnings), time() - started)
    except Exception as exc:
        # Users get a generic message; the log keeps the real cause and traceback.
        logger.error("market job failed after %.1fs: %s: %s", time() - started, type(exc).__name__, exc, exc_info=True)
        update(job_id, status="error", error="We couldn't complete this research. Please try again later.")
    finally:
        diagnostics.reset_trace(trace)


def persist_result(job_id, company, report, model, framework, country, industry):
    result = assess(report, model, country, industry, framework=framework)
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
                     registry_id=company.registry_id, discovery_source=company.source),
        market_context=framework, signals=report.signal_evidence,
        contradictions=[c for c, e in zip(report.signal_evidence, result["evidence"]) if e["status"] == "Conflicting"],
        structured_facts=report.structured_facts, conflicting_structured_facts=report.conflicting_structured_facts,
        structured_model=structured, priority_score=result["priority"], confidence=result["confidence"],
        score_breakdown=result["score_breakdown"], why_now=result["why_now"], transaction_hypothesis=result["conversation"],
        sources=sorted(set(report.retrieved_source_urls) | set(framework.retrieved_source_urls) | ({company.source} if company.source else set())),
        data_gaps=report.data_gaps, warnings=report.warnings, generated_at=datetime.now(timezone.utc).isoformat())
    result["report"] = artifact.model_dump()
    storage.save_final_report(job_id, result["report"])
    return result
