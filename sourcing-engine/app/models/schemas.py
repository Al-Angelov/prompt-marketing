"""Pydantic v2 schemas for the Mergero Regional M&A Sourcing Engine.

These mirror the target output contracts described in the prompt kit:
- Phase 1: regional sell-signal checklist
- Phase 2: per-company evidence gathered against that checklist

The models are also used to constrain / validate the JSON returned by OpenAI.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
import math

SignalCategory = Literal[
    "ownership_succession",
    "economic_market",
    "regulatory_tax",
    "cultural",
    "public_observable",
]
SignalStrength = Literal["strong", "medium", "weak"]
Confidence = Literal["high", "medium", "low"]


def _now_iso() -> str:
    """Return the current UTC timestamp as an ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------- #
# Phase 1 — Regional Sell-Signal Schema
# --------------------------------------------------------------------------- #
class SignalItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., description="Short slug identifying the signal.")
    name: str
    category: SignalCategory
    why_it_matters_in_region: str
    how_to_detect: str
    data_sources: List[str] = Field(default_factory=list)
    signal_strength: SignalStrength
    applies_to: List[str] = Field(
        default_factory=list,
        description="Countries / sub-regions this signal holds for.",
    )

    @field_validator("applies_to", mode="before")
    @classmethod
    def normalize_single_country(cls, value):
        # A single named country has the same meaning as a one-item list.
        # Do not split arbitrary prose or relax validation of other shapes.
        return [value.strip()] if isinstance(value, str) and value.strip() else value


class ResearchProvenance(BaseModel):
    schema_version: Literal[2] = 2
    cache_hit: bool = False
    research_mode: Literal["web_search", "ungrounded_demo", "unknown"] = "unknown"
    retrieved_source_urls: List[str] = Field(default_factory=list)


class Phase1Output(ResearchProvenance):
    model_config = ConfigDict(extra="ignore")

    region: str
    sub_regions_covered: List[str] = Field(default_factory=list)
    generated_at: str = Field(default_factory=_now_iso, description="ISO-8601 timestamp.")
    signals: List[SignalItem] = Field(default_factory=list)
    summary: str = ""


# --------------------------------------------------------------------------- #
# Phase 2 — Company Evidence Schema
# --------------------------------------------------------------------------- #
class Citation(BaseModel):
    url: str
    title: str = "Public source"
    published_at: Optional[str] = None
    excerpt: str
    stance: Literal["supports", "contradicts", "context"] = "context"
    origin_group: str = "unknown"
    independent: bool = False
    independence_basis: str = ""


class StructuredFact(BaseModel):
    field: Literal["foundedYear", "revenueK", "employees", "ebitdaMargin", "leverage", "revenueGrowth3y", "maxDirectorTenure", "ownerAge", "familyOwned", "shareholders", "sectorDeals24m"]
    value: float | bool | None = None
    as_of: Optional[str] = None
    sources: List[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_value(self):
        bounds = {"foundedYear": (1000, datetime.now().year), "revenueK": (1e-12, 1e12), "employees": (0, 1e8),
                  "ebitdaMargin": (-100, 100), "leverage": (0, 100), "revenueGrowth3y": (-1, 100),
                  "maxDirectorTenure": (0, 150), "ownerAge": (18, 120), "shareholders": (1, 1e7), "sectorDeals24m": (0, 1e6)}
        if self.value is not None:
            if self.field == "familyOwned":
                if not isinstance(self.value, bool):
                    self.value = None
            elif isinstance(self.value, bool) or not math.isfinite(self.value) or not bounds[self.field][0] <= self.value <= bounds[self.field][1]:
                self.value = None
            elif self.field in ("foundedYear", "shareholders") and not float(self.value).is_integer():
                self.value = None
        return self


class SignalEvidenceItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    signal_id: str = Field(..., description="Matches a Phase 1 signal id.")
    signal_name: str
    evidence_found: Optional[str] = Field(
        default=None, description="Evidence text, or null if nothing public was found."
    )
    sources: List[str] = Field(
        default_factory=list, description="Source URLs backing the evidence."
    )
    confidence: Confidence
    notes: Optional[str] = None
    verification_status: Literal["verified", "partially_verified", "conflicting", "unverified", "insufficient_evidence"] = "unverified"
    kind: Literal["leadership", "operational", "growth", "liquidity", "partnership", "explicit_exit", "structured_context", "context"] = "context"
    direction: Literal["positive", "negative", "neutral"] = "neutral"
    citations: List[Citation] = Field(default_factory=list)
    verification_note: str = "Independent corroboration not yet performed."


class VerificationCheck(BaseModel):
    signal_id: str
    citations: List[Citation] = Field(default_factory=list)
    explanation: str


class VerificationOutput(ResearchProvenance):
    company_name: str
    region: str
    checks: List[VerificationCheck] = Field(default_factory=list)


class Phase2Output(ResearchProvenance):
    model_config = ConfigDict(extra="ignore")

    company_name: str
    region: str
    website: Optional[str] = None
    researched_at: str = Field(default_factory=_now_iso, description="ISO-8601 timestamp.")
    summary: str = Field(default="", description="3-5 sentence human-readable summary.")
    signal_evidence: List[SignalEvidenceItem] = Field(default_factory=list)
    data_gaps: List[str] = Field(
        default_factory=list,
        description="Signal ids with no public evidence found.",
    )
    structured_facts: List[StructuredFact] = Field(default_factory=list)
    verification_complete: bool = False
    verification_method: str = "Not performed"
    warnings: List[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Phase 0 — Company universe sourcing
# --------------------------------------------------------------------------- #
class CandidateCompany(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    website: Optional[str] = None
    country: Optional[str] = None
    registry_id: Optional[str] = None
    source: Optional[str] = Field(
        default=None, description="Where this company was found."
    )


class CompanyUniverseOutput(ResearchProvenance):
    model_config = ConfigDict(extra="ignore")

    region: str
    criteria: str
    generated_at: str = Field(default_factory=_now_iso)
    companies: List[CandidateCompany] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# API request bodies
# --------------------------------------------------------------------------- #
class RegionResearchRequest(BaseModel):
    region: str = Field(..., min_length=2, max_length=100, examples=["Nordic"])
    industry_focus: Optional[str] = Field(default=None, examples=["Industrial Services"])


class CompanyResearchRequest(BaseModel):
    company_name: str = Field(..., min_length=2, max_length=200, examples=["Target Co"])
    company_website: Optional[str] = Field(default=None, max_length=500, examples=["https://example.com"])
    region: str = Field(..., min_length=2, max_length=100, examples=["Nordic"])


class UniverseSourcingRequest(BaseModel):
    region: str = Field(..., min_length=2, max_length=100, examples=["DACH"])
    criteria: str = Field(..., min_length=3, max_length=2000, examples=["SME software companies revenue €5M-€50M"])
    max_companies: int = Field(default=5, ge=1, le=10, examples=[5])


class MarketRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    country: str = Field(min_length=2, max_length=100)
    industry: str = Field(min_length=2, max_length=200)
