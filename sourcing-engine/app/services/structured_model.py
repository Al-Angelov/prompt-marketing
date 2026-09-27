"""Server-side client for the existing Java API; no training or invented facts."""
import json
import math
from datetime import date
from urllib.request import Request, urlopen
from app.config import get_settings, get_logger

logger = get_logger(__name__)

FIELDS = {"foundedYear", "revenueK", "employees", "ebitdaMargin", "leverage", "revenueGrowth3y", "maxDirectorTenure", "ownerAge", "familyOwned", "shareholders", "sectorDeals24m"}


def inputs_for(report, industry):
    inputs = {"id": report.company_name[:200], "year": date.today().year + 1, "sector": industry}
    for fact in report.structured_facts:
        if fact.field in FIELDS and fact.value is not None and fact.sources and fact.as_of and fact.as_of <= date.today().isoformat():
            inputs[fact.field] = fact.value
    return inputs


def score(report, industry):
    inputs = inputs_for(report, industry)
    supplied = FIELDS.intersection(inputs)
    if len(supplied) < 2:
        logger.info("java model skipped company=%s supplied_fields=%d (need 2)", report.company_name, len(supplied))
        return None
    settings = get_settings()
    headers = {"Content-Type": "application/json"}
    if settings.model_api_token:
        headers["Authorization"] = "Bearer " + settings.model_api_token
    try:
        request = Request(settings.model_api_url.rstrip("/") + "/api/score", data=json.dumps(inputs).encode(), headers=headers, method="POST")
        with urlopen(request, timeout=75) as response:
            result = json.load(response)
        valid = (result["schemaVersion"] == 1 and result["companyId"] == inputs["id"] and result["year"] == inputs["year"]
                 and result["status"] in ("scored", "insufficient_data") and set(result["suppliedFields"]) == supplied
                 and set(result["missingFields"]) == FIELDS - supplied and math.isclose(result["coverage"], len(supplied)/11)
                 and isinstance(result["metadata"]["syntheticTraining"], bool))
        if result["status"] == "scored":
            valid = valid and 0 <= result["probability"] <= 1 and 0 <= result["percentile"] <= 100
        else:
            valid = valid and result["probability"] is None and result["percentile"] is None
        if not valid:
            logger.error("java model returned an invalid response company=%s status=%s", report.company_name, result.get("status"))
            return None
        logger.info("java model scored company=%s status=%s percentile=%s", report.company_name, result["status"], result.get("percentile"))
        return result
    except (OSError, ValueError, KeyError, TypeError) as exc:
        logger.error("java model call failed company=%s url=%s error=%s: %s", report.company_name, settings.model_api_url, type(exc).__name__, exc)
        return None
