"""Source-backed M&A coverage, separate from calibrated likelihood or sale intent."""
import re
from urllib.parse import urlparse

from app.models.schemas import Phase2Output, MnaGap
from app.services.verification import clean_citations, public_url, known_date

DIMENSIONS = {
    "owner_motivation": ("Owner motivation", "Confirm current owner priorities directly; public events alone do not establish willingness to transact."),
    "business_quality": ("Business quality", "Validate earnings quality, recurring revenue and customer concentration."),
    "strategic_attractiveness": ("Strategic attractiveness", "Validate market position and fit against an actual buyer mandate."),
    "timing": ("Timing triggers", "No company-specific reason to approach now has been established."),
    "dealability": ("Dealability", "Confirm ownership, approvals and transaction restrictions with the company."),
    "economics": ("Valuation / economics", "Valuation remains unknown without relevant earnings, comparables and owner expectations."),
    "risk": ("Negative evidence / risk", "Risk review is incomplete; no reported risk does not mean no risk exists."),
}
ABSENCE = re.compile(r"^(?:no\b.{0,180}\b(?:found|available|reported|identified|disclosed|listed)|not (?:found|available|disclosed|assessable)|(?:there (?:is|are) )?insufficient evidence|(?:public )?evidence (?:was |is )?not|the (?:claim|signal) is not supported)", re.I)


def is_missing_evidence(text):
    return not text or bool(ABSENCE.search(text.strip()))


def is_commercial_risk(finding, retrieved):
    citations = clean_citations(finding.citations, retrieved)
    return bool(citations) and not is_missing_evidence(finding.fact) and (
        finding.direction == "negative" or finding.dimension == "risk" and finding.direction != "positive"
        or any(c.stance == "contradicts" for c in citations))


