"""Conservative, model-assisted source checks; citations are not proof of intent."""
from datetime import date
from urllib.parse import urlparse
from app.models.schemas import Phase2Output, VerificationOutput
from app.services import prompts
from app.services.openai_client import ResearchError, run_structured_research


def public_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        return parsed.scheme in ("https", "http") and bool(parsed.hostname) and not parsed.username and not parsed.password
    except ValueError:
        return False


def known_date(value: str | None) -> bool:
    try:
        return bool(value) and date.fromisoformat(value) <= date.today()
    except (ValueError, TypeError):
        return False


def clean_citations(citations, retrieved):
    unique = {}
    for citation in citations:
        if citation.url not in retrieved or not public_url(citation.url) or not citation.excerpt.strip():
            continue
        if not known_date(citation.published_at):
            citation.published_at = None
        if not citation.independence_basis.strip() or citation.origin_group.strip().lower() in ("", "unknown"):
            citation.independent = False
        unique[(citation.url, citation.stance)] = citation
    return list(unique.values())


def verify_report(report: Phase2Output) -> Phase2Output:
    if not any(e.evidence_found for e in report.signal_evidence):
        report.verification_complete = True  # completed with no usable claims, not "verified"
        report.verification_method = "No supported claims to cross-check"
        return report
    try:
        check = run_structured_research(prompts.phase2_system_prompt(), prompts.verification_prompt(report.model_dump()), VerificationOutput)
        if check.research_mode != "web_search" or check.company_name.casefold().strip() != report.company_name.casefold().strip() or check.region.casefold().strip() != report.region.casefold().strip():
            raise ResearchError("Verification identity or grounding mismatch")
        ids = [c.signal_id for c in check.checks]
        if len(ids) != len(set(ids)) or not set(ids) <= {e.signal_id for e in report.signal_evidence}:
            raise ResearchError("Invalid verification claim identifiers")
    except ResearchError:
        report.warnings.append("Independent cross-check unavailable. Claims remain unverified; do not contact yet.")
        return report
    report.verification_complete = True
    report.verification_method = "Separate web-search cross-check; automated source-origin checks, not human verification"
    retrieved = set(check.retrieved_source_urls)
    checks = {c.signal_id: c for c in check.checks}
    for evidence in report.signal_evidence:
        evidence.citations = clean_citations(evidence.citations, set(report.retrieved_source_urls))
        claim_check = checks.get(evidence.signal_id)
        if not evidence.evidence_found or not claim_check:
            continue
        fresh = clean_citations(claim_check.citations, retrieved)
        evidence.citations = list({(c.url, c.stance): c for c in [*evidence.citations, *fresh]}.values())
        evidence.sources = list(dict.fromkeys([*evidence.sources, *(c.url for c in evidence.citations)]))
        evidence.verification_note = claim_check.explanation
        supports = [c for c in fresh if c.stance == "supports" and c.published_at]
        # Distinct domains AND editorial origins, plus an explicit independence basis.
        origins = {c.origin_group.casefold().strip() for c in supports if c.origin_group != "unknown"}
        domains = {urlparse(c.url).hostname.removeprefix("www.") for c in supports}
        if any(c.stance == "contradicts" for c in evidence.citations):
            evidence.verification_status = "conflicting"
        elif len(origins) >= 2 and len(domains) >= 2 and any(c.independent for c in supports):
            evidence.verification_status = "verified"
        elif supports:
            evidence.verification_status = "partially_verified"
        else:
            evidence.verification_status = "unverified"
    report.retrieved_source_urls = sorted(set(report.retrieved_source_urls) | retrieved)
    return report
