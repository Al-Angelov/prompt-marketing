"""Brønnøysund Register Centre (data.brreg.no): open, keyless, NLOD licence.

Entity register: headcount, founding date, SN2007 code, website.
Roles: CEO/board with birth dates (only the year is kept) and the auditor.
Accounts register: latest filed income statement and balance sheet.
"""
from __future__ import annotations

from typing import List, Optional

from app.config import get_logger
from app.services.registries import Officer, RegistryCompany, RegistrySignal, distress_note, is_big4, shared_surname
from app.services.registries.http import RegistryUnavailable, get_json
from app.services.registries.industries import NACE_PREFIXES, evenly_spaced, key

logger = get_logger(__name__)
BASE = "https://data.brreg.no"
NOK_PER_EUR = 11.7   # approximate 2024-2025 average; revenue is shown in EUR for model comparability
ROLE_NAMES = {"DAGL": "CEO", "LEDE": "Chair of the board", "NEST": "Deputy chair", "MEDL": "Board member", "KONT": "Contact person"}


def page_url(orgnr: str) -> str:
    return f"https://virksomhet.brreg.no/nb/oppslag/enheter/{orgnr}"


def search(industry: str, limit: int) -> List[RegistryCompany]:
    prefixes = NACE_PREFIXES.get(key(industry) or "", [])
    if not prefixes:
        return []
    base = dict(fraAntallAnsatte=10, tilAntallAnsatte=250, organisasjonsform="AS", konkurs="false", underAvvikling="false",
                underTvangsavviklingEllerTvangsopplosning="false")
    size, found = 20, {}
    per_prefix = max(1, -(-limit // len(prefixes)))
    for prefix in prefixes:
        params = {**base, "naeringskode": prefix, "size": size}
        try:
            first = get_json(BASE + "/enhetsregisteret/api/enheter", {**params, "page": 0}, cache_hours=24)
            # Several pages spread across the (alphabetical) result set, then an even sample.
            pages = evenly_spaced(first["page"]["totalPages"], max(2, -(-2 * per_prefix // size)))
            batches = [first] + [get_json(BASE + "/enhetsregisteret/api/enheter", {**params, "page": p}, cache_hours=24)
                                 for p in pages if p != 0]
        except (RegistryUnavailable, KeyError, TypeError) as exc:
            logger.warning("brreg search failed prefix=%s error=%s", prefix, exc)
            continue
        candidates = [c for batch in batches for c in (_from_entity(e, industry) for e in (batch.get("_embedded") or {}).get("enheter", [])) if c]
        step = max(1, len(candidates) // per_prefix)
        for company in candidates[::step][:per_prefix]:
            found.setdefault(company.registry_id, company)
    return list(found.values())[:limit]


def _from_entity(entity: dict, industry: str) -> Optional[RegistryCompany]:
    orgnr = entity.get("organisasjonsnummer")
    if not orgnr or entity.get("konkurs") or entity.get("underAvvikling"):
        return None
    website = entity.get("hjemmeside")
    if website and not website.startswith(("http://", "https://")):
        website = "https://" + website
    return RegistryCompany(
        registry="Brønnøysund Register Centre, Norway", registry_id=orgnr, name=entity.get("navn", orgnr), country="Norway",
        industry=industry, activity_code=(entity.get("naeringskode1") or {}).get("kode"), website=website, source_url=page_url(orgnr),
        founded=entity.get("stiftelsesdato") or entity.get("registreringsdatoEnhetsregisteret"),
        employees=entity.get("antallAnsatte"), employees_note="Registered employee count (NAV Aa-register)")


def enrich(company: RegistryCompany) -> RegistryCompany:
    orgnr = company.registry_id
    try:
        roles = get_json(f"{BASE}/enhetsregisteret/api/enheter/{orgnr}/roller", cache_hours=72, not_found={}) or {}
        people = {}   # one entry per person, however many roles they hold
        for group in roles.get("rollegrupper", []):
            for role in group.get("roller", []):
                if role.get("fratraadt") or role.get("avregistrert"):
                    continue
                code = (role.get("type") or {}).get("kode")
                person = role.get("person") or {}
                if code == "REVI":
                    company.auditor = _name((role.get("enhet") or {}).get("navn"))
                elif code in ROLE_NAMES and person:
                    name = person.get("navn") or {}
                    identity = (name.get("fornavn"), name.get("etternavn"), person.get("fodselsdato"))
                    born = person.get("fodselsdato") or ""
                    company.officers.append(Officer(role=ROLE_NAMES[code], birth_year=int(born[:4]) if born[:4].isdigit() else None))
                    if code != "KONT":
                        people[identity] = name.get("etternavn", "")
        surnames = list(people.values())
        company.family_indicator = shared_surname(surnames)
        if is_big4(company.auditor) and (company.employees or 0) < 100:
            company.signals.append(RegistrySignal(kind="preparation", label="Big-4 auditor at a small company",
                detail=f"Registered auditor: {company.auditor}. Small firms often appoint a Big-4 auditor ahead of external due diligence.",
                likelihood_ratio=1.15, quality=0.9, source=company.source_url))
    except RegistryUnavailable as exc:
        company.notes.append(f"Officer data unavailable right now ({exc}).")
    try:
        accounts = get_json(f"{BASE}/regnskapsregisteret/regnskap/{orgnr}", cache_hours=168, not_found=[]) or []
        if accounts:
            _apply_accounts(company, max(accounts, key=lambda a: (a.get("regnskapsperiode") or {}).get("tilDato", "")))
    except RegistryUnavailable as exc:
        company.notes.append(f"Filed accounts unavailable right now ({exc}).")
    return company


def _name(value) -> Optional[str]:
    """brreg returns organisation names as a list of lines."""
    if isinstance(value, list):
        return " ".join(str(v) for v in value if v) or None
    return value or None


def _dig(value, *path):
    for step in path:
        if not isinstance(value, dict):
            return None
        value = value.get(step)
    return value


def _apply_accounts(company: RegistryCompany, statement: dict) -> None:
    period = (statement.get("regnskapsperiode") or {}).get("tilDato") or ""
    rate = 1 / NOK_PER_EUR if (statement.get("valuta") or "NOK").upper() == "NOK" else 1.0
    result = statement.get("resultatregnskapResultat") or {}
    revenue = _dig(result, "driftsresultat", "driftsinntekter", "sumDriftsinntekter")
    ebit = _dig(result, "driftsresultat", "driftsresultat")
    balance = statement.get("egenkapitalGjeld") or {}
    assets, debt = balance.get("sumEgenkapitalGjeld"), _dig(balance, "gjeldOversikt", "sumGjeld")
    if period[:4].isdigit():
        company.accounts_year = int(period[:4])
    if isinstance(revenue, (int, float)) and revenue > 0:
        company.revenue_eur = revenue * rate
        if isinstance(ebit, (int, float)):
            company.operating_margin = ebit / revenue
    if isinstance(assets, (int, float)) and assets > 0 and isinstance(debt, (int, float)) and debt >= 0:
        company.leverage = debt / assets
        note = distress_note(company.leverage)
        if note:
            company.notes.append(note)
