"""Existing liveResearch.ts + assessment.ts policy, moved behind the API.
The formula is unchanged: coverage-scaled regional blend, then full contradiction
penalty. It is an uncalibrated research priority, never owner willingness to sell.
"""
import math
from urllib.parse import urlparse
from app.models.schemas import Phase2Output

NORDICS = {"Sweden", "Finland", "Denmark", "Norway", "Iceland"}
MATERIAL = {"leadership", "operational", "growth", "liquidity", "partnership", "explicit_exit"}


def assess(report: Phase2Output, model: dict | None, country: str, industry: str) -> dict:
    evidence = []
    for claim in report.signal_evidence:
        supporting = [c for c in claim.citations if c.stance == "supports" and c.published_at and c.origin_group != "unknown"]
        independent = (len({c.origin_group.casefold() for c in supporting}) >= 2
                       and len({urlparse(c.url).hostname.removeprefix("www.") for c in supporting}) >= 2
                       and any(c.independent and c.independence_basis for c in supporting))
        status = ("Insufficient evidence" if not claim.evidence_found else "Conflicting" if claim.verification_status == "conflicting" or claim.direction == "negative"
                  else "Verified" if claim.verification_status == "verified" and report.verification_complete and independent else "Partially verified")
        evidence.append(dict(id=claim.signal_id, signal=claim.signal_name, fact=claim.evidence_found, status=status,
                             explanation=claim.verification_note, sources=[c.model_dump() for c in claim.citations], impact=0))

    def eligible(kinds):
        return [e for e, c in zip(evidence, report.signal_evidence) if c.kind in kinds and c.direction == "positive" and e["status"] not in ("Conflicting", "Insufficient evidence")]

    factors = []
    for label, kinds in [("Leadership transition", {"leadership"}), ("Operational step-back", {"operational"}), ("Transaction / capital timing", {"growth", "liquidity", "partnership", "explicit_exit"})]:
        matches = eligible(kinds)
        strongest = next((e for e in matches if e["status"] == "Verified"), matches[0] if matches else None)
        points = (20 if strongest["status"] == "Verified" else 5) if strongest else 0
        if strongest:
            strongest["impact"] += points
        factors.append(dict(label=label, points=points))
    material = eligible(MATERIAL)
    verified = [e for e in material if e["status"] == "Verified"]
    quality = 20 * len(verified) / len(material) if material else 0
    positive = sum(f["points"] for f in factors) + quality + min(20, len(verified) * 10)
    conflicts = [e for e in evidence if e["status"] == "Conflicting"]
    penalty = -min(40, len(conflicts) * 20)
    factors += [dict(label="Evidence quality", points=quality), dict(label="Independent corroboration", points=min(20, len(verified) * 10)), dict(label="Contradictory evidence", points=penalty)]
    nominal = .65 if country.casefold() in {c.casefold() for c in NORDICS} else .25
    coverage = model["coverage"] if model else 0
    rank = model["percentile"] if model and model["status"] == "scored" else None
    weight = nominal * coverage if rank is not None else 0
    score = math.floor(max(0, min(100, (1-weight)*positive + weight*(rank or 0) + penalty)) + .5) if material else None
    public_quality = 1 if len(verified) >= 2 and report.verification_complete else .6 if material else .15
    certainty = (1-nominal)*public_quality + nominal*coverage
    synthetic = bool(model and model["metadata"]["syntheticTraining"])
    if synthetic:
        certainty = min(certainty, .79)
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
    explanation = f"Verified public timing signals contribute {positive:g} points before weighting. Available company data carries {weight*100:.1f}% of the assessment in this market. Contradictory evidence subtracts {abs(penalty)} points after weighting."
    structured = dict(available=bool(model and rank is not None), supplied=len(model["suppliedFields"]) if model else 0, total=11, synthetic=synthetic,
                      insight=(f"Company data covers {len(model['suppliedFields'])} of 11 inputs. The model estimates historical acquisition patterns, not an owner's interest in selling." if model else "There is not enough sourced company data for structured analysis; the assessment uses public evidence only." if len(report.structured_facts) < 2 else "Company-data analysis is unavailable; the assessment uses public evidence only."),
                      facts=[f.model_dump() for f in report.structured_facts])
    return dict(company=report.company_name, country=country, industry=industry, priority=score, confidence=confidence, why_now=why_now,
                conversation=conversation, angle=angle, evidence=evidence, data_gaps=report.data_gaps, structured=structured,
                explanation=explanation, outreach=outreach, contact=contact, researched_at=report.researched_at, warnings=report.warnings,
                provenance="Live public research", factors=factors, structured_weight=weight, contradiction_penalty=penalty)
