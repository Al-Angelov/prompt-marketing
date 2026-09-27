"""Authoritative deterministic priority policy v3. See docs/SCORING.md.

Every factor is a shift in log-odds against a typical company in the same country.
Priority = 50 + 25 * log2(odds multiplier): 50 is a typical company, 75 is twice its
odds, 100 is four times or more. Sector factors say how this industry differs from the
country as a whole; company factors say how this company differs from a typical one. Missing information is neutral (it stays at
the market average) and lowers confidence instead of dragging the score to zero.
No numeric priority is accepted from research output.
"""
import math
from datetime import date
from urllib.parse import urlparse

from app.models.schemas import Phase2Output
from app.services.mna_assessment import is_commercial_risk, is_missing_evidence

POLICY = "mergero-priority-v3"
POINTS_PER_LOG_ODDS = 25 / math.log(2)
DEFAULT_BASE_RATE = 0.015           # ~1-2% of SMEs change hands each year; used when the model is unavailable
SYNTHETIC_SHRINK = 0.5              # a synthetic-trained model moves the score half as far
MATERIAL = {"leadership", "operational", "growth", "liquidity", "partnership", "explicit_exit"}
# Provisional likelihood ratios for one fully verified, recent, strong event of each kind.
# Informed by the takeover and business-transfer literature (see docs/SCORING.md); not calibrated.
EVENT_LR = {"explicit_exit": 6.0, "leadership": 2.0, "liquidity": 1.7, "operational": 1.5, "partnership": 1.4, "growth": 1.3}
CONFLICT_LR = 1.5
QUALITY = {"Verified": 1.0, "Partially verified": 0.5, "Unverified": 0.25}
STRENGTH = {"strong": 1.0, "medium": 0.75, "weak": 0.5}
RELIABILITY = {"high": 1.0, "medium": 0.8, "low": 0.5}
MODEL_GROUPS = {"firmAge": "Firm age", "logRevenue": "Company size", "logRevenueSq": "Company size", "logEmployees": "Company size",
                "ebitdaMargin": "Profitability", "leverage": "Leverage", "leverageSq": "Leverage", "revenueGrowth3y": "Revenue growth",
                "maxDirectorTenure": "Director tenure", "ownerAge": "Owner age", "ownerOver62": "Owner age",
                "familyOwned": "Family ownership", "logShareholders": "Shareholders", "sectorDeals24m": "Sector deal activity"}
MAX_GROUP_SHIFT = math.log(3)


def _recency(published: str | None, as_of: date) -> float:
    try:
        age = (as_of - date.fromisoformat(published or "")).days
    except ValueError:
        return 0.5
    return 0.0 if age < 0 else 1.0 if age <= 365 else 0.7 if age <= 730 else 0.4


def _clamp(value: float, limit: float) -> float:
    return max(-limit, min(limit, value))


def _describe(feature: str, value) -> str:
    if value is None:
        return ""
    if feature == "logRevenue":
        k = math.exp(value)
        return f"revenue EUR {k / 1000:.1f}M" if k >= 1000 else f"revenue EUR {k:.0f}k"
    if feature == "logEmployees":
        return f"{math.expm1(value):.0f} employees"
    if feature in ("ebitdaMargin", "revenueGrowth3y"):
        return f"{value * 100:.1f}%"
    if feature == "leverage":
        return f"liabilities/assets {value:.2f}"
    if feature == "familyOwned":
        return "family-controlled" if value else "not family-controlled"
    if feature in ("ownerAge", "firmAge", "maxDirectorTenure"):
        return f"{value:.0f} yrs"
    return f"{value:g}"


def _model_factors(model: dict | None) -> tuple[list, float]:
    """Observed-feature contributions from the Java model, grouped by business concept."""
    if not model or model.get("status") != "scored":
        return [], 0.0
    shrink = SYNTHETIC_SHRINK if model["metadata"].get("syntheticTraining") else 1.0
    groups: dict[str, dict] = {}
    for c in model.get("contributions") or []:
        if c.get("imputed") or c.get("feature") not in MODEL_GROUPS:
            continue   # missing inputs are neutral, not evidence
        group = groups.setdefault(MODEL_GROUPS[c["feature"]], dict(delta=0.0, evidence=""))
        group["delta"] += shrink * c["logOdds"]
        if not group["evidence"]:
            group["evidence"] = _describe(c["feature"], c.get("observedValue"))
    factors = []
    for label, g in groups.items():
        delta = _clamp(g["delta"], MAX_GROUP_SHIFT)
        if abs(delta) >= 0.005:
            factors.append(dict(label=label, category="Company data", delta=delta, detail=g["evidence"],
                                source="Structured model" + (" (synthetic training, effect halved)" if shrink < 1 else "")))
    return factors, shrink


