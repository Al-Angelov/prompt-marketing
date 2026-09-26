"""Prompt templates for the Mergero Regional M&A Sourcing pipeline.

Sourced from `mergero_regional_sourcing_agent_prompts.md`. The three global
constraints are enforced in every system prompt:

  1. Public professional context only — no private personal / health / family data.
  2. No score calculation — evidence only; scoring is downstream (MGX Deal Engine).
  3. Grounding — every Phase 2 evidence item needs source URLs; otherwise it is a
     data gap with evidence_found = null.
"""

from __future__ import annotations

import json
from typing import Optional

CORE_CONSTRAINTS = """\
GLOBAL CONSTRAINTS (always apply):
1. PUBLIC PROFESSIONAL CONTEXT ONLY. Research only business/professional-context
   public information. Do NOT collect or infer an individual's private life,
   health, political views, family situation, or other sensitive personal data.
   If a signal would require that kind of inference, mark it as
   "not assessable from public professional information" rather than guessing.
2. NO SCORE CALCULATION. You NEVER calculate or output a likelihood score,
   ranking, or recommendation. You only gather and structure evidence. Scoring
   is handled downstream by the MGX Deal Engine.
3. GROUNDING & EVIDENCE. Every piece of evidence must include source URLs. If no
   public evidence exists for a signal, set evidence_found to null and record the
   signal id under data_gaps.
Return ONLY a single valid JSON object matching the requested schema. No prose
outside the JSON."""


def phase1_system_prompt() -> str:
    return (
        "You are Mergero's Regional M&A Sell-Signal Analyst.\n\n" + CORE_CONSTRAINTS
    )


def phase1_user_prompt(region: str, industry_focus: Optional[str]) -> str:
    focus = industry_focus or "none specified"
    return f"""\
TASK: Research the region: {region}
(Optional industry focus: {focus})

GOAL: Identify the specific, regionally-grounded factors ("sell-signals") that
make a private company's owner or leadership more likely to consider selling the
business in the next 1-3 years. These must be validated as actually relevant to
{region} — do not reuse generic factors without checking they apply here. Legal,
tax, and cultural context differs sharply between countries even within a region.
Research each sub-country if the region spans several, and note where a signal
applies broadly vs. only in one country.

Research and cover, at minimum, these five categories — adapt each to what is
actually true for {region}, do not assume:

1. OWNERSHIP & SUCCESSION STRUCTURE — family/founder ownership prevalence,
   generational-transition norms, legal/tax treatment of inheritance and
   business succession, typical owner retirement age and succession-planning norms.
2. ECONOMIC & MARKET CONDITIONS — interest rate / financing environment,
   sector consolidation and PE/strategic-buyer activity, currency/trade/regulatory
   shifts affecting SME competitiveness.
3. REGULATORY & TAX ENVIRONMENT — capital gains treatment on a business sale,
   recent/upcoming legislation changing the incentive to sell now vs. later.
4. CULTURAL ATTITUDES TOWARD SELLING — is selling seen as a success milestone or
   a stigma; how publicly owners signal exit intent; role of relationship/trust
   based dealmaking and what it implies for where signals surface publicly.
5. PUBLICLY OBSERVABLE SIGNALS — public business-context behaviors correlating
   with sale-readiness (interim/external CEO appointments, senior hiring patterns,
   board composition changes, founder commentary on succession, M&A network
   membership, succession-planning event participation, atypical headcount growth).
   Note which public data sources are actually usable for {region} (national
   registries, trade press, chambers of commerce, LinkedIn, industry associations),
   including language and access considerations.

For each signal, produce an entry with: id (short slug), name, category (one of:
ownership_succession, economic_market, regulatory_tax, cultural, public_observable),
why_it_matters_in_region (grounded, not generic), how_to_detect (what to look for
and where), data_sources (list), signal_strength (strong|medium|weak), and
applies_to (which country/sub-region it holds for).

Also include: region, sub_regions_covered (list), generated_at (ISO-8601), and a
5-8 sentence human-readable summary of the most distinctive things about how
selling decisions get made in {region}.

Output ONLY the JSON object for the Phase 1 schema."""


def phase0_system_prompt() -> str:
    return (
        "You are Mergero's Company Universe Sourcing Assistant.\n\n" + CORE_CONSTRAINTS
    )


def phase0_user_prompt(region: str, criteria: str, max_companies: int) -> str:
    return f"""\
TASK: Identify up to {max_companies} privately-held companies in {region}
matching: {criteria} (e.g. industry, size, revenue band).

Use national business registries and directories appropriate to {region}
(e.g. Handelsregister/Bundesanzeiger for Germany, Bolagsverket for Sweden,
Brønnøysundregistrene for Norway, CVR for Denmark, PRH for Finland), plus
chambers of commerce and industry association listings, to build the list.

For each company output: name, website (if found), country, registry_id (if
available), and the source used to find it. Do NOT include public companies
already listed on a stock exchange unless the criteria explicitly ask for them.

Output ONLY a JSON object with keys: region, criteria, generated_at (ISO-8601),
and companies (a list of objects with name, website, country, registry_id, source)."""


def phase2_system_prompt() -> str:
    return (
        "You are Mergero's Company-Level M&A Sourcing Researcher.\n\n" + CORE_CONSTRAINTS
    )


def phase2_user_prompt(
    company_name: str,
    company_website: Optional[str],
    region: str,
    phase1_data: dict,
) -> str:
    checklist = json.dumps(phase1_data, ensure_ascii=False, indent=2)
    website = company_website or "unknown"
    return f"""\
CONTEXT — regional sell-signal checklist for {region}:
{checklist}

TASK: Research this company: {company_name} ({website}, {region})

Go through EACH signal in the checklist above and gather whatever publicly
available evidence exists for it. Check:
- Company website (About, Leadership, Careers, News/Press pages)
- Public business registry filings if accessible for {region}
- Leadership public professional profiles (LinkedIn, professional bios,
  conference speaker pages, published interviews)
- News coverage and press releases mentioning the company or its leadership
- Industry association listings and local trade press

RULES (in addition to the global constraints):
- Every piece of evidence needs a source URL. If you cannot find a source, do
  not include the claim.
- If a checklist signal requires private/sensitive inference to observe, mark it
  as "not assessable from public professional information".

For each checklist signal, output an object with: signal_id (matching Phase 1),
signal_name, evidence_found (string or null), sources (list of URLs),
confidence (high|medium|low, based on source reliability and recency), and notes.

Also include: company_name, region, website, researched_at (ISO-8601), a 3-5
sentence human-readable summary, and data_gaps (list of signal ids with no
public evidence found).

Output ONLY the JSON object for the Phase 2 schema."""
