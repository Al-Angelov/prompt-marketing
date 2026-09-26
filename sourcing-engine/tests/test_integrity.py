import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from openai import OpenAIError
from app.models.schemas import Phase1Output, Phase2Output, SignalEvidenceItem, SignalItem
from pydantic import ValidationError
from app.services import openai_client, research_service, storage


class IntegrityTest(unittest.TestCase):
    def test_research_receives_exact_schema_not_only_prose(self):
        with patch.object(openai_client, 'get_settings', return_value=SimpleNamespace(enable_web_search=True)), patch.object(openai_client, '_run_with_responses_api', return_value={'region':'Germany','signals':[]}) as request:
            openai_client.run_structured_research('system', 'user', Phase1Output)
        prompt = request.call_args.args[0]
        self.assertIn('"signals"', prompt)
        self.assertIn('"applies_to"', prompt)
        self.assertIn('"type":"array"', prompt)

    def test_grounded_research_requires_search_and_rejects_unsearched_output(self):
        from unittest.mock import MagicMock
        client = MagicMock()
        client.responses.create.return_value = SimpleNamespace(output_text='{}', output=[])
        with patch.object(openai_client, 'get_client', return_value=client), patch.object(openai_client, 'get_settings', return_value=SimpleNamespace(openai_model='gpt-4o')):
            with self.assertRaisesRegex(openai_client.ResearchError, 'No web search'):
                openai_client._run_with_responses_api('system', 'user', 'test')
        self.assertEqual(client.responses.create.call_args.kwargs['tool_choice'], 'required')

    def test_single_country_response_preserves_meaning_without_relaxing_schema(self):
        fields = dict(id="succession", name="Succession", category="ownership_succession", why_it_matters_in_region="Context", how_to_detect="Reporting", signal_strength="medium")
        self.assertEqual(SignalItem(**fields, applies_to="Germany").applies_to, ["Germany"])
        self.assertEqual(SignalItem(**fields, applies_to=["Germany", "Austria"]).applies_to, ["Germany", "Austria"])
        for value in (42, {"country": "Germany"}, [42], ""):
            with self.assertRaises(ValidationError): SignalItem(**fields, applies_to=value)

    def test_grounded_failure_never_silently_calls_ungrounded_model(self):
        with patch.object(openai_client, "get_settings", return_value=SimpleNamespace(enable_web_search=True)), patch.object(openai_client, "_run_with_responses_api", side_effect=OpenAIError("offline")), patch.object(openai_client, "_run_with_chat_completions") as fallback:
            with self.assertRaises(openai_client.ResearchError):
                openai_client.run_structured_research("system", "user", Phase1Output)
            fallback.assert_not_called()

    def test_unsupported_claims_become_data_gaps_not_verified_evidence(self):
        report = Phase2Output(company_name="Example", region="Nordic", research_mode="web_search", retrieved_source_urls=["https://source.example/report"], signal_evidence=[
            SignalEvidenceItem(signal_id="leadership", signal_name="Leadership", evidence_found="New CEO", sources=["https://invented.example"], confidence="high")])
        with patch.object(research_service, "run_structured_research", return_value=report), patch.object(storage, "save_company_signals"):
            result = research_service.research_company_signals("Example", None, "Nordic", {"signals":[{"id":"leadership"},{"id":"ownership"}]})
        self.assertIsNone(result.signal_evidence[0].evidence_found)
        self.assertEqual(result.signal_evidence[0].verification_status, "insufficient_evidence")
        self.assertEqual(result.data_gaps, ["leadership", "ownership"])

    def test_cited_claim_is_still_not_independently_verified(self):
        report = Phase2Output(company_name="Example", region="Nordic", research_mode="web_search", retrieved_source_urls=["https://source.example/report"], signal_evidence=[
            SignalEvidenceItem(signal_id="leadership", signal_name="Leadership", evidence_found="New CEO", sources=["https://source.example/report"], confidence="high")])
        with patch.object(research_service, "run_structured_research", return_value=report), patch.object(storage, "save_company_signals"):
            result = research_service.research_company_signals("Example", None, "Nordic", {"signals":[{"id":"leadership"}]})
        self.assertEqual(result.signal_evidence[0].verification_status, "unverified")

    def test_storage_rejects_paths_and_ambiguous_regions(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(storage, "get_settings", return_value=SimpleNamespace(storage_path=Path(folder))):
            with self.assertRaises(ValueError):
                storage.load_company_report_by_slug("../private")
            storage.save_company_signals("Acme", "Germany", {"company_name":"Acme"})
            storage.save_company_signals("Acme", "Nordic", {"company_name":"Acme"})
            with self.assertRaises(ValueError):
                storage.load_company_report_by_slug("acme")
            self.assertEqual(storage.load_company_report_by_slug("acme-germany"), None)
            self.assertEqual(storage.load_company_report_by_slug("acme_germany_signals")["company_name"], "Acme")


if __name__ == "__main__":
    unittest.main()