def _sector_factors(sector: dict | None) -> list:
    if not sector or not sector.get("available"):
        return []
    factors, year = [], sector.get("year")
    if sector.get("owner_ratio"):
        factors.append(dict(label="Sector owner ageing", category="Sector", delta=_clamp(0.75 * math.log(sector["owner_ratio"]), math.log(1.4)),
                            detail=f"{sector['owner_share'] * 100:.0f}% of self-employed in this sector are 50+ ({sector['owner_ratio']:.2f}x the national average, Eurostat {year})",
                            source=sector.get("source_url")))
    if sector.get("workforce_ratio"):
        factors.append(dict(label="Sector workforce ageing", category="Sector", delta=_clamp(0.35 * math.log(sector["workforce_ratio"]), math.log(1.15)),
                            detail=f"{sector['workforce_share'] * 100:.0f}% of this sector's workforce is 50+ ({sector['workforce_ratio']:.2f}x the national average, Eurostat {year})",
                            source=sector.get("source_url")))
    return [f for f in factors if abs(f["delta"]) >= 0.005]


def _registry_factors(signals: list | None, as_of: date) -> list:
    factors = []
    for s in signals or []:
        recency = _recency(s.date, as_of) if s.date else 1.0
        delta = math.log(s.likelihood_ratio) * s.quality * recency
        if delta:
            factors.append(dict(label=s.label, category="Official record", delta=delta, detail=s.detail, source=s.source, date=s.date))
    return factors


