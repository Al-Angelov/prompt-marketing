# Mergero sourcing and investigation service

FastAPI owns the complete market workflow: country/industry → cached regional research → bounded private-company discovery → company research → separate verification → sourced structured extraction → existing Java model → deterministic priority → persisted company JSON → ranked results.

The LLM gathers and classifies evidence. `services/assessment.py` calculates all final priorities. See [exact scoring](../docs/SCORING.md) and [deployment](../docs/DEPLOYMENT.md).

## Run

Install `requirements.txt` into a virtual environment. Set these only on the Python host or in its untracked `.env`:

- `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-5.4-mini`)
- `ENABLE_WEB_SEARCH=true`, `ALLOW_PAID_RESEARCH=true`
- `SOURCING_API_TOKEN`, `REQUIRE_API_TOKEN=true`
- `MODEL_API_URL` (default `http://localhost:8080`) and matching `MODEL_API_TOKEN`
- `STORAGE_DIR` (default `storage`), `MARKET_CANDIDATE_LIMIT=3` (companies that get deep research)
- `QUICK_SEARCH_LIMIT=30`, `QUICK_CACHE_HOURS=24` (registry screen size and cache)
- `OPENAI_EXTRACT_MODEL` (optional cheaper model for the JSON extraction step; default `OPENAI_MODEL`)
- `RESEARCH_MAX_TOOL_CALLS=6`, `RESEARCH_MAX_OUTPUT_TOKENS=12000` bound each search request and each response respectively; extraction has no search tools. These are per-request ceilings, not a dollar budget. Truncated results fail visibly rather than triggering another paid retry. See [OpenAI's request contract](https://developers.openai.com/api/reference/python/resources/responses/methods/create).
- `MODEL_TIMEOUT_SECONDS=8`; a failed Java request opens a 60-second cooldown, and successful identical scores are reused for five minutes. A missing score remains explicitly unavailable.

## Registry-first quick search (no LLM calls)

`POST /api/v1/quick-search` with `{country, industry}` returns a ranked screen of real companies from free official registries. Cached screens avoid registry/model work; cold searches depend on registry and hosting availability. The shape matches an investigation job, so the UI treats both the same way.

| Country | Source (keyless, open licence) | Data used |
|---|---|---|
| Norway | data.brreg.no: entity register, roles, accounts register | headcount, founding date, website, CEO/board birth year, auditor, revenue, EBIT, liabilities/assets |
| France | recherche-entreprises.api.gouv.fr and the BODACC gazette API | founding date, headcount band, director birth year, revenue history, dated management/capital changes |
| Finland | avoindata.prh.fi (YTJ v3) | founding date and industry (Finnish open data has no headcount, officers or accounts) |
| All | Eurostat LFS `lfsa_esgan2`, `lfsa_egan2` | owner and workforce ageing by country and sector |

Registry facts reach the Java model as sourced, dated inputs. For registry countries, deep research uses the top quick-screen candidates instead of LLM discovery, which saves 2 paid calls per market. It passes the known registry facts into the prompt, so searches focus on news and events, and it researches companies in parallel. Only officers' birth years are stored, never names. Registry calls are cached on disk, retried with backoff, and degrade to missing fields rather than failing.

Warm the demo markets before presenting: `.venv/bin/python scripts/warm_demo.py` (free), and add `--deep` to also pre-run paid deep research.

Run `uvicorn app.main:app --port 8000 --workers 1`. The main browser uses only the same-origin `/api/investigate-market` gateway: POST starts one investigation; GET with `?job=<id>` polls it. Frontend stages reflect backend work.

## Contracts and artifacts

`POST /api/v1/investigate-market` accepts exactly `{country, industry}`. `GET /api/v1/investigate-market/{id}` returns progress/results. Every `/api/v1/*` route requires the sourcing bearer token. `/health` is public and reports configuration only, not successful provider access.

Final `CompanyReport` artifacts are written atomically to `STORAGE_DIR/reports/<job-id>/<report-id>.json`. They include market context, evidence, contradictions, structured facts/conflicts, Java output and nullable inputs, final priority, exact score breakdown, sources, gaps and generation time. The same JSON is embedded as each opportunity's `report`; the frontend expands it and offers a download. Failed company attempts retain explicit empty-evidence reports and warnings instead of fabricated companies.

Preserved specialist APIs (`/research/region`, `/research/company`, `/sourcing/universe`, `/reports/company/{slug}` under `/api/v1`) expose intermediate research, not a second final-scoring workflow. Raw company artifacts under `companies/` and regional artifacts under `regions/` remain intermediate diagnostics; use the final reports for scored audits.

Regional frameworks cache for 168 hours, company evidence and discovery for 24 hours. Keys include model, pipeline revision and market identity. Incomplete company verification is not cached. Market starts are deduplicated within one process for one hour. Completed markets with verified research and no failed candidates are also cached for `COMPANY_CACHE_HOURS`, retaining the original report dates and replaying without research or Java requests after restart. Invalid or expired caches are ignored. Report IDs include company, website, country and industry and are scoped to a job. Running jobs do not survive restart and multiple workers are unsupported. Free Render filesystems are temporary: attach persistent storage or export the browser library; do not treat files as permanent without a durable volume.

## Evidence integrity

Required web search gathers a source brief and actual retrieved URLs. Separate schema-constrained extraction cannot add retrieved provenance. Local Pydantic checks still validate results. Separate searches cross-check dates, exact claims, original publishers and counter-evidence; syndicated copies are not independent. Unknown facts stay missing. Conflicting structured values are retained for audit and withheld from Java. Numeric/ownership facts and linked structured claims get no public timing points. Public professional information only; no private-life, health, political or mental-state inference, or social likes as sale intent.

Java scoring requires at least two usable sourced/dated fields. Java outage produces a public-only score with reduced confidence. Default training is synthetic and its priority influence is capped. Research failures never fall back to test fixtures in production.

Run `python -m unittest discover -s tests -v` (TestClient requires `httpx`). The isolated `tests/serve_recorded.py` harness substitutes only provider transport and is excluded from Docker. See deployment docs for the full browser/Python/Java integration check.

## Troubleshooting logs

Operator-only; never shown to users. Two rotating JSON-lines files (5 MB x 5) in
`LOG_DIR`, default `STORAGE_DIR/logs`:

- `activity.log`: everything the service does. Each OpenAI call (stage, model,
  duration, status, source count), each market-job stage, Java scoring, requests.
- `errors.log`: warnings and errors only, with full tracebacks, OpenAI's own
  HTTP status and error message, and the start of any unparseable model output.

Every line has a `trace`: `req-…` for an HTTP request, `job-…` for a market job.
Follow one run with `grep '"trace": "job-…"' activity.log`. The OpenAI key and
bearer tokens are masked before anything is written.

On a host without a shell (Render free), read them with the service token:

```sh
curl -H "Authorization: Bearer $SOURCING_API_TOKEN" \
  "https://<python-service>/api/v1/diagnostics/logs?file=errors&lines=200"
# file=activity, and &trace=job-… to follow a single run
```

The Vercel site has no route to this endpoint. Free Render disks are ephemeral:
logs reset on restart/redeploy unless a persistent disk is mounted at `/app/storage`.