def normalize_business_research(report: Phase2Output):
    """Discard unsourced extraction; do not let the extractor verify its own claims."""
    retrieved = set(report.retrieved_source_urls) if report.research_mode == "web_search" else set()
    findings = []
    for finding in report.business_findings:
        finding.citations = clean_citations(finding.citations, retrieved)
        if is_missing_evidence(finding.fact):
            report.business_gaps.append(MnaGap(dimension=finding.dimension, reason=finding.fact or "No source-backed finding available."))
        elif finding.citations:
            findings.append(finding)
    report.business_findings = findings
    routes = []
    for route in report.contact_routes:
        route.citations = clean_citations(route.citations, retrieved)
        source_citations = [c for c in route.citations if c.url == route.source_url]
        if not source_citations:
            continue
        excerpt = " ".join(c.excerpt for c in source_citations)
        if route.channel == "email":
            emails = re.findall(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", excerpt, re.I)
            if not route.email or route.email.casefold() not in {e.casefold() for e in emails}:
                continue
            route.url = None
        else:
            if not route.url or not public_url(route.url):
                continue
            urls = re.findall(r'https?://[^\s<>"\[\]]+', excerpt)
            if route.url not in {u.rstrip('.,;:!?)]}') for u in urls} and not (route.channel == "contact_form" and route.url == route.source_url):
                continue
            if route.channel == "linkedin" and (urlparse(route.url).hostname or "").removeprefix("www.") != "linkedin.com":
                continue
            route.email = None
        # Keep generic inboxes generic if the source does not name the recipient.
        if route.name and route.name.casefold() not in excerpt.casefold():
            route.name = None
        if route.role and route.role.casefold() not in excerpt.casefold():
            route.role = None
        routes.append(route)
    report.contact_routes = list({(r.channel, r.email or r.url): r for r in routes}.values())


def build_mna_assessment(report: Phase2Output, evaluated_signals=None):
    """Seven explicit coverage dimensions. No invented values or new score formula.

    Only caller-supplied deterministic evaluated statuses can describe a signal as
    verified. Raw model/extraction status never provides independent verification.
    """
    cards = {key: dict(dimension=key, label=label, status="unknown", summary="", findings=[], gaps=[])
             for key, (label, _) in DIMENSIONS.items()}
    retrieved = set(report.retrieved_source_urls)

    def add(dimension, fact, sources, status="Source-backed", negative=False):
        if dimension not in cards or is_missing_evidence(fact):
            return
        sources = list(dict.fromkeys(u for u in sources if public_url(u)))
        if not sources:
            return
        card = cards[dimension]
        if any(f["fact"].casefold() == fact.casefold() for f in card["findings"]):
            return
        card["findings"].append(dict(fact=fact, sources=sources, status=status))
        if negative:
            card["status"] = "risk"
        elif card["status"] != "risk":
            card["status"] = "supported" if status in ("Verified", "Reported fact") or card["status"] == "supported" else "limited"

    for finding in report.business_findings:
        citations = clean_citations(finding.citations, retrieved)
        # Extracted source-backed research is useful without claiming corroboration.
        add(finding.dimension, finding.fact, [c.url for c in citations], negative=is_commercial_risk(finding, retrieved))
    for gap in report.business_gaps:
        if gap.reason.strip():
            cards[gap.dimension]["gaps"].append(gap.reason)

    fact_map = {"foundedYear": ("business_quality", "Reported founding year (business history)"),
                "revenueK": ("business_quality", "Reported revenue (EUR thousands)"),
                "employees": ("business_quality", "Reported employees"),
                "ebitdaMargin": ("business_quality", "Reported EBITDA margin (ratio)"),
                "revenueGrowth3y": ("business_quality", "Reported three-year revenue CAGR (ratio)"),
                "leverage": ("economics", "Reported leverage measure"),
                "shareholders": ("dealability", "Reported shareholder count"),
                "familyOwned": ("dealability", "Family ownership indicator")}
    for fact in report.structured_facts:
        if fact.field not in fact_map or fact.value is None or not known_date(fact.as_of):
            continue
        dimension, label = fact_map[fact.field]
        value = ("Yes" if fact.value else "No") if isinstance(fact.value, bool) else f"{fact.value:g}"
        add(dimension, f"{label}: {value} (as of {fact.as_of}). {fact.provenance}", fact.sources, "Reported fact")
    for fact in report.conflicting_structured_facts:
        add("risk", f"Conflicting public values for {fact.field}; resolve before relying on this metric.", fact.sources, "Conflicting", True)

    evaluated = {item["id"]: item for item in (evaluated_signals or []) if item.get("id")}
    for signal in report.signal_evidence:
        evaluation = evaluated.get(signal.signal_id, {})
        status = evaluation.get("status", "Unverified")
        citations = clean_citations(signal.citations, retrieved)
        negative = signal.direction == "negative" or status == "Conflicting" or any(c.stance == "contradicts" for c in citations)
        kind_dimension = {"leadership": "owner_motivation", "explicit_exit": "owner_motivation", "liquidity": "economics",
                          "operational": "business_quality", "growth": "business_quality", "partnership": "strategic_attractiveness"}
        dimension = "risk" if negative else kind_dimension.get(signal.kind)
        sources = [c.url for c in citations]
        if dimension:
            add(dimension, signal.evidence_found, sources, status, negative)
        if not negative and not signal.structured_fields and signal.kind in kind_dimension and status in ("Verified", "Partially verified") and any(known_date(c.published_at) for c in citations):
            add("timing", signal.evidence_found, sources, status)

    for dimension, card in cards.items():
        card["gaps"] = list(dict.fromkeys(card["gaps"]))
        # Coverage of an isolated fact never establishes owner intent, a valuation,
        # clean diligence, or a company's readiness to execute a transaction.
        if not card["findings"] or dimension in ("owner_motivation", "economics", "risk", "dealability"):
            if DIMENSIONS[dimension][1] not in card["gaps"]:
                card["gaps"].append(DIMENSIONS[dimension][1])
        count = len(card["findings"])
        card["summary"] = (f"{count} sourced finding{'s' if count != 1 else ''}; review the evidence and remaining gaps."
                           if count else "Not established by the collected public sources.")
    return list(cards.values())
