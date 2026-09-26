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
        self.assertFalse(result['contact'])
        self.assertIsNone(result['outreach'])
        for e in r.signal_evidence:
            e.kind = 'structured_context'
        self.assertIsNone(assess(r, model(), 'Germany', 'Software')['priority'])

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


class MarketTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.settings = Settings(OPENAI_API_KEY='offline-test-only', SOURCING_API_TOKEN='test-token', STORAGE_DIR=self.folder.name)
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

    def test_auth_strict_two_field_contract_and_unavailable_configuration(self):
        self.assertEqual(self.client.post('/api/v1/investigate-market', json=self.body).status_code, 401)
        self.assertEqual(self.client.post('/api/v1/investigate-market', headers=self.headers, json={**self.body, 'model':'bad'}).status_code, 422)
        self.assertEqual(self.client.get('/api/v1/investigate-market/missing', headers=self.headers).status_code, 404)
        self.settings.openai_api_key = ''
        self.assertEqual(self.client.post('/api/v1/investigate-market', headers=self.headers, json=self.body).status_code, 503)
        self.assertEqual(self.recorded.calls, [])

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
