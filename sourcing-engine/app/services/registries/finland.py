"""Finland: PRH open data (YTJ API v3), keyless, CC BY 4.0.

Open data gives registration date, TOL 2008 industry, status and form. Headcount,
officers and most financials are not open in Finland, so Finnish companies rely more
on sector context and on the deep web research step.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional

from app.config import get_logger
from app.services.registries import RegistryCompany
from app.services.registries.http import RegistryUnavailable, get_json
from app.services.registries.industries import NAF_CODES, evenly_spaced, key

logger = get_logger(__name__)
BASE = "https://avoindata.prh.fi/opendata-ytj-api/v3/companies"
LIMITED_COMPANY = "16"   # osakeyhtiö


def page_url(business_id: str) -> str:
    return f"https://tietopalvelu.ytj.fi/yritys/{business_id}"


def search(industry: str, limit: int) -> List[RegistryCompany]:
    # PRH matches mainBusinessLine as a substring ("62" also hits 46462), so query exact
    # 4-digit NACE classes and keep only records whose code really starts with the class.
    classes = sorted({code[:5].replace(".", "") for code in NAF_CODES.get(key(industry) or "", [])})
    classes = [classes[i] for i in evenly_spaced(len(classes), 6)]
    if not classes:
        return []
    per_class = max(1, -(-limit // len(classes)))
    with ThreadPoolExecutor(max_workers=len(classes)) as pool:
        batches = list(pool.map(lambda c: _search_class(c, industry, per_class), classes))
    found = {}
    for batch in batches:
        for company in batch:
            found.setdefault(company.registry_id, company)
    return list(found.values())[:limit]


def _search_class(nace_class: str, industry: str, wanted: int) -> List[RegistryCompany]:
    params = {"mainBusinessLine": nace_class, "companyForm": LIMITED_COMPANY}
    try:
        first = get_json(BASE, {**params, "page": 1}, cache_hours=24)
        pages = evenly_spaced(-(-int(first.get("totalResults") or 0) // 100), 2)
        batches = [first] + [get_json(BASE, {**params, "page": p + 1}, cache_hours=24) for p in pages if p != 0]
    except (RegistryUnavailable, ValueError) as exc:
        logger.warning("prh search failed class=%s error=%s", nace_class, exc)
        return []
    candidates = [c for batch in batches for c in (_from_record(r, industry) for r in batch.get("companies", []))
                  if c and (c.activity_code or "").startswith(nace_class)]
    step = max(1, len(candidates) // wanted)
    return candidates[::step][:wanted]


def _from_record(record: dict, industry: str) -> Optional[RegistryCompany]:
    business_id = (record.get("businessId") or {}).get("value")
    if not business_id or record.get("companySituations") or record.get("endDate"):
        return None   # liquidation, bankruptcy or restructuring, or no longer registered
    names = [n for n in record.get("names") or [] if not n.get("endDate")]
    website = (record.get("website") or {}).get("url") if isinstance(record.get("website"), dict) else None
    if website and not website.startswith(("http://", "https://")):
        website = "https://" + website
    return RegistryCompany(
        registry="Finnish Patent and Registration Office (PRH/YTJ)", registry_id=business_id,
        name=(names or record.get("names") or [{"name": business_id}])[0]["name"], country="Finland", industry=industry,
        activity_code=(record.get("mainBusinessLine") or {}).get("type"), website=website, source_url=page_url(business_id),
        founded=record.get("registrationDate"),
        notes=["Finnish open data does not include headcount, officers or accounts; deep research fills these where public."])


def enrich(company: RegistryCompany) -> RegistryCompany:
    return company
