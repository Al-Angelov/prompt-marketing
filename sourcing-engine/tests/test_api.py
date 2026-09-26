import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.config import Settings
from app.main import app
from app.services import openai_client, research_service, storage, verification
from app import auth
from recorded_client import RecordedClient, COMPANY, REGION, company, verification as check_fixture, URLS
from app.models.schemas import Phase2Output, VerificationOutput, StructuredFact


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.settings=Settings(ALLOW_PAID_RESEARCH=True, OPENAI_API_KEY="offline-test-only", SOURCING_API_TOKEN="test-token", STORAGE_DIR=self.folder.name)
        self.recorded=RecordedClient()
        self.patches=[patch.object(module,"get_settings",return_value=self.settings) for module in (research_service, storage, openai_client, auth)]
        self.patches.append(patch.object(openai_client,"get_client",return_value=self.recorded))
        for item in self.patches:item.start()
        self.client=TestClient(app)
        self.headers={"Authorization":"Bearer test-token"}

    def tearDown(self):
        for item in reversed(self.patches):item.stop()
        self.folder.cleanup()

    def investigate(self):
        return self.client.post("/api/v1/research/company",headers=self.headers,json={"company_name":COMPANY,"region":REGION})

    def test_auth_health_validation_and_no_unauthorized_paid_calls(self):
        self.assertEqual(self.client.get("/health").status_code,200)
        self.assertEqual(self.client.post("/api/v1/research/company",json={"company_name":COMPANY,"region":REGION}).status_code,401)
        self.assertEqual(self.client.post("/api/v1/research/company",headers=self.headers,json={"company_name":"","region":REGION}).status_code,422)
        self.assertEqual(self.recorded.calls,[])

    def test_http_orchestration_caches_region_company_and_keeps_counter_evidence(self):
        first=self.investigate()
        self.assertEqual(first.status_code,200,first.text)
        result=first.json()
        self.assertEqual(self.recorded.calls,["region","company","verification"])
        self.assertEqual(result["signal_evidence"][0]["verification_status"],"verified")
        self.assertEqual(result["signal_evidence"][-1]["verification_status"],"conflicting")
        self.assertIn("missing",result["data_gaps"])
        self.assertEqual(len(result["structured_facts"]),2)
        second=self.investigate().json()
        self.assertTrue(second["cache_hit"])
        self.assertEqual(len(self.recorded.calls),3)
        framework=self.client.post("/api/v1/research/region",headers=self.headers,json={"region":REGION}).json()
        self.assertTrue(framework["cache_hit"])
        # Different company key forces extraction, but reuses the regional framework.
        with patch.object(research_service,"research_company_signals",side_effect=openai_client.ResearchError("offline")):
            failure=self.client.post("/api/v1/research/company",headers=self.headers,json={"company_name":"Another company","region":REGION})
            self.assertEqual(failure.status_code,502)
        self.assertEqual(self.recorded.calls.count("region"),1)

    def test_universe_is_grounded_bounded_and_cached(self):
        body={"region":REGION,"criteria":"Industrial companies","max_companies":5}
        first=self.client.post("/api/v1/sourcing/universe",headers=self.headers,json=body)
        self.assertEqual(first.status_code,200,first.text)
        self.assertEqual(first.json()["companies"][0]["name"],COMPANY)
        self.assertTrue(self.client.post("/api/v1/sourcing/universe",headers=self.headers,json=body).json()["cache_hit"])
        self.assertEqual(self.recorded.calls,["universe"])

    def test_verifier_rejects_syndication_unknown_dates_and_fails_closed(self):
        raw=company();raw.update(research_mode="web_search",retrieved_source_urls=URLS)
        for mode in ("syndication","unknown_dates","failed"):
            report=Phase2Output.model_validate(raw)
            check=check_fixture();check.update(research_mode="web_search",retrieved_source_urls=URLS)
            for claim in check["checks"]:
                for citation in claim["citations"]:
                    if mode=="syndication":citation["origin_group"]="same press release"
                    if mode=="unknown_dates":citation["published_at"]=None
            args={"side_effect":openai_client.ResearchError("offline")} if mode=="failed" else {"return_value":VerificationOutput.model_validate(check)}
            with patch.object(verification,"run_structured_research",**args):result=verification.verify_report(report)
            self.assertNotEqual(result.signal_evidence[0].verification_status,"verified")
            if mode=="failed":self.assertFalse(result.verification_complete);self.assertTrue(result.warnings)

    def test_invalid_structured_values_remain_missing(self):
        for field,value in [("revenueK",-1),("familyOwned",1),("employees",True),("shareholders",1.5),("ownerAge",200)]:
            self.assertIsNone(StructuredFact(field=field,value=value).value)

    def test_empty_research_is_cacheable_without_claiming_verified_evidence(self):
        report=Phase2Output(company_name=COMPANY,region=REGION,research_mode="web_search")
        with patch.object(verification,"run_structured_research") as research:
            result=verification.verify_report(report)
        self.assertTrue(result.verification_complete)
        self.assertEqual(result.signal_evidence,[])
        research.assert_not_called()


if __name__=="__main__":unittest.main()
