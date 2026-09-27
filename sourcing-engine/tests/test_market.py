import json
import math
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
    def test_commercial_risk_alone_blocks_an_otherwise_permitted_draft(self):
        from app.models.schemas import MnaFinding, Citation
        r = report()
        baseline = assess(r, model(synthetic=True), 'Germany', 'Software')
        self.assertIsNotNone(baseline['outreach'])
        r.business_findings = [MnaFinding(dimension='risk', direction='negative',
            fact='The owner states that the business will remain independent.',
            citations=[Citation(url=r.retrieved_source_urls[0], excerpt='We will remain independent.', stance='supports')])]
        held = assess(r, model(synthetic=True), 'Germany', 'Software')
        self.assertFalse(held['contact'])
        self.assertIsNone(held['outreach'])
        self.assertIn('sourced risks', held['angle'])
        self.assertEqual(baseline['priority'], held['priority'])  # no arbitrary new score weights

    def test_score_is_traceable_and_missing_data_is_neutral(self):
        empty = Phase2Output(company_name='Nothing Known Oy', region='Finland')
        result = assess(empty, None, 'Finland', 'Software')
        self.assertEqual(result['priority'], 50)          # no information = a typical company, not zero
        self.assertEqual(result['confidence'], 'Low')
        r = report()
        result = assess(r, model(), 'Germany', 'Industrial manufacturing')
        total = sum(f['points'] for f in result['factors'])
        self.assertEqual(result['priority'], math.floor(max(0, min(100, 50 + total)) + .5))
        self.assertEqual(result['priority'], 84)          # three verified events (+49.1) minus one contradiction (-14.6)
        self.assertLess(result['contradiction_penalty'], 0)
        self.assertFalse(result['contact'])               # contradictions block contact
        self.assertEqual(assess(r, model(), 'Sweden', 'Industrial manufacturing')['priority'], result['priority'])

    def test_model_uses_only_observed_inputs_and_synthetic_effect_is_halved(self):
        contributions = [dict(feature='ownerAge', observedValue=71, imputed=False, logOdds=.8),
                         dict(feature='ownerOver62', observedValue=1, imputed=False, logOdds=.2),
                         dict(feature='firmAge', observedValue=None, imputed=True, logOdds=.5)]
        empty = Phase2Output(company_name='Registry Only AS', region='Norway')
        real = assess(empty, {**model(2/11), 'contributions': contributions}, 'Norway', 'Software')
        synthetic = assess(empty, {**model(2/11, synthetic=True), 'contributions': contributions}, 'Norway', 'Software')
        labels = [f['label'] for f in real['factors']]
        self.assertEqual(labels, ['Owner age'])           # imputed firm age contributes nothing
        self.assertAlmostEqual(real['factors'][0]['points'], 1.0 * 25 / math.log(2), places=6)
        self.assertAlmostEqual(synthetic['factors'][0]['points'], real['factors'][0]['points'] / 2, places=6)
        self.assertEqual(synthetic['structured_weight'], .5)
        self.assertIn('71 yrs', synthetic['why_now'])
        self.assertEqual(synthetic['conversation'], 'Succession')
        self.assertIsNone(synthetic['outreach'])           # registry facts alone never produce a draft

    def test_sector_and_official_record_factors_are_bounded_and_dated(self):
        from datetime import date
        from app.services.registries import RegistrySignal
        empty = Phase2Output(company_name='Registry Only SAS', region='France')
        sector = dict(available=True, owner_ratio=5.0, owner_share=.9, workforce_ratio=.5, workforce_share=.2, year='2025', source_url='https://ec.europa.eu')
        result = assess(empty, None, 'France', 'Software', sector=sector)
        owner = next(f for f in result['factors'] if f['label'] == 'Sector owner ageing')
        work = next(f for f in result['factors'] if f['label'] == 'Sector workforce ageing')
        self.assertAlmostEqual(owner['points'], math.log(1.4) * 25 / math.log(2), places=6)    # clamped
        self.assertLess(work['points'], 0)
        signal = lambda d: RegistrySignal(kind='leadership', label='Gazette change', detail='x', likelihood_ratio=1.35, quality=.9, date=d, source='https://bodacc.fr')
        fresh = assess(empty, None, 'France', 'Software', as_of=date(2026, 9, 1), registry_signals=[signal('2026-06-01')])['priority']
        stale = assess(empty, None, 'France', 'Software', as_of=date(2026, 9, 1), registry_signals=[signal('2023-10-01')])['priority']
        future = assess(empty, None, 'France', 'Software', as_of=date(2026, 9, 1), registry_signals=[signal('2027-01-01')])['priority']
        self.assertGreater(fresh, stale)
        self.assertGreater(stale, 50)
        self.assertEqual(future, 50)

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
        self.assertEqual(assess(r, model(synthetic=True), 'Sweden', 'Software')['structured_weight'], .5)

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
    def test_research_queue_prioritizes_observable_candidates_without_changing_scores(self):
        def candidate(name, priority, website=None, **profile):
            return dict(company=name, priority=priority, report=dict(company=dict(website=website,
                        registry_profile={"registry_id": name, **profile})))
        opaque = candidate('Opaque company', 98)
        visible = candidate('Observable company', 65, 'https://company.example', employees=80, revenue_eur=20000000)
        rows = market.research_candidates([opaque, visible], 1)
        self.assertEqual(rows, [visible])
        self.assertEqual(opaque['priority'], 98)
        self.assertEqual(visible['priority'], 65)

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.settings = Settings(ALLOW_PAID_RESEARCH=True, OPENAI_API_KEY='offline-test-only', SOURCING_API_TOKEN='test-token', STORAGE_DIR=self.folder.name)
        self.recorded = RecordedClient()
        self.patches = [patch.object(m, 'get_settings', return_value=self.settings) for m in (auth, market, research_service, storage, openai_client, structured_model)]
        self.patches.append(patch.object(openai_client, 'get_client', return_value=self.recorded))
        # Tests never reach the network: sector statistics are a separate, cached public source.
        self.patches.append(patch.object(market.sector_context, 'get', return_value=dict(available=False)))
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
            self.assertLess(p['contradiction_penalty'], 0)
            self.assertEqual(result['stages'], ['complete']*6)
            self.assertEqual(universe.call_args.args[2], 3)
            files = list(Path(self.folder.name).glob('reports/*/*.json'))
            self.assertEqual(len(files), 1)
            artifact = json.loads(files[0].read_text(encoding='utf-8'))
            self.assertEqual(artifact, p['report'])
            self.assertEqual(artifact['priority_score'], p['priority'])
            self.assertEqual(artifact['market_context']['industry'], self.body['industry'])
            self.assertTrue(artifact['contradictions'])
            self.assertTrue(artifact['structured_model']['synthetic_training'])
            self.assertEqual(len(artifact['mna_assessment']), 7)
            quality = next(c for c in artifact['mna_assessment'] if c['dimension'] == 'business_quality')
            self.assertTrue(any('recurring maintenance' in f['fact'] for f in quality['findings']))
            self.assertEqual(artifact['contact_routes'][0]['email'], 'jane@company.example')
            self.assertEqual(artifact['research_summary'], 'Recorded investigation, not real research')
            self.assertNotIn('offline-test-only', files[0].read_text())
            # A process restart can replay the complete job without paid calls or Java.
            market._jobs.clear()
            self.settings.openai_api_key = ''
            with patch.object(market._worker, 'submit') as submit:
                replay = market.start(**self.body)
                self.assertEqual(replay['id'], job_id)
                self.assertEqual(replay['results'], result['results'])
                self.assertTrue(replay['cache_hit'])
                submit.assert_not_called()
            self.assertEqual(len(captured), 1)
            self.assertEqual(self.recorded.calls, ['region', 'universe', 'company', 'verification'])

    def test_completed_cache_rejects_expired_invalid_and_other_markets(self):
        path = market.completed_path(**self.body)
        for content in ('broken json', json.dumps({'created':time.time()-25*3600, 'job':{}}),
                        json.dumps({'created':time.time(), 'job':{'status':'running'}}),
                        json.dumps({'created':time.time(), 'job':{'status':'complete', 'results':[
                            {'report':{'verification_complete':True, 'structured_model':None}}]}})):
            path.write_text(content, encoding='utf-8')
            self.assertIsNone(market.load_completed(**self.body))
        self.assertNotEqual(path, market.completed_path('France', self.body['industry']))

    def test_model_timeout_cooldown_and_recovery_are_bounded(self):
        with patch.object(structured_model, 'urlopen', side_effect=TimeoutError('offline')) as request, \
             patch.object(structured_model, 'monotonic', return_value=100):
            self.assertIsNone(structured_model.score(report(), 'Software'))
            self.assertIsNone(structured_model.score(report(), 'Software'))
            self.assertEqual(request.call_count, 1)
            self.assertEqual(request.call_args.kwargs['timeout'], 8)
        with patch.object(structured_model, 'urlopen', side_effect=TimeoutError('offline')) as request, \
             patch.object(structured_model, 'monotonic', return_value=161):
            self.assertIsNone(structured_model.score(report(), 'Software'))
            self.assertEqual(request.call_count, 1)  # eligible to recover after 60s

    def test_registry_market_skips_discovery_and_merges_official_facts(self):
        from app.services import quick_search, registries
        from app.services.registries import RegistryCompany, RegistrySignal
        profile = RegistryCompany(registry="Test registry", registry_id="42", name="Integration Test Works", country="Germany",
                                  industry="Industrial manufacturing", source_url="https://registry.example/42", website="https://company.example",
                                  founded="1975-01-01", employees=80,
                                  signals=[RegistrySignal(kind="leadership", label="Gazette management change", detail="Filed change",
                                                          likelihood_ratio=1.35, quality=.9, date="2026-05-01", source="https://gazette.example/1")])
        screen = dict(results=[dict(company=profile.name, report=dict(company=dict(registry_profile={"registry_id": "42"}, registry_id="42",
                                                                               website=profile.website, discovery_source=profile.source_url)))])
        prompts = []
        original = self.recorded.create
        def capture(**kwargs):
            prompts.append(kwargs["input"][1]["content"])
            return original(**kwargs)
        with patch.object(registries, 'supported', return_value=True), patch.object(quick_search, 'run', return_value=screen), \
             patch.object(quick_search, 'profile', return_value=profile), patch.object(self.recorded, 'create', side_effect=capture), \
             patch.object(structured_model, 'urlopen', side_effect=OSError('java offline')):
            job = market.start('Germany', 'Industrial manufacturing')
            for _ in range(200):
                job = market.snapshot(job['id'])
                if job['status'] != 'running': break
                time.sleep(.02)
        self.assertEqual(job['status'], 'complete', job)
        self.assertEqual(self.recorded.calls, ['region', 'company', 'verification'])   # no paid discovery call
        self.assertTrue(any('ALREADY KNOWN FROM THE OFFICIAL REGISTRY' in p for p in prompts))
        [result] = job['results']
        facts = {f['field']: f for f in result['report']['structured_facts']}
        self.assertEqual(facts['employees']['sources'], ['https://registry.example/42'])   # registry value wins over researched 120
        self.assertEqual(facts['revenueK']['value'], 24000)                               # researched fact fills the registry gap
        self.assertIn('Gazette management change', [f['label'] for f in result['factors']])
        self.assertEqual(result['report']['company']['registry_profile']['registry_id'], '42')
        self.assertFalse(market.completed_path(**self.body).exists())  # model outage must not become a 24h replay
        market._jobs[job['id']]['_finished'] -= 61
        with patch.object(market._worker, 'submit') as submit:
            retried = market.start(**self.body)
            self.assertNotEqual(retried['id'], job['id'])
            submit.assert_called_once()

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
