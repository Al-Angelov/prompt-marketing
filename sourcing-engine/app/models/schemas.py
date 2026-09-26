"""Pydantic v2 schemas for the Mergero Regional M&A Sourcing Engine.

These mirror the target output contracts described in the prompt kit:
- Phase 1: regional sell-signal checklist
- Phase 2: per-company evidence gathered against that checklist

The models are also used to constrain / validate the JSON returned by OpenAI.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

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


class ResearchProvenance(BaseModel):
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
    verification_status: Literal["unverified", "insufficient_evidence"] = "unverified"


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
    region: str = Field(..., examples=["Nordic"])
    industry_focus: Optional[str] = Field(default=None, examples=["Industrial Services"])


class CompanyResearchRequest(BaseModel):
    company_name: str = Field(..., examples=["Target Co"])
    company_website: Optional[str] = Field(default=None, examples=["https://example.com"])
    region: str = Field(..., examples=["Nordic"])


class UniverseSourcingRequest(BaseModel):
    region: str = Field(..., examples=["DACH"])
    criteria: str = Field(..., examples=["SME software companies revenue €5M-€50M"])
    max_companies: int = Field(default=15, ge=1, le=100, examples=[10])
