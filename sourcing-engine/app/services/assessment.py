"""Authoritative deterministic priority policy. See docs/SCORING.md.
No numeric priority is accepted from research output.
"""
import math
from datetime import date
from urllib.parse import urlparse
from app.models.schemas import Phase2Output

NORDICS = {"Sweden", "Finland", "Denmark", "Norway", "Iceland"}
MATERIAL = {"leadership", "operational", "growth", "liquidity", "partnership", "explicit_exit"}


def assess(report: Phase2Output, model: dict | None, country: str, industry: str, framework=None, as_of=None) -> dict:
    as_of = as_of or date.today()
    regional = {s.id: s for s in framework.signals} if framework else {}
    evidence = []
    for claim in report.signal_evidence:
        supporting = [c for c in claim.citations if c.stance == "supports" and c.published_at and c.origin_group.strip().casefold() not in ("", "unknown")]
        independent = (len({c.origin_group.casefold() for c in supporting}) >= 2
                       and len({urlparse(c.url).hostname.removeprefix("www.") for c in supporting}) >= 2
                       and any(c.independent and c.independence_basis for c in supporting))
        status = ("Insufficient evidence" if not claim.evidence_found else "Conflicting" if claim.verification_status == "conflicting" or claim.direction == "negative" or any(c.stance == "contradicts" for c in claim.citations)
                  else "Verified" if claim.verification_status == "verified" and report.verification_complete and independent
                  else "Partially verified" if claim.verification_status in ("verified", "partially_verified") else "Unverified")
        evidence.append(dict(id=claim.signal_id, signal=claim.signal_name, fact=claim.evidence_found, status=status,
                             explanation=claim.verification_note, sources=[c.model_dump() for c in claim.citations], impact=0))

    # One underlying event earns points once, even across checklist categories.
    events = {}
    for e, claim in zip(evidence, report.signal_evidence):
        signal = regional.get(claim.signal_id)
        base, _, repeat = claim.signal_id.rpartition("-")
        if signal is None and repeat.isdigit():
            signal = regional.get(base)  # repeated finding, e.g. "leadership-2"
        strength = {"strong": 1, "medium": .65, "weak": .35}.get(signal.signal_strength, .35) if signal else (0 if framework else 1)
        dates = []
        for citation in claim.citations:
            try:
                published = date.fromisoformat(citation.published_at or "")
                if citation.stance == "supports" and published <= as_of:
                    dates.append(published)
            except ValueError:
                pass
        age = (as_of - max(dates)).days if dates else None
        recency = 1 if age is not None and age <= 365 else .7 if age is not None and age <= 730 else .4 if age is not None else .2
        reliability = {"high": 1, "medium": .75, "low": .4}[claim.confidence]
        verification = 1 if e["status"] == "Verified" else .25 if claim.verification_status == "partially_verified" and e["status"] == "Partially verified" else 0
        eligible = claim.kind in MATERIAL and claim.direction == "positive" and not claim.structured_fields and e["status"] not in ("Conflicting", "Insufficient evidence")
        points = 100 / 3 * strength * recency * reliability * verification if eligible else 0
        event = (claim.event_id or claim.evidence_found or claim.signal_id).strip().casefold()
        e.update(event_id=event, strength=strength, recency=recency, reliability=reliability, verification=verification)
        if points > events.get(event, (0, None))[0]:
            events[event] = (points, e)
    for e in evidence:
        if e["status"] == "Conflicting":
            events.pop(e["event_id"], None)
    chosen = sorted(events.values(), key=lambda item: (-item[0], item[1]["id"]))[:3]
    for points, e in chosen:
        e["impact"] = points
    material = [e for e in evidence if e["impact"] > 0]
    verified = [e for e in material if e["status"] == "Verified"]
    positive = sum(e["impact"] for e in material)
    conflicts = [e for e in evidence if e["status"] == "Conflicting"]
    conflict_events = {e["event_id"] for e in conflicts}
    penalty = -min(40, len(conflict_events) * 20)
    factors = [dict(label=e["signal"], points=e["impact"]) for e in material]
    factors.append(dict(label="Contradictory evidence", points=penalty))
    nominal = .65 if country.casefold() in {c.casefold() for c in NORDICS} else .25
    coverage = model["coverage"] if model else 0
    rank = model["percentile"] if model and model["status"] == "scored" else None
    synthetic = bool(model and model["metadata"]["syntheticTraining"])
    weight = min(nominal, .1 if synthetic else nominal) * coverage if rank is not None else 0
    score = math.floor(max(0, min(100, (1-weight)*positive + weight*(rank or 0) + penalty)) + .5)
    # Missing checklist evidence, stale/weak evidence and absent model inputs all
    # reduce certainty; this is an audit heuristic, not statistical confidence.
    expected = len(framework.signals) if framework else len(report.signal_evidence) + len(report.data_gaps)
    supported = sum(e["recency"] * e["reliability"] for e in evidence if e["status"] == "Verified")
    public_quality = min(1, supported / max(1, expected))
    certainty = .7 * public_quality + .3 * coverage
    if not report.verification_complete or conflicts:
        certainty = min(certainty, .69)
    if synthetic:
        certainty = min(certainty, .79)
    if model is None:
        certainty = min(certainty, .69)
    confidence = "High" if certainty >= .8 else "Moderate" if certainty >= .5 else "Low"
    principals = [e for e in evidence if e["impact"] > 0]
    principal_verified = bool(principals) and all(e["status"] == "Verified" for e in principals)
    contact = score is not None and score >= 70 and confidence == "High" and principal_verified and model is not None and not synthetic and not conflicts
    draft_allowed = contact or ((model is None or synthetic) and score is not None and score >= 60 and principal_verified)
    verified_ids = {e["id"] for e in verified}
    best = next((c for c in report.signal_evidence if c.signal_id in verified_ids and c.kind != "explicit_exit"), next((c for c in report.signal_evidence if c.signal_id in verified_ids), None))
    conversations = dict(leadership="Succession", operational="Succession / partial liquidity", growth="Growth capital", liquidity="Partial liquidity / minority investment", partnership="Strategic partner", explicit_exit="Full exit")
    conversation = conversations.get(best.kind, "Not established") if best else "Not established"
    why_now = (best.evidence_found.rstrip(".") + ".") if best else "More independent evidence is needed before approaching this company."
    angle = f"Explore {conversation.lower()} in the context of the verified operating changes, without assuming an interest in selling." if best else "Wait for a corroborated reason to approach."
    if conflicts:
        angle += " Resolve the contradictory evidence before contact."
    outreach = (f"Hello,\n\nI read the public reporting that {why_now}\n\nAt Mergero, we work with owners considering {conversation.lower()}. That may or may not be relevant to your plans. Any conversation would start with your priorities for {report.company_name}.\n\nWould a brief, confidential conversation be useful? There is no assumption that you are looking to sell or seeking investment.\n\nBest regards,\nMergero") if draft_allowed else None
    explanation = f"Public timing signals contribute {positive:g} points before weighting. Available company data carries {weight*100:.1f}% of the assessment in this market. Contradictory evidence subtracts {abs(penalty)} points after weighting."
    structured = dict(available=bool(model and rank is not None), supplied=len(model["suppliedFields"]) if model else 0, total=11, synthetic=synthetic,
                      insight=(f"Company data covers {len(model['suppliedFields'])} of 11 inputs. The model estimates historical acquisition patterns, not an owner's interest in selling." if model else "There is not enough sourced company data for structured analysis; the assessment uses public evidence only." if len(report.structured_facts) < 2 else "Company-data analysis is unavailable; the assessment uses public evidence only."),
                      facts=[f.model_dump() for f in report.structured_facts])
    return dict(company=report.company_name, country=country, industry=industry, priority=score, confidence=confidence, why_now=why_now,
                conversation=conversation, angle=angle, evidence=evidence, data_gaps=report.data_gaps, structured=structured,
                explanation=explanation, outreach=outreach, contact=contact, researched_at=report.researched_at, warnings=report.warnings,
                provenance="Live public research", factors=factors, structured_weight=weight, contradiction_penalty=penalty,
                score_breakdown=dict(policy_version="mergero-priority-v2", as_of=as_of.isoformat(), public_points=positive,
                                     regional_cap=nominal, synthetic_cap=.1 if synthetic else None, coverage=coverage,
                                     model_percentile=rank, model_weight=weight, public_contribution=(1-weight)*positive,
                                     model_contribution=weight*(rank or 0), contradiction_penalty=penalty,
                                     confidence_value=certainty, expected_signals=expected, factors=factors, evidence_terms=evidence,
                                     formula="round_half_up(clamp((1-w)*public_points + w*model_percentile + contradiction_penalty, 0, 100))"))
