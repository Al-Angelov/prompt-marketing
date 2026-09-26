import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app
from app import auth
from app.config import Settings
from app.models.schemas import Phase2Output
from app.services import market, research_service, storage, openai_client, structured_model
from app.services.assessment import assess
from recorded_client import RecordedClient


def report():
    return Phase2Output.model_validate_json((Path(__file__).parents[2] / 'tests/fixtures/research-report.json').read_text())


def model(coverage=1, synthetic=False, percentile=90):
    return dict(status='scored', coverage=coverage, percentile=percentile, suppliedFields=list(structured_model.FIELDS)[:round(coverage*11)], metadata=dict(syntheticTraining=synthetic))


class PolicyTest(unittest.TestCase):
    def test_contradictions_regional_weight_and_missing_data(self):
        r = report()
        germany = assess(r, model(), 'Germany', 'Industrial manufacturing')
        nordics = assess(r, model(), 'Sweden', 'Industrial manufacturing')
        self.assertEqual(germany['priority'], 78)
        self.assertEqual(nordics['priority'], 74)
        self.assertEqual(germany['contradiction_penalty'], -20)
        self.assertFalse(germany['contact'])
        self.assertGreater(nordics['structured_weight'], germany['structured_weight'])
        partial = assess(r, model(2/11), 'Sweden', 'Software')
        self.assertLess(partial['structured_weight'], nordics['structured_weight'])
        self.assertNotEqual(partial['confidence'], 'High')
        self.assertEqual(assess(r, None, 'Germany', 'Software')['priority'], 80)

    def test_unverified_and_context_evidence_cannot_authorize_outreach(self):
        r = report()
        for e in r.signal_evidence:
            e.verification_status = 'unverified'
        result = assess(r, model(), 'Germany', 'Software')
        self.assertEqual(result['evidence'][0]['status'], 'Unverified')
        self.assertFalse(result['contact'])
        self.assertIsNone(result['outreach'])
        for e in r.signal_evidence:
            e.kind = 'structured_context'
        self.assertEqual(assess(r, model(), 'Germany', 'Software')['score_breakdown']['public_points'], 0)

    def test_synthetic_training_and_drafts_are_provisional(self):
        result = assess(report(), model(synthetic=True), 'Germany', 'Software')
        self.assertEqual(result['confidence'], 'Moderate')
        self.assertFalse(result['contact'])
        self.assertIn('external CEO', result['outreach'])
        self.assertIn('no assumption that you are looking to sell', result['outreach'])

    def test_model_inputs_never_invent_fields_and_future_facts_are_excluded(self):
        r = report()
        data = structured_model.inputs_for(r, 'Industrial manufacturing')
        self.assertEqual(data['employees'], 120)
        self.assertEqual(data['sector'], 'Industrial manufacturing')
        self.assertNotIn('ownerAge', data)
        r.structured_facts[0].as_of = '2099-01-01'
        self.assertNotIn('employees', structured_model.inputs_for(r, 'Software'))
        with patch.object(structured_model, 'urlopen') as request:
            self.assertIsNone(structured_model.score(r, 'Software'))
            request.assert_not_called()

    def test_recency_strength_duplicate_events_and_structured_overlap(self):
        from datetime import date
        from recorded_client import region
        from app.models.schemas import Phase1Output
        r = report()
        framework = Phase1Output(**region())
        def priority():
            return assess(r, None, 'Germany', 'Software', framework, date(2026, 9, 26))['priority']
        original = priority()
        r.signal_evidence[0].event_id = r.signal_evidence[1].event_id = 'same-handover'
        self.assertLess(priority(), original)
        r.signal_evidence[0].event_id = 'first'
        r.signal_evidence[1].event_id = 'second'
        framework.signals[0].signal_strength = 'weak'
        self.assertLess(priority(), original)
        framework.signals[0].signal_strength = 'strong'
        for c in r.signal_evidence[0].citations: c.published_at = '2020-01-01'
        self.assertLess(priority(), original)
        r.signal_evidence[0].structured_fields = ['employees']
        result = assess(r, None, 'Germany', 'Software', framework, date(2026, 9, 26))
        self.assertEqual(result['evidence'][0]['impact'], 0)
        self.assertLessEqual(assess(r, model(synthetic=True), 'Sweden', 'Software')['structured_weight'], .1)

    def test_missing_checklist_evidence_reduces_confidence(self):
        r = report()
        baseline = assess(r, None, 'Germany', 'Software')['score_breakdown']['confidence_value']
        r.data_gaps.extend(['more evidence missing'] * 10)
        self.assertLess(assess(r, None, 'Germany', 'Software')['score_breakdown']['confidence_value'], baseline)

    def test_template_uses_only_country_and_industry_placeholders(self):
        import re
        from app.services import prompts
        template = Path(prompts.__file__).with_name('regional_prompt.txt').read_text()
        self.assertEqual(set(re.findall(r'{{(.*?)}}', template)), {'region', 'industry'})
        rendered = prompts.phase1_user_prompt('Finland', 'Electronics')
        self.assertIn('Finland', rendered)
        self.assertIn('Electronics', rendered)
        self.assertNotIn('{{', rendered)


class MarketTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.settings = Settings(ALLOW_PAID_RESEARCH=True, OPENAI_API_KEY='offline-test-only', SOURCING_API_TOKEN='test-token', STORAGE_DIR=self.folder.name)
        self.recorded = RecordedClient()
        self.patches = [patch.object(m, 'get_settings', return_value=self.settings) for m in (auth, market, research_service, storage, openai_client, structured_model)]
        self.patches.append(patch.object(openai_client, 'get_client', return_value=self.recorded))
        for p in self.patches: p.start()
        market._jobs.clear()
        self.client = TestClient(app)
        self.headers = {'Authorization': 'Bearer test-token'}
        self.body = dict(country='Germany', industry='Industrial manufacturing')

    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        market._jobs.clear()
        self.folder.cleanup()

    def test_full_pipeline_propagates_market_and_reuses_one_job(self):
        # Only external transports are replaced. Prompts, discovery, verification,
        # structured client validation and final ranking execute normally.
        captured = []
        def java(request, timeout):
            inputs = json.loads(request.data)
            captured.append(inputs)
            result = model(2/11, synthetic=True)
            result.update(schemaVersion=1, companyId=inputs['id'], year=inputs['year'], probability=.02,
                          suppliedFields=['employees', 'revenueK'], missingFields=sorted(structured_model.FIELDS - {'employees', 'revenueK'}))
            from io import BytesIO
            return BytesIO(json.dumps(result).encode())
        with patch.object(structured_model, 'urlopen', side_effect=java), patch.object(research_service, 'cached_region', wraps=research_service.cached_region) as region, patch.object(research_service, 'cached_universe', wraps=research_service.cached_universe) as universe:
            started = self.client.post('/api/v1/investigate-market', headers=self.headers, json=self.body)
            self.assertEqual(started.status_code, 202, started.text)
            job_id = started.json()['id']
            duplicate = self.client.post('/api/v1/investigate-market', headers=self.headers, json=self.body).json()
            self.assertEqual(duplicate['id'], job_id)
            for _ in range(100):
                result = self.client.get('/api/v1/investigate-market/' + job_id, headers=self.headers).json()
                if result['status'] != 'running': break
                time.sleep(.02)
            self.assertEqual(result['status'], 'complete', result)
            self.assertEqual(self.recorded.calls, ['region', 'universe', 'company', 'verification'])
            region.assert_called_once_with('Germany', 'Industrial manufacturing')
            self.assertIn('Industrial manufacturing', universe.call_args.args[1])
            self.assertEqual(len(captured), 1)
            self.assertEqual(set(captured[0]), {'id', 'year', 'sector', 'employees', 'revenueK'})
            self.assertEqual(captured[0]['sector'], self.body['industry'])
            p = result['results'][0]
            self.assertEqual(p['company'], 'Integration Test Works')
            self.assertTrue(p['structured']['available'])
            self.assertEqual(p['structured']['supplied'], 2)
            self.assertEqual(p['contradiction_penalty'], -20)
            self.assertEqual(result['stages'], ['complete']*6)
            self.assertEqual(universe.call_args.args[2], 5)
            files = list(Path(self.folder.name).glob('reports/*/*.json'))
            self.assertEqual(len(files), 1)
            artifact = json.loads(files[0].read_text(encoding='utf-8'))
            self.assertEqual(artifact, p['report'])
            self.assertEqual(artifact['priority_score'], p['priority'])
            self.assertEqual(artifact['market_context']['industry'], self.body['industry'])
            self.assertTrue(artifact['contradictions'])
            self.assertTrue(artifact['structured_model']['synthetic_training'])
            self.assertNotIn('offline-test-only', files[0].read_text())

    def test_auth_strict_two_field_contract_and_unavailable_configuration(self):
        self.assertEqual(self.client.post('/api/v1/investigate-market', json=self.body).status_code, 401)
        self.assertEqual(self.client.post('/api/v1/investigate-market', headers=self.headers, json={**self.body, 'model':'bad'}).status_code, 422)
        self.assertEqual(self.client.get('/api/v1/investigate-market/missing', headers=self.headers).status_code, 404)
        self.settings.openai_api_key = ''
        self.assertEqual(self.client.post('/api/v1/investigate-market', headers=self.headers, json=self.body).status_code, 503)
        self.assertEqual(self.recorded.calls, [])

    def test_phase2_website_reaches_the_downloaded_report_with_safe_fallback(self):
        from app.models.schemas import CandidateCompany, Phase1Output
        company = CandidateCompany(name='Integration Test Works', website='https://discovery.example')
        framework = Phase1Output(region='Germany')
        researched = report()
        job_id = 'b' * 32
        for phase2, expected in [('https://company.example', 'https://company.example'),
                                 (None, company.website), ('javascript:alert(1)', company.website),
                                 ('https://user:secret@example.com', company.website)]:
            with self.subTest(phase2=phase2):
                researched.website = phase2
                result = market.persist_result(job_id, company, researched, None, framework, **self.body)
                self.assertEqual(result['report']['company']['website'], expected)
                artifact = Path(self.folder.name) / 'reports' / job_id / (result['report']['report_id'] + '.json')
                self.assertEqual(json.loads(artifact.read_text(encoding='utf-8')), result['report'])

    def test_worker_failure_is_clean_and_model_failure_is_public_only(self):
        job = dict(id='test', status='running')
        market._jobs['test'] = job
        with patch.object(research_service, 'cached_region', side_effect=RuntimeError('private transport detail')):
            market.run('test', **self.body)
        self.assertEqual(job['status'], 'error')
        self.assertNotIn('private', job['error'])
        with patch.object(structured_model, 'urlopen', side_effect=OSError('offline')):
            self.assertIsNone(structured_model.score(report(), 'Software'))


if __name__ == '__main__': unittest.main()
