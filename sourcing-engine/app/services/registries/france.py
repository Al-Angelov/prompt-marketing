"""France: Annuaire des Entreprises API (INSEE SIRENE + INPI RNE) and the BODACC gazette.

The search API is keyless (etalab licence) and returns, per company: creation date,
headcount band, NAF code, directors with birth year, and revenue/net income by year.
BODACC publishes every registered change of management or capital with a date, which
gives official, dated leadership-change evidence without any web search.
"""
from __future__ import annotations

import json
from datetime import date
from typing import List, Optional

from app.config import get_logger
from app.services.registries import Officer, RegistryCompany, RegistrySignal, shared_surname
from app.services.registries.http import RegistryUnavailable, get_json
from app.services.registries.industries import NAF_CODES, evenly_spaced, key

logger = get_logger(__name__)
SEARCH = "https://recherche-entreprises.api.gouv.fr/search"
BODACC = "https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records"
# INSEE headcount bands (tranche_effectif_salarie) between 10 and 499 employees.
BANDS = {"11": (10, 19), "12": (20, 49), "21": (50, 99), "22": (100, 199), "31": (200, 249), "32": (250, 499)}
LEADERSHIP_WORDS = ("administration", "dirigeant", "gérant", "gerant", "président", "president", "direction", "directeur")


def page_url(siren: str) -> str:
    return f"https://annuaire-entreprises.data.gouv.fr/entreprise/{siren}"


def search(industry: str, limit: int) -> List[RegistryCompany]:
    codes = NAF_CODES.get(key(industry) or "", [])
    if not codes:
        return []
    params = dict(activite_principale=",".join(codes), tranche_effectif_salarie="11,12,21,22,31", etat_administratif="A",
                  categorie_entreprise="PME", per_page=25)
    try:
        first = get_json(SEARCH, {**params, "page": 1}, cache_hours=24, min_interval=0.2)
        pages = evenly_spaced(first.get("total_pages", 0), max(1, -(-limit // 25)))
        batches = [first] + [get_json(SEARCH, {**params, "page": p + 1}, cache_hours=24, min_interval=0.2) for p in pages if p != 0]
    except RegistryUnavailable as exc:
        logger.warning("recherche-entreprises search failed error=%s", exc)
        return []
    found = {}
    for batch in batches:
        for result in batch.get("results", []):
            company = _from_result(result, industry)
            if company and company.registry_id not in found:
                found[company.registry_id] = company
    return _spread(list(found.values()), limit)


def _spread(companies: List[RegistryCompany], limit: int) -> List[RegistryCompany]:
    step = max(1, len(companies) // max(1, limit))
    return companies[::step][:limit]


def _from_result(r: dict, industry: str) -> Optional[RegistryCompany]:
    siren = r.get("siren")
    if not siren:
        return None
    band = BANDS.get(str(r.get("tranche_effectif_salarie") or ""))
    company = RegistryCompany(
        registry="Annuaire des Entreprises (INSEE/INPI), France", registry_id=siren, name=r.get("nom_complet") or siren,
        country="France", industry=industry, activity_code=r.get("activite_principale"), source_url=page_url(siren),
        founded=r.get("date_creation"), employees=(band[0] + band[1]) / 2 if band else None,
        employees_note=f"INSEE headcount band {band[0]}-{band[1]} (midpoint)" if band else "Registered headcount")
    people = [d for d in r.get("dirigeants") or [] if d.get("type_dirigeant") == "personne physique"]
    for person in people:
        born = str(person.get("annee_de_naissance") or "")
        company.officers.append(Officer(role=_role(person.get("qualite") or ""), birth_year=int(born) if born.isdigit() else None))
    unique = {(p.get("nom"), p.get("prenoms"), p.get("annee_de_naissance")): p.get("nom") or "" for p in people}
    company.family_indicator = shared_surname(list(unique.values()))
    _apply_finances(company, r.get("finances") or {})
    return company


def _role(qualite: str) -> str:
    q = qualite.lower()
    if "président" in q or "president" in q:
        return "President" if "conseil" not in q else "Chair of the board"
    if "directeur général" in q or "directeur general" in q:
        return "CEO"
    if "gérant" in q or "gerant" in q:
        return "Managing director"
    return qualite or "Officer"


def _apply_finances(company: RegistryCompany, finances: dict) -> None:
    years = sorted((int(y), v) for y, v in finances.items() if str(y).isdigit() and isinstance(v, dict) and (v.get("ca") or 0) > 0)
    if not years:
        return
    latest_year, latest = years[-1]
    company.accounts_year, company.revenue_eur = latest_year, float(latest["ca"])
    if isinstance(latest.get("resultat_net"), (int, float)):
        company.net_margin = latest["resultat_net"] / latest["ca"]
    earlier = [(y, v) for y, v in years if 2 <= latest_year - y <= 4]
    if earlier:
        first_year, first = earlier[-1]
        span = latest_year - first_year
        company.revenue_growth = (latest["ca"] / first["ca"]) ** (1 / span) - 1
        company.growth_note = f"revenue CAGR {first_year}-{latest_year} from filed accounts"


def enrich(company: RegistryCompany) -> RegistryCompany:
    """Adds dated BODACC management and capital changes from the last three years."""
    since = date(date.today().year - 3, date.today().month, 1).isoformat()
    try:
        data = get_json(BODACC, {"where": f'registre like "{company.registry_id}" and dateparution >= date\'{since}\'',
                                 "select": "id,dateparution,familleavis_lib,modificationsgenerales,url_complete",
                                 "order_by": "dateparution desc", "limit": 20}, cache_hours=72, min_interval=0.2) or {}
    except RegistryUnavailable as exc:
        company.notes.append(f"Official gazette (BODACC) unavailable right now ({exc}).")
        return company
    leadership = capital = None
    for record in data.get("results", []):
        try:
            text = (json.loads(record.get("modificationsgenerales") or "{}").get("descriptif") or "").lower()
        except ValueError:
            text = ""
        if record.get("familleavis_lib") != "Modifications diverses" or not text:
            continue
        if leadership is None and any(w in text for w in LEADERSHIP_WORDS):
            leadership = record
        elif capital is None and "capital" in text:
            capital = record
    if leadership:
        company.signals.append(RegistrySignal(kind="leadership", label="Management change filed in the official gazette",
            detail=f"BODACC published a change to the company's management on {leadership['dateparution']}.",
            likelihood_ratio=1.35, quality=0.9, date=leadership["dateparution"], source=leadership.get("url_complete") or company.source_url))
    if capital:
        company.signals.append(RegistrySignal(kind="liquidity", label="Share-capital change filed in the official gazette",
            detail=f"BODACC published a share-capital change on {capital['dateparution']}.",
            likelihood_ratio=1.15, quality=0.9, date=capital["dateparution"], source=capital.get("url_complete") or company.source_url))
    return company
