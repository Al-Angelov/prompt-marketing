"""Free official business registries: fast, deterministic company data without LLM calls.

Each country adapter returns RegistryCompany records. Facts carry the registry page as
their source and the filing/fetch date as `as_of`, so they flow into the Java model as
sourced, dated inputs exactly like researched facts. Personal data is minimised: only
birth *years* of registered officers are kept (for the owner-age proxy), never names.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Callable, List, Optional

from pydantic import BaseModel, Field

from app.models.schemas import StructuredFact

# Big-4 auditors; a small company appointing one is a (weak) due-diligence preparation signal.
BIG4 = ("pricewaterhousecoopers", "pwc", "kpmg", "ernst & young", "ernst &young", " ey ", "deloitte")
MAX_MODEL_LEVERAGE = 1.0
OWNER_ROLES = ("ceo", "chair", "president", "managing director", "managing partner")


class Officer(BaseModel):
    role: str
    birth_year: Optional[int] = None


class RegistrySignal(BaseModel):
    """A dated, official-record event. Scored by assessment.py, never by the registry adapter."""
    kind: str                       # leadership | liquidity | preparation
    label: str
    detail: str
    likelihood_ratio: float = Field(gt=0)
    quality: float = Field(ge=0, le=1)
    date: Optional[str] = None
    source: str


class RegistryCompany(BaseModel):
    registry: str
    registry_id: str
    name: str
    country: str
    industry: str
    activity_code: Optional[str] = None
    website: Optional[str] = None
    source_url: str
    founded: Optional[str] = None
    employees: Optional[float] = None
    employees_note: str = "Registered headcount"
    revenue_eur: Optional[float] = None
    accounts_year: Optional[int] = None
    revenue_growth: Optional[float] = None
    growth_note: str = ""
    operating_margin: Optional[float] = None
    net_margin: Optional[float] = None
    leverage: Optional[float] = None
    officers: List[Officer] = Field(default_factory=list)
    family_indicator: bool = False
    auditor: Optional[str] = None
    signals: List[RegistrySignal] = Field(default_factory=list)
    notes: List[str] = Field(default_factory=list)
    fetched_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    @property
    def owner_age(self) -> Optional[int]:
        years = [o.birth_year for o in self.officers if o.birth_year and any(r in o.role.lower() for r in OWNER_ROLES)]
        return date.today().year - min(years) if years and 18 <= date.today().year - min(years) <= 100 else None

    def structured_facts(self) -> List[StructuredFact]:
        today = date.today().isoformat()
        accounts = f"{self.accounts_year}-12-31" if self.accounts_year else None
        registry = f"Official registry ({self.registry})"
        candidates = [
            ("foundedYear", int(self.founded[:4]) if self.founded else None, self.founded, f"{registry}: registration/founding date"),
            ("employees", self.employees, today, f"{registry}: {self.employees_note}"),
            ("revenueK", self.revenue_eur / 1000 if self.revenue_eur and self.revenue_eur > 0 else None, accounts, f"{registry}: filed annual accounts, EUR thousands"),
            # Above 1 (negative equity) is outside the model's training range: shown in the profile, not scored.
            ("leverage", self.leverage if self.leverage is not None and self.leverage <= MAX_MODEL_LEVERAGE else None, accounts,
             f"{registry}: total liabilities / total assets from filed accounts (proxy for debt/assets)"),
            ("revenueGrowth3y", self.revenue_growth, accounts, f"{registry}: {self.growth_note or 'revenue CAGR from filed accounts'}"),
            ("ownerAge", self.owner_age, today, f"{registry}: age of the oldest registered CEO/chair/president (birth year only); proxy for the controlling owner"),
            ("familyOwned", True if self.family_indicator else None, today, f"{registry}: two or more registered officers share a surname (family-control indicator)"),
        ]
        facts = []
        for field, value, as_of, provenance in candidates:
            if value is None or not as_of or as_of > today:
                continue
            fact = StructuredFact(field=field, value=value, provenance=provenance, as_of=as_of, sources=[self.source_url])
            if fact.value is not None:
                facts.append(fact)
        return facts


def distress_note(leverage: Optional[float]) -> Optional[str]:
    if leverage is not None and leverage > MAX_MODEL_LEVERAGE:
        return (f"Liabilities exceed assets (liabilities/assets {leverage:.2f}): possible financial distress. Leverage is left out of the "
                "score because the model does not cover negative equity; a distressed sale differs from a succession sale.")
    return None


def is_big4(name: Optional[str]) -> bool:
    return bool(name) and any(b in f" {name.lower()} " for b in BIG4)


def shared_surname(surnames: List[str]) -> bool:
    cleaned = [s.strip().casefold() for s in surnames if s and len(s.strip()) > 1]
    return len(cleaned) != len(set(cleaned))


Adapter = Callable[..., List[RegistryCompany]]


def adapter_for(country: str):
    from app.services.registries import finland, france, norway
    return {"norway": norway, "france": france, "finland": finland}.get(country.strip().casefold())


def supported(country: str) -> bool:
    return adapter_for(country) is not None
