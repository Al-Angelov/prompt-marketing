# Mergero sourcing and investigation service

FastAPI owns the complete market workflow: country/industry → cached regional research → bounded private-company discovery → company research → separate verification → sourced structured extraction → existing Java model → deterministic priority → persisted company JSON → ranked results.

The LLM gathers and classifies evidence. `services/assessment.py` calculates all final priorities. See [exact scoring](../docs/SCORING.md) and [deployment](../docs/DEPLOYMENT.md).

## Run

Install `requirements.txt` into a virtual environment. Set these only on the Python host or in its untracked `.env`:

- `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-4o`)
- `ENABLE_WEB_SEARCH=true`, `ALLOW_PAID_RESEARCH=true`
- `SOURCING_API_TOKEN`, `REQUIRE_API_TOKEN=true`
- `MODEL_API_URL` (default `http://localhost:8080`) and matching `MODEL_API_TOKEN`
- `STORAGE_DIR` (default `storage`), `MARKET_CANDIDATE_LIMIT=5`

Run `uvicorn app.main:app --port 8000 --workers 1`. The main browser uses only the same-origin `/api/investigate-market` gateway: POST starts one investigation; GET with `?job=<id>` polls it. Frontend stages reflect backend work.

## Contracts and artifacts

`POST /api/v1/investigate-market` accepts exactly `{country, industry}`. `GET /api/v1/investigate-market/{id}` returns progress/results. Every `/api/v1/*` route requires the sourcing bearer token. `/health` is public and reports configuration only, not successful provider access.

Final `CompanyReport` artifacts are written atomically to `STORAGE_DIR/reports/<job-id>/<report-id>.json`. They include market context, evidence, contradictions, structured facts/conflicts, Java output and nullable inputs, final priority, exact score breakdown, sources, gaps and generation time. The same JSON is embedded as each opportunity's `report`; the frontend expands it and offers a download. Failed company attempts retain explicit empty-evidence reports and warnings instead of fabricated companies.

Preserved specialist APIs (`/research/region`, `/research/company`, `/sourcing/universe`, `/reports/company/{slug}` under `/api/v1`) expose intermediate research, not a second final-scoring workflow. Raw company artifacts under `companies/` and regional artifacts under `regions/` remain intermediate diagnostics; use the final reports for scored audits.

Regional frameworks cache for 168 hours, company evidence and discovery for 24 hours. Keys include model, pipeline revision and market identity. Incomplete company verification is not cached. Market starts are deduplicated within one process for one hour. Report IDs include company, website, country and industry and are scoped to a job. Jobs do not survive restart and multiple workers are unsupported. Free Render filesystems are temporary: attach persistent storage or download reports; do not treat files as permanent without a durable volume.

## Evidence integrity

Required web search gathers a source brief and actual retrieved URLs. Separate schema-constrained extraction cannot add retrieved provenance. Local Pydantic checks still validate results. Separate searches cross-check dates, exact claims, original publishers and counter-evidence; syndicated copies are not independent. Unknown facts stay missing. Conflicting structured values are retained for audit and withheld from Java. Numeric/ownership facts and linked structured claims get no public timing points. Public professional information only; no private-life, health, political or mental-state inference, or social likes as sale intent.

Java scoring requires at least two usable sourced/dated fields. Java outage produces a public-only score with reduced confidence. Default training is synthetic and its priority influence is capped. Research failures never fall back to test fixtures in production.

Run `python -m unittest discover -s tests -v` (TestClient requires `httpx`). The isolated `tests/serve_recorded.py` harness substitutes only provider transport and is excluded from Docker. See deployment docs for the full browser/Python/Java integration check.
