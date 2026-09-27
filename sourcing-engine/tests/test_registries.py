"""Registry adapters, the HTTP helper and the quick screen, fully offline."""
import io
import json
import tempfile
import unittest
from datetime import date
from unittest.mock import patch
from urllib.error import HTTPError

from fastapi.testclient import TestClient

from app import auth
from app.config import Settings
from app.main import app
from app.services import quick_search, sector_context, storage, structured_model
from app.services.registries import RegistryCompany, finland, france, http, norway
from app.services.registries.http import RegistryUnavailable


class Offline(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.settings = Settings(SOURCING_API_TOKEN='test-token', STORAGE_DIR=self.folder.name, QUICK_SEARCH_LIMIT=5)
        self.patches = [patch.object(m, 'get_settings', return_value=self.settings) for m in (auth, http, storage, structured_model, quick_search)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.folder.cleanup()


def role(code, first=None, last=None, born=None, entity=None):
    value = dict(type=dict(kode=code), fratraadt=False)
    if entity:
        value["enhet"] = dict(navn=[entity])
    else:
        value["person"] = dict(navn=dict(fornavn=first, etternavn=last), fodselsdato=born)
    return value


class NorwayTest(Offline):
    def fake(self, roles, accounts):
        def get_json(url, params=None, **kwargs):
            if url.endswith("/roller"):
                return dict(rollegrupper=[dict(roller=roles)])
            if "regnskap" in url:
                if isinstance(accounts, Exception):
                    raise accounts
                return accounts
            return dict(page=dict(totalPages=1), _embedded=dict(enheter=[
                dict(organisasjonsnummer="912345678", navn="FJORD VERK AS", antallAnsatte=40, stiftelsesdato="1979-03-01",
                     naeringskode1=dict(kode="25.620"), hjemmeside="www.fjordverk.no")]))
        return patch.object(norway, "get_json", side_effect=get_json)

    def test_search_enrich_and_sourced_facts(self):
        roles = [role("DAGL", "Kari", "Nordmann", "1956-04-02"), role("LEDE", "Kari", "Nordmann", "1956-04-02"),
                 role("MEDL", "Ola", "Hansen", "1970-01-01"), role("REVI", entity="KPMG AS")]
        accounts = [dict(regnskapsperiode=dict(tilDato="2024-12-31"), valuta="NOK",
                         resultatregnskapResultat=dict(driftsresultat=dict(driftsresultat=11_700_000, driftsinntekter=dict(sumDriftsinntekter=117_000_000))),
                         egenkapitalGjeld=dict(sumEgenkapitalGjeld=50_000_000, gjeldOversikt=dict(sumGjeld=20_000_000)))]
        with self.fake(roles, accounts):
            [company] = norway.search("Industrial manufacturing", 5)
            company = norway.enrich(company)
        self.assertEqual(company.website, "https://www.fjordverk.no")
        self.assertFalse(company.family_indicator)              # one person holding two roles is not a family
        self.assertEqual(company.owner_age, date.today().year - 1956)
        self.assertAlmostEqual(company.revenue_eur, 10_000_000)
        self.assertAlmostEqual(company.operating_margin, .1)
        self.assertAlmostEqual(company.leverage, .4)
        self.assertEqual([s.label for s in company.signals], ["Big-4 auditor at a small company"])
        facts = {f.field: f for f in company.structured_facts()}
        self.assertEqual(set(facts), {"foundedYear", "employees", "revenueK", "leverage", "ownerAge"})
        self.assertTrue(all(f.sources == ["https://virksomhet.brreg.no/nb/oppslag/enheter/912345678"] for f in facts.values()))
        self.assertEqual(facts["revenueK"].as_of, "2024-12-31")
        self.assertNotIn("Nordmann", json.dumps(company.model_dump()))   # names are never stored

    def test_shared_surname_and_unavailable_accounts(self):
        roles = [role("DAGL", "Kari", "Berg", "1960-01-01"), role("MEDL", "Per", "Berg", "1990-01-01")]
        with self.fake(roles, RegistryUnavailable("data.brreg.no answered HTTP 503")):
            [company] = norway.search("Industrial manufacturing", 5)
            company = norway.enrich(company)
        self.assertTrue(company.family_indicator)
        self.assertIsNone(company.revenue_eur)
        self.assertIn("503", company.notes[0])

    def test_negative_equity_is_flagged_not_scored(self):
        accounts = [dict(regnskapsperiode=dict(tilDato="2024-12-31"), valuta="NOK",
                         resultatregnskapResultat=dict(driftsresultat=dict(driftsresultat=-1, driftsinntekter=dict(sumDriftsinntekter=11_700_000))),
                         egenkapitalGjeld=dict(sumEgenkapitalGjeld=1_000_000, gjeldOversikt=dict(sumGjeld=3_000_000)))]
        with self.fake([], accounts):
            [company] = norway.search("Industrial manufacturing", 5)
            company = norway.enrich(company)
        self.assertAlmostEqual(company.leverage, 3.0)
        self.assertNotIn("leverage", {f.field for f in company.structured_facts()})
        self.assertIn("possible financial distress", company.notes[0])


class FranceTest(Offline):
    def test_result_parsing_and_gazette_events(self):
        result = dict(siren="123456789", nom_complet="ATELIERS DUPONT", date_creation="1985-01-01", tranche_effectif_salarie="12",
                      activite_principale="25.62B", finances={"2021": dict(ca=8_000_000, resultat_net=1), "2024": dict(ca=10_648_000, resultat_net=532_400)},
                      dirigeants=[dict(type_dirigeant="personne physique", nom="DUPONT", prenoms="Jean", annee_de_naissance="1958", qualite="Président de SAS"),
                                  dict(type_dirigeant="personne physique", nom="DUPONT", prenoms="Marie", annee_de_naissance="1988", qualite="Directeur général"),
                                  dict(type_dirigeant="personne morale", nom=None, qualite="Commissaire aux comptes")])
        company = france._from_result(result, "Industrial manufacturing")
        self.assertEqual(company.employees, 34.5)
        self.assertTrue(company.family_indicator)
        self.assertEqual(company.owner_age, date.today().year - 1958)
        self.assertAlmostEqual(company.revenue_growth, .1, places=3)
        self.assertAlmostEqual(company.net_margin, .05)
        recent = (date.today().replace(day=1)).isoformat()
        gazette = dict(results=[
            dict(id="B1", dateparution=recent, familleavis_lib="Modifications diverses", modificationsgenerales='{"descriptif": "Modification de l\'administration."}', url_complete="https://www.bodacc.fr/a"),
            dict(id="B2", dateparution=recent, familleavis_lib="Modifications diverses", modificationsgenerales='{"descriptif": "Modification du capital."}', url_complete="https://www.bodacc.fr/b"),
            dict(id="B3", dateparution=recent, familleavis_lib="Dépôts des comptes", modificationsgenerales=None)])
        with patch.object(france, "get_json", return_value=gazette):
            france.enrich(company)
        self.assertEqual([(s.kind, s.source) for s in company.signals], [("leadership", "https://www.bodacc.fr/a"), ("liquidity", "https://www.bodacc.fr/b")])


class FinlandTest(Offline):
    def test_substring_matches_are_dropped(self):
        record = lambda bid, code, **extra: dict(businessId=dict(value=bid), names=[dict(name=bid)], mainBusinessLine=dict(type=code),
                                                 registrationDate="2001-01-01", companySituations=[], **extra)
        page = dict(totalResults=3, companies=[record("1-1", "62010"), record("2-2", "46462"), record("3-3", "62020", endDate="2020-01-01")])
        with patch.object(finland, "get_json", return_value=page):
            companies = finland.search("Software", 10)
        self.assertEqual([c.registry_id for c in companies], ["1-1"])


class HttpTest(Offline):
    def test_retries_then_caches_and_maps_404(self):
        calls = []
        def urlopen(request, timeout):
            calls.append(request.full_url)
            if len(calls) == 1:
                raise HTTPError(request.full_url, 503, "busy", {}, None)
            return io.BytesIO(b'{"ok": true}')
        with patch.object(http, "urlopen", side_effect=urlopen), patch.object(http.time, "sleep"):
            self.assertEqual(http.get_json("https://registry.example/x", {"a": 1}), {"ok": True})
            self.assertEqual(http.get_json("https://registry.example/x", {"a": 1}), {"ok": True})
        self.assertEqual(len(calls), 2)                      # one retry, then served from the disk cache
        with patch.object(http, "urlopen", side_effect=HTTPError("u", 404, "missing", {}, None)):
            self.assertEqual(http.get_json("https://registry.example/missing", not_found=[]), [])
        with patch.object(http, "urlopen", side_effect=HTTPError("u", 503, "busy", {}, None)), patch.object(http.time, "sleep"):
            with self.assertRaises(RegistryUnavailable):
                http.get_json("https://registry.example/down", cache_hours=0)


class QuickSearchTest(Offline):
    def companies(self):
        young = RegistryCompany(registry="Test registry", registry_id="1", name="Young Tech AS", country="Norway", industry="Software",
                                source_url="https://registry.example/1", founded="2019-01-01", employees=20)
        old = RegistryCompany(registry="Test registry", registry_id="2", name="Old Family AS", country="Norway", industry="Software",
                              source_url="https://registry.example/2", founded="1970-01-01", employees=60)
        return [young, old]

    def java(self, request, timeout):
        inputs = json.loads(request.data)
        supplied = sorted(structured_model.FIELDS & set(inputs))
        older = inputs.get("foundedYear", 2020) < 2000
        return io.BytesIO(json.dumps(dict(
            schemaVersion=1, companyId=inputs["id"], year=inputs["year"], status="scored", probability=.03 if older else .01,
            percentile=80 if older else 20, coverage=len(supplied) / 11, suppliedFields=supplied, missingFields=sorted(structured_model.FIELDS - set(supplied)),
            contributions=[dict(feature="firmAge", observedValue=50 if older else 7, imputed=False, logOdds=.6 if older else -.3)],
            metadata=dict(syntheticTraining=True, trainingBaseRate=.015))).encode())

    def test_screen_ranks_caches_and_serves_the_api(self):
        search = patch.object(norway, "search", return_value=self.companies())
        enrich = patch.object(norway, "enrich", side_effect=lambda c: c)
        sector = patch.object(sector_context, "get", return_value=dict(available=False))
        java = patch.object(structured_model, "urlopen", side_effect=self.java)
        with search as searched, enrich, sector, java:
            client = TestClient(app)
            headers = {"Authorization": "Bearer test-token"}
            first = client.post("/api/v1/quick-search", headers=headers, json=dict(country="Norway", industry="Software"))
            self.assertEqual(first.status_code, 200, first.text)
            job = first.json()
            self.assertEqual([r["company"] for r in job["results"]], ["Old Family AS", "Young Tech AS"])
            self.assertGreater(job["results"][0]["priority"], 50)
            self.assertLess(job["results"][1]["priority"], 50)
            self.assertEqual(job["results"][0]["report"]["company"]["registry_profile"]["registry_id"], "2")
            self.assertEqual(job["mode"], "quick")
            self.assertRegex(job["id"], "^[a-f0-9]{32}$")
            again = client.post("/api/v1/quick-search", headers=headers, json=dict(country="Norway", industry="Software")).json()
            self.assertTrue(again["cache_hit"])
            self.assertEqual(searched.call_count, 1)
            self.assertIsNotNone(quick_search.profile("Norway", "2"))
            self.assertEqual(client.post("/api/v1/quick-search", headers=headers, json=dict(country="Germany", industry="Software")).status_code, 404)
            self.assertEqual(client.post("/api/v1/quick-search", json=dict(country="Norway", industry="Software")).status_code, 401)

    def test_scoring_reuses_identical_inputs_but_expires_and_returns_independent_values(self):
        report = quick_search.registry_report(self.companies()[0], 'Norway')
        with patch.object(structured_model, 'urlopen', side_effect=self.java) as request, \
             patch.object(structured_model, 'monotonic', return_value=100):
            first = structured_model.score(report, 'Software')
            first['percentile'] = -999
            second = structured_model.score(report, 'Software')
            self.assertEqual(second['percentile'], 20)
            self.assertEqual(request.call_count, 1)
        with patch.object(structured_model, 'urlopen', side_effect=self.java) as request, \
             patch.object(structured_model, 'monotonic', return_value=401):
            self.assertEqual(structured_model.score(report, 'Software')['percentile'], 20)
            self.assertEqual(request.call_count, 1)


if __name__ == "__main__":
    unittest.main()
