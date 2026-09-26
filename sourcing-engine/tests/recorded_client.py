"""Offline transport fixture for tests only. NOT a live web research result."""
import json
from types import SimpleNamespace as NS

COMPANY = "Integration Test Works"
REGION = "Germany"
URLS = ["https://company.example/leadership", "https://trade.example/report", "https://interview.example/independence"]


def citation(url, stance="supports", independent=False):
    return dict(url=url, title="Recorded test source", published_at="2026-01-15", excerpt="Recorded test evidence for integration checks.", stance=stance,
                origin_group="trade reporting" if independent else "company disclosure", independent=independent,
                independence_basis="Original independent interview; not a syndicated release" if independent else "Company announcement")


def region():
    return dict(region=REGION, signals=[dict(id=key, name=label, category="public_observable", why_it_matters_in_region="Recorded regional context", how_to_detect="Public reporting", signal_strength="strong")
        for key, label in [("handover","CEO handover"),("operations","Operational step-back"),("expansion","Capacity expansion"),("independence","Independence statement"),("missing","Succession plan")]], summary="Recorded test framework")


def company():
    claims=[]
    for key, kind, text in [("handover","leadership","an external CEO was appointed"),("operations","operational","the founder stepped back from daily operations"),("expansion","growth","a new production site was announced"),("independence","context","the owner stated a commitment to independence")]:
        claims.append(dict(signal_id=key, signal_name=text.capitalize(), kind=kind, direction="negative" if key=="independence" else "positive", evidence_found=text,
                           sources=URLS[:2], confidence="high", citations=[citation(URLS[0])]))
    return dict(company_name=COMPANY, region=REGION, website="https://company.example", summary="Recorded investigation, not real research", signal_evidence=claims,
                structured_facts=[dict(field="employees",value=120,as_of="2026-01-01",sources=[URLS[0]]),dict(field="revenueK",value=24000,as_of="2026-01-01",sources=[URLS[0]])])


def verification():
    return dict(company_name=COMPANY, region=REGION, checks=[dict(signal_id=key, explanation="Recorded separate-search corroboration", citations=[citation(URLS[0]),citation(URLS[1],independent=True)] if key!="independence" else [citation(URLS[2],"contradicts",True)]) for key in ["handover","operations","expansion","independence"]])


class RecordedClient:
    def __init__(self):
        self.responses = self
        self.calls = []

    def create(self, **kwargs):
        prompt=kwargs["input"][-1]["content"]
        if prompt.startswith("Independently cross-check"):
            kind, payload = "verification", verification()
        elif "TASK: Research this company:" in prompt:
            kind, payload = "company", company()
        elif "TASK: Identify up to" in prompt:
            kind, payload = "universe", dict(region=REGION, criteria="Industrial companies", companies=[dict(name=COMPANY,website="https://company.example",country=REGION,source=URLS[0])])
        else:
            kind, payload = "region", region()
        self.calls.append(kind)
        return NS(output_text=json.dumps(payload),output=[NS(type="web_search_call",action=NS(sources=[{"url":url} for url in URLS]))])
