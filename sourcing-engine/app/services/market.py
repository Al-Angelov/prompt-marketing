"""One bounded market workflow, with real progress and duplicate-start protection.
Jobs run outside the request lifetime so hosted gateway time limits do not cut off
multi-company research. Existing per-region and per-company caches are reused.
"""
from concurrent.futures import ThreadPoolExecutor
from threading import RLock
from time import time
from uuid import uuid4
from copy import deepcopy
from app.config import get_settings, get_logger
from app.services import research_service, structured_model
from app.services.assessment import assess

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
        if not settings.openai_api_key or not settings.enable_web_search:
            raise ValueError("Research is temporarily unavailable. Please try again later.")
        if sum(j["status"] == "running" for j in _jobs.values()) >= 3:
            raise ValueError("Research is busy right now. Please try again shortly.")
        job_id = uuid4().hex
        _jobs[job_id] = dict(id=job_id, country=country, industry=industry, status="running", stages=["pending"]*6,
                             results=[], warnings=[], error=None, _key=key, _created=time())
        _worker.submit(run, job_id, country, industry)
        return snapshot(job_id)


def run(job_id, country, industry):
    try:
        update(job_id, stages=["running", "pending", "pending", "pending", "pending", "pending"])
        framework = research_service.cached_region(country, industry)
        update(job_id, stages=["complete", "running", "pending", "pending", "pending", "pending"])
        candidates = research_service.cached_universe(country, f"Privately held companies in {industry} in {country}. Prioritize clearly documented public business activity; return at most three well-sourced candidates.", 3)
        update(job_id, stages=["complete", "complete", "running", "running", "pending", "pending"])
        reports, warnings = [], []
        for company in candidates.companies:
            # A mismatched market is not silently relabeled to the user's country.
            if company.country and company.country.casefold().strip() != country.casefold():
                warnings.append(f"A candidate outside {country} was excluded.")
                continue
            try:
                report = research_service.investigate_company(company.name, company.website, country, industry_focus=industry, framework=framework)
                labels = {signal.id: signal.name for signal in framework.signals}
                report.data_gaps = ["No supporting public evidence: " + labels[gap] if gap in labels else gap for gap in report.data_gaps]
                reports.append(report)
            except research_service.ResearchError:
                warnings.append(f"Research for {company.name} could not be completed.")
        if candidates.companies and not reports:
            raise ValueError("We couldn't verify the companies found. Please try again later or choose another market.")
        update(job_id, stages=["complete", "complete", "complete", "complete", "running", "pending"])
        scored = [(report, structured_model.score(report, industry)) for report in reports]
        update(job_id, stages=["complete"]*5 + ["running"])
        results = [assess(report, model, country, industry) for report, model in scored]
        results.sort(key=lambda r: (r["priority"] is not None, r["priority"] or 0), reverse=True)
        update(job_id, status="complete", stages=["complete"]*6, results=results, warnings=warnings)
    except Exception as exc:
        logger.warning("Market investigation failed: %s", type(exc).__name__)
        update(job_id, status="error", error="We couldn't complete this research. Please try again later.")
