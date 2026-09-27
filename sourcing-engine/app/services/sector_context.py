"""Country x sector ageing indices from the Eurostat Labour Force Survey (free, no key).

- Owner ageing: share of self-employed aged 50+ in the sector vs. all sectors in the
  country (lfsa_esgan2). An older owner base means more retirement-driven transfers.
- Workforce ageing: share of employed people aged 50+ in the sector vs. all sectors
  (lfsa_egan2). Company-level employee ages are not published anywhere lawful; this is
  the reliable sector-level substitute and is weighted lower than owner ageing.
"""
from __future__ import annotations

from typing import Optional

from app.config import get_logger
from app.services.registries.http import RegistryUnavailable, get_json
from app.services.registries.industries import NACE_SECTION, key

logger = get_logger(__name__)
EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
GEO = {"finland": "FI", "sweden": "SE", "germany": "DE", "denmark": "DK", "norway": "NO", "iceland": "IS", "france": "FR",
       "netherlands": "NL", "austria": "AT", "belgium": "BE", "switzerland": "CH", "spain": "ES", "italy": "IT"}


def _share_50_plus(dataset: str, geo: str, nace: str, extra: dict) -> Optional[tuple[float, str]]:
    """Share aged 50+ and the reference year, from the latest year with both values published."""
    data = get_json(EUROSTAT + dataset, {"geo": geo, "nace_r2": nace, "sex": "T", "unit": "THS_PER", "age": ["Y_GE50", "Y_GE15"],
                                         "lastTimePeriod": 3, **extra}, cache_hours=24 * 30, min_interval=0.3, not_found={})
    if not data or "value" not in data:
        return None
    # JSON-stat: flat index = sum(position_in_dimension * stride), strides from the declared dimension order.
    ids, sizes = data["id"], data["size"]
    strides = [1] * len(ids)
    for i in range(len(ids) - 2, -1, -1):
        strides[i] = strides[i + 1] * sizes[i + 1]

    def value(age: str, time: str):
        flat = 0
        for dim, stride in zip(ids, strides):
            index = data["dimension"][dim]["category"]["index"]
            position = index[age] if dim == "age" else index[time] if dim == "time" else 0
            flat += position * stride
        return data["value"].get(str(flat))

    for year in sorted(data["dimension"]["time"]["category"]["index"], reverse=True):
        old, everyone = value("Y_GE50", year), value("Y_GE15", year)
        if old is not None and everyone:
            return old / everyone, year
    return None


def get(country: str, industry: str) -> dict:
    """Returns {available, owner_ratio, workforce_ratio, ...}. Never raises."""
    geo, sector = GEO.get(country.strip().casefold()), NACE_SECTION.get(key(industry) or "")
    context = dict(available=False, country=country, industry=industry, nace_section=sector, owner_ratio=None, workforce_ratio=None,
                   owner_share=None, workforce_share=None, year=None, source="Eurostat Labour Force Survey (lfsa_esgan2, lfsa_egan2)",
                   source_url="https://ec.europa.eu/eurostat/databrowser/view/lfsa_esgan2/default/table")
    if not geo or not sector:
        return context
    try:
        owner = _share_50_plus("lfsa_esgan2", geo, sector, {"wstatus": "SELF"})
        owner_all = _share_50_plus("lfsa_esgan2", geo, "TOTAL", {"wstatus": "SELF"})
        work = _share_50_plus("lfsa_egan2", geo, sector, {})
        work_all = _share_50_plus("lfsa_egan2", geo, "TOTAL", {})
    except (RegistryUnavailable, KeyError, TypeError, ValueError) as exc:
        logger.warning("eurostat unavailable country=%s sector=%s error=%s", country, sector, exc)
        return context
    if owner and owner_all:
        context.update(owner_share=owner[0], owner_ratio=owner[0] / owner_all[0], year=owner[1])
    if work and work_all:
        context.update(workforce_share=work[0], workforce_ratio=work[0] / work_all[0], year=context["year"] or work[1])
    context["available"] = context["owner_ratio"] is not None or context["workforce_ratio"] is not None
    return context