def assess(report: Phase2Output, model: dict | None, country: str, industry: str, framework=None, as_of=None,
           registry_signals=None, sector=None) -> dict:
    as_of = as_of or date.today()
    regional = {s.id: s for s in framework.signals} if framework else {}
    evidence = []
    for claim in report.signal_evidence:
        supporting = [c for c in claim.citations if c.stance == "supports" and c.published_at and c.origin_group.strip().casefold() not in ("", "unknown")]
        independent = (len({c.origin_group.casefold() for c in supporting}) >= 2
                       and len({urlparse(c.url).hostname.removeprefix("www.") for c in supporting}) >= 2
                       and any(c.independent and c.independence_basis for c in supporting))
        status = ("Insufficient evidence" if is_missing_evidence(claim.evidence_found) else "Conflicting" if claim.verification_status == "conflicting" or claim.direction == "negative" or any(c.stance == "contradicts" for c in claim.citations)
                  else "Verified" if claim.verification_status == "verified" and report.verification_complete and independent
                  else "Partially verified" if claim.verification_status in ("verified", "partially_verified") else "Unverified")
        evidence.append(dict(id=claim.signal_id, signal=claim.signal_name, fact=claim.evidence_found, status=status,
                             explanation=claim.verification_note, sources=[c.model_dump() for c in claim.citations], impact=0))

    # One underlying event counts once, even across checklist categories.
    events = {}
    for e, claim in zip(evidence, report.signal_evidence):
        signal = regional.get(claim.signal_id)
        base, _, repeat = claim.signal_id.rpartition("-")
        if signal is None and repeat.isdigit():
            signal = regional.get(base)   # repeated finding, e.g. "leadership-2"
        strength = STRENGTH.get(signal.signal_strength, 0.5) if signal else (0.5 if framework else 1.0)
        dates = [c.published_at for c in claim.citations if c.stance == "supports" and c.published_at]
        recency = max((_recency(d, as_of) for d in dates), default=0.5)
        reliability = RELIABILITY[claim.confidence]
        quality = QUALITY.get(e["status"], 0.0)
        eligible = claim.kind in MATERIAL and claim.direction == "positive" and not claim.structured_fields and quality > 0 and recency > 0
        delta = math.log(EVENT_LR[claim.kind]) * quality * strength * recency * reliability if eligible else 0.0
        event = (claim.event_id or claim.evidence_found or claim.signal_id).strip().casefold()
        e.update(event_id=event, strength=strength, recency=recency, reliability=reliability, verification=quality)
        if delta > events.get(event, (0, None))[0]:
            events[event] = (delta, e)
    conflicts = [e for e in evidence if e["status"] == "Conflicting"]
    conflict_events = sorted({e["event_id"] for e in conflicts})
    for event in conflict_events:
        events.pop(event, None)
    chosen = sorted(events.values(), key=lambda item: (-item[0], item[1]["id"]))[:3]

    public = []
    for delta, e in chosen:
        e["impact"] = delta * POINTS_PER_LOG_ODDS
        public.append(dict(label=e["signal"], category="Public evidence", delta=delta, detail=e["fact"],
                           source=next((s["url"] for s in e["sources"]), None)))
    conflict_factors = [dict(label="Contradictory evidence", category="Contradiction", delta=-math.log(CONFLICT_LR), detail=event, source=None)
                        for event in conflict_events[:2]]
    model_factors, shrink = _model_factors(model)
    sector_factors = _sector_factors(sector)
    registry_factors = _registry_factors(registry_signals, as_of)
    factors = model_factors + sector_factors + registry_factors + public + conflict_factors
    for f in factors:
        f["points"] = f["delta"] * POINTS_PER_LOG_ODDS

    total = sum(f["delta"] for f in factors)
    score = math.floor(max(0.0, min(100.0, 50 + total * POINTS_PER_LOG_ODDS)) + 0.5)
    base_rate = (model or {}).get("metadata", {}).get("trainingBaseRate") or DEFAULT_BASE_RATE
    base_logit = math.log(base_rate / (1 - base_rate))
    likelihood = 1 / (1 + math.exp(-(base_logit + total)))

    def points_for(category):
        return sum(f["points"] for f in factors if f["category"] == category)

    # Confidence describes completeness and reliability of the inputs, not statistical certainty.
    coverage = model["coverage"] if model else 0
    expected = len(framework.signals) if framework else len(report.signal_evidence) + len(report.data_gaps)
    supported = sum(e["recency"] * e["reliability"] for e in evidence if e["status"] == "Verified")
    public_quality = min(1, supported / max(1, expected)) if expected else 0
    official = bool(report.structured_facts) and any("Official registry" in f.provenance for f in report.structured_facts)
    certainty = 0.45 * public_quality + 0.35 * coverage + 0.1 * bool(sector_factors) + 0.1 * official
    synthetic = bool(model and model["metadata"]["syntheticTraining"])
    if not report.verification_complete or conflicts or model is None:
        certainty = min(certainty, .69)
    if synthetic:
        certainty = min(certainty, .79)
    confidence = "High" if certainty >= .8 else "Moderate" if certainty >= .5 else "Low"

    material = [e for e in evidence if e["impact"] > 0]
    verified = [e for e in material if e["status"] == "Verified"]
    principal_verified = bool(material) and all(e["status"] == "Verified" for e in material)
    commercial_risks = [finding for finding in report.business_findings
                        if is_commercial_risk(finding, set(report.retrieved_source_urls))]
    contact = score >= 70 and confidence == "High" and principal_verified and model is not None and not synthetic and not conflicts and not commercial_risks
    draft_allowed = not commercial_risks and (contact or ((model is None or synthetic) and score >= 65 and principal_verified))

    verified_ids = {e["id"] for e in verified}
    best = next((c for c in report.signal_evidence if c.signal_id in verified_ids and c.kind != "explicit_exit"),
                next((c for c in report.signal_evidence if c.signal_id in verified_ids), None))
    conversations = dict(leadership="Succession", operational="Succession / partial liquidity", growth="Growth capital",
                         liquidity="Partial liquidity / minority investment", partnership="Strategic partner", explicit_exit="Full exit")
    # Shared sector demographics are context, never a company's reason to sell.
    # Include negative drivers when explaining why one company ranks below another.
    strongest = max((f for f in factors if f["category"] != "Sector"), key=lambda f: abs(f["delta"]), default=None)
    if best:
        conversation, why_now = conversations.get(best.kind, "Not established"), best.evidence_found.rstrip(".") + "."
    else:
        conversation, why_now = "Not established", "No company-specific timing trigger has been established."
    review_summary = (why_now if best else
                      f"{strongest['label']}: {strongest['detail']}. {strongest['points']:+.1f} screening points." if strongest else
                      f"The collected evidence for {report.company_name} does not establish a company-specific reason to prioritise outreach.")
    angle = (f"Explore {conversation.lower()} in the context of the verified operating changes, without assuming an interest in selling." if best
             else "Research recent news and leadership before any approach; the registry profile alone is not a reason to contact." if strongest
             else "Wait for a corroborated reason to approach.")
    if conflicts:
        angle += " Resolve the contradictory evidence before contact."
    if commercial_risks:
        angle += " Review the sourced risks in the M&A assessment before outreach."
    # The finding follows a colon so research wording ("The company appointed...") reads as a quote,
    # not a broken mid-sentence splice ("reporting that The company...").
    outreach = (f"Hello,\n\nI came across recent public reporting on {report.company_name}: {why_now}\n\nAt Mergero, we work with owners considering {conversation.lower()}. That may or may not be relevant to your plans, and any conversation would start with your priorities for {report.company_name}.\n\nWould a 20-minute confidential call in the coming weeks be useful? There is no assumption that you are looking to sell or seeking investment.\n\nBest regards,\n[Your name]\nMergero") if draft_allowed else None

    ranked = sorted(factors, key=lambda f: -abs(f["points"]))[:3]
    drivers = "; ".join(f"{f['label']} {f['points']:+.0f}" for f in ranked) or "no factor differs from the market norm"
    explanation = (f"Provisional screening score with a neutral baseline of 50. Main drivers: {drivers}. "
                   "Sector factors are shared market context, not company-specific sale intent. "
                   "This score is not a measured sale probability. Missing data lowers confidence.")
    supplied = len(model["suppliedFields"]) if model else 0
    structured = dict(available=bool(model and model.get("status") == "scored"), supplied=supplied, total=11, synthetic=synthetic,
                      insight=(f"Company data covers {supplied} of 11 model inputs. The model estimates historical acquisition patterns, not an owner's interest in selling." if model
                               else "There is not enough sourced company data for structured analysis; the assessment uses public evidence only." if len(report.structured_facts) < 2
                               else "Company-data analysis is unavailable; the assessment uses public evidence only."),
                      facts=[f.model_dump() for f in report.structured_facts])
    public_factors = [dict(label=f["label"], points=f["points"], category=f["category"], detail=f["detail"] or "", source=f["source"]) for f in factors]
    return dict(company=report.company_name, country=country, industry=industry, priority=score, confidence=confidence, why_now=why_now, review_summary=review_summary,
                conversation=conversation, angle=angle, evidence=evidence, data_gaps=report.data_gaps, structured=structured,
                explanation=explanation, outreach=outreach, contact=contact, researched_at=report.researched_at,
                warnings=report.warnings + (["Outreach held: the commercial assessment contains sourced risks requiring review."] if commercial_risks else []),
                provenance="Live public research" if report.research_mode == "web_search" else "Official registry screen",
                factors=public_factors, structured_weight=shrink, contradiction_penalty=points_for("Contradiction"),
                likelihood=likelihood, relative_likelihood=likelihood / base_rate,
                score_breakdown=dict(policy_version=POLICY, as_of=as_of.isoformat(), baseline=50,
                                     public_points=points_for("Public evidence"), public_contribution=points_for("Public evidence"),
                                     model_contribution=points_for("Company data"), sector_contribution=points_for("Sector"),
                                     registry_contribution=points_for("Official record"), contradiction_penalty=points_for("Contradiction"),
                                     model_weight=shrink, coverage=coverage, model_percentile=(model or {}).get("percentile"),
                                     market_base_rate=base_rate, likelihood=likelihood, relative_likelihood=likelihood / base_rate,
                                     confidence_value=certainty, expected_signals=expected, factors=public_factors, evidence_terms=evidence,
                                     formula="round_half_up(clamp(50 + 25*log2(odds multiplier), 0, 100)); odds multiplier = exp(sum of factor log-odds shifts)"))
