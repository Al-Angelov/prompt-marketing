"""Server-side client for the existing Java API; no training or invented facts."""
import json
import math
from datetime import date
from urllib.request import Request, urlopen
from app.config import get_settings

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
        return result if valid else None
    except (OSError, ValueError, KeyError, TypeError):
        return None
