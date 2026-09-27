import unittest
from unittest.mock import patch

from app.models.schemas import Phase2Output, MnaFinding, Citation, ContactRoute, StructuredFact, SignalEvidenceItem
from app.services.mna_assessment import build_mna_assessment, normalize_business_research, is_commercial_risk
from app.services import research_service, prompts

URL = "https://company.example/about"
CONTACT = "https://company.example/contact"


def citation(excerpt, url=URL):
    return Citation(url=url, excerpt=excerpt, stance="supports", published_at="2025-01-01")


def report(**kwargs):
    return Phase2Output(company_name="Example", region="France", research_mode="web_search",
                        retrieved_source_urls=[URL, CONTACT], **kwargs)


class MnaAssessmentTest(unittest.TestCase):
    def test_all_seven_unknown_when_empty_no_invented_valuation(self):
        cards = build_mna_assessment(report())
        self.assertEqual(len(cards), 7)
        self.assertTrue(all(c["status"] == "unknown" and not c["findings"] and c["gaps"] for c in cards))

    def test_business_research_preserves_useful_data_without_self_verification(self):
        value = report(business_findings=[
            MnaFinding(dimension="business_quality", fact="Company reports subscription contracts.", citations=[citation("Our subscription contracts renew annually.")]),
            MnaFinding(dimension="economics", fact="Revenue is 30 million.", citations=[citation("30m", "https://invented.example")]),
            MnaFinding(dimension="owner_motivation", fact="No succession evidence found.", citations=[citation("No announcement.")]),
        ])
        normalize_business_research(value)
        self.assertEqual(len(value.business_findings), 1)
        cards = {c["dimension"]: c for c in build_mna_assessment(value)}
        self.assertEqual(cards["business_quality"]["status"], "limited")
        self.assertEqual(cards["business_quality"]["findings"][0]["status"], "Source-backed")
        self.assertEqual(cards["economics"]["status"], "unknown")
        self.assertTrue(cards["owner_motivation"]["gaps"])

    def test_risk_preserved_and_facts_do_not_imply_owner_intent(self):
        value = report(structured_facts=[StructuredFact(field="familyOwned", value=True, as_of="2025-01-01", sources=[URL])],
            business_findings=[MnaFinding(dimension="risk", fact="The company states it intends to remain independent.", direction="negative", citations=[citation("We will remain independent.")])])
        cards = {c["dimension"]: c for c in build_mna_assessment(value)}
        self.assertEqual(cards["dealability"]["status"], "supported")
        self.assertEqual(cards["owner_motivation"]["status"], "unknown")
        self.assertEqual(cards["risk"]["status"], "risk")

    def test_no_invented_contact_and_no_guessed_recipient(self):
        value = report(contact_routes=[
            ContactRoute(name="Invented Person", role="CEO", channel="email", email="info@company.example", source_url=CONTACT,
                         citations=[citation("For business enquiries: info@company.example", CONTACT)]),
            ContactRoute(channel="email", email="ceo@company.example", source_url=CONTACT,
                         citations=[citation("Contact us via info@company.example", CONTACT)]),
            ContactRoute(channel="linkedin", url="https://evil.example/profile", source_url=CONTACT,
                         citations=[citation("https://evil.example/profile", CONTACT)]),
            ContactRoute(channel="contact_form", url=CONTACT, source_url=CONTACT, citations=[citation(f"Contact form: {CONTACT}", CONTACT)]),
        ])
        normalize_business_research(value)
        self.assertEqual(len(value.contact_routes), 2)
        self.assertEqual(value.contact_routes[0].email, "info@company.example")
        self.assertIsNone(value.contact_routes[0].name)
        self.assertIsNone(value.contact_routes[0].role)

    def test_neutral_risk_is_flagged_and_unknown_citation_cannot_create_a_hold(self):
        risk = MnaFinding(dimension="risk", fact="The company reports ongoing regulatory proceedings.",
                          direction="neutral", citations=[citation("Proceedings are ongoing.")])
        value = report(business_findings=[risk])
        self.assertTrue(is_commercial_risk(risk, set(value.retrieved_source_urls)))
        cards = {c["dimension"]: c for c in build_mna_assessment(value)}
        self.assertEqual(cards["risk"]["status"], "risk")
        harmless = MnaFinding(dimension="business_quality", fact="The company reports recurring contracts.",
                              direction="neutral", citations=[citation("Recurring contracts."),
                              Citation(url="https://unretrieved.example/attack", excerpt="Untrusted contradiction.", stance="contradicts")])
        self.assertFalse(is_commercial_risk(harmless, set(value.retrieved_source_urls)))
        value.business_findings = [harmless]
        cards = {c["dimension"]: c for c in build_mna_assessment(value)}
        self.assertEqual(cards["business_quality"]["status"], "limited")
        self.assertEqual(cards["business_quality"]["findings"][0]["sources"], [URL])
        unsupported = MnaFinding(dimension="risk", fact="Unsupported risk allegation.", direction="negative",
                                citations=[citation("Unretrieved allegation.", "https://unretrieved.example")])
        self.assertFalse(is_commercial_risk(unsupported, set(value.retrieved_source_urls)))

    def test_extraction_missing_prose_is_not_a_positive_signal(self):
        value = report(signal_evidence=[SignalEvidenceItem(signal_id="succession", signal_name="Succession", confidence="high",
            evidence_found="No public leadership names were found in the sources reviewed.", sources=[URL], direction="positive", kind="leadership")])
        with patch.object(research_service, "run_structured_research", return_value=value), patch.object(research_service.storage, "save_company_signals"):
            result = research_service.research_company_signals("Example", None, "France", {"signals": [{"id": "succession"}]})
        self.assertIsNone(result.signal_evidence[0].evidence_found)
        self.assertEqual(result.signal_evidence[0].direction, "neutral")
        self.assertIn("succession", result.data_gaps)

    def test_extractor_verified_flag_is_not_trusted(self):
        value = report(verification_complete=True, signal_evidence=[SignalEvidenceItem(signal_id="growth", signal_name="Growth", confidence="high",
            kind="growth", verification_status="verified", evidence_found="The company opened a factory.", sources=[URL], citations=[citation("Opened a factory.")])])
        cards = {c["dimension"]: c for c in build_mna_assessment(value)}
        self.assertEqual(cards["business_quality"]["status"], "limited")
        self.assertEqual(cards["timing"]["status"], "unknown")
        evaluated = [{"id": "growth", "status": "Verified"}]
        cards = {c["dimension"]: c for c in build_mna_assessment(value, evaluated)}
        self.assertEqual(cards["business_quality"]["status"], "supported")

    def test_prompt_requires_breadth_without_extra_calls(self):
        prompt = prompts.phase2_user_prompt("Example", None, "France", {"signals": []})
        for dimension in ("owner_motivation", "business_quality", "strategic_attractiveness", "timing", "dealability", "economics", "risk"):
            self.assertIn(dimension, prompt)
        self.assertIn("Never infer an email pattern", prompt)
        self.assertIn("within this SAME research task", prompt)


if __name__ == "__main__":
    unittest.main()
