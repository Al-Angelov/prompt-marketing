# Mergero Regional M&A Sourcing Engine — Full Project Context

> **Audience:** an AI agent (or engineer) that needs complete context to work on
> this service without re-reading every file first. This document describes the
> *current* state of the code as it actually is, including the design intent and
> the safety invariants that must not be broken.
>
> **Location:** `sourcing-engine/` inside the `prompt-marketing` repo. It is a
> self-contained Python backend and shares nothing with the marketing site or the
> Java `data-analysis` module that also live in the repo.

---

## 1. What this service is

A FastAPI backend that runs a **two-phase, regionally-grounded "sell-signal"
research pipeline** on top of OpenAI, for M&A deal sourcing.

- **Phase 1 (per region):** research *what actually drives a private-company owner
  in a given region* to consider  a transaction (succession, liquidity, minority
  investment, growth capital, strategic partner, or full exit) in the next 1–3
  years. Output: a structured checklist of region-specific signals.
- **Phase 2 (per company):** take Phase 1's checklist plus one company and gather
  whatever **public, source-cited evidence** exists for each signal. Output: one
  structured evidence file per company.
- **Phase 0 (optional):** source a candidate list of private companies for a region
  from business registries/directories, to feed Phase 2.
- **Market investigation (async orchestration):** a bounded background job that chains
  region → universe → per-company investigation → external structured scoring →
  assessment/prioritization, and returns ranked, outreach-ready results (see §9).

### The single most important design rule
**The research/evidence layer only gathers and structures evidence — it never scores,
ranks, or infers owner intent.** The Phase 1/Phase 2 extraction and verification code
(`research_service.py`, `verification.py`, `prompts.py`) must never emit a likelihood
score, ranking, or "will sell / buy-pass" recommendation. Operating events are never
treated as proof an owner wants to sell.

Prioritization does exist, but it is a **separate downstream layer** (`structured_model.py`
+ `assessment.py`), driven by an **external Java scoring API** and an explicitly
uncalibrated policy formula. It is labelled throughout as *"an uncalibrated research
priority, never owner willingness to sell."* Keep this separation intact: do not move
scoring into the evidence extraction, and do not relabel the priority as a probability
of selling. This matches the original "MGX Deal Engine is downstream" framing — the
scoring engine is simply reachable from this service via the market workflow.

### Three global constraints (enforced in every prompt and in code)
1. **Public professional context only** — never collect or infer an individual's
   private life, health, political views, or family situation. GDPR: all target
   regions are EU/EEA and leadership names/profiles are personal data even when public.
2. **No score calculation** — evidence only (see above).
3. **Grounding** — every evidence item needs real source URLs that were actually
   retrieved by a web search. If there is no public evidence, the signal becomes a
   `data_gap` with `evidence_found = null`. Un-grounded model knowledge is *never*
   allowed to masquerade as researched evidence.

---

## 2. Tech stack & runtime

| Concern | Choice |
|---|---|
| Language | Python 3.11+ (Docker image pins **3.12-slim**; local dev has been run on 3.14) |
| Web framework | FastAPI |
| Validation | Pydantic v2 + `pydantic-settings` |
| LLM SDK | `openai` (Responses API primary, Chat Completions fallback path exists) |
| Config | `python-dotenv` + `pydantic-settings`, from a local `.env` |
| Server | `uvicorn` (single worker) |
| Persistence | Local JSON files under `storage/` (no database) |
| Container | `Dockerfile` (non-root user, `/app/storage`) |
| Tests | `unittest` + FastAPI `TestClient`, fully offline via a recorded transport |

### Pinned dependency versions (`requirements.txt`)
```
fastapi==0.141.1
uvicorn[standard]==0.54.0
pydantic==2.13.5
pydantic-settings==2.15.0
openai==3.19.2
python-dotenv==1.2.3
```
Versions are pinned deliberately ("Tested application dependency versions; no new
runtime packages"). Prefer not to add runtime dependencies without a reason.

---

## 3. Directory layout

```
sourcing-engine/
├── app/
│   ├── main.py                  # FastAPI app, router registration, /health, /
│   ├── config.py                # Settings (.env) + structured logging
│   ├── auth.py                  # Server-to-server bearer-token dependency
│   ├── models/
│   │   └── schemas.py           # All Pydantic v2 models + request bodies
│   ├── routers/
│   │   ├── research.py          # /api/v1/research/*, /sourcing/universe, /reports/*
│   │   └── market.py            # /api/v1/investigate-market (async jobs)
│   └── services/
│       ├── openai_client.py     # OpenAI wrapper: grounded Responses + provenance
│       ├── prompts.py           # Phase 0/1/2 + verification prompt templates
│       ├── research_service.py  # Pipeline orchestration + caching + hardening
│       ├── verification.py      # Independent cross-check / corroboration layer
│       ├── storage.py           # Atomic JSON persistence, slugging, cache paths
│       ├── market.py            # Async market-investigation job runner (background thread)
│       ├── structured_model.py  # Client for the external Java /api/score model
│       └── assessment.py        # Priority/confidence policy + outreach drafting
├── tests/
│   ├── recorded_client.py       # Offline OpenAI transport fixture (NOT live data)
│   ├── serve_recorded.py        # Local integration harness on :8001 (offline)
│   ├── test_api.py              # End-to-end HTTP tests through TestClient
│   ├── test_integrity.py        # Safety-invariant unit tests
│   └── test_market.py           # Market workflow + assessment/scoring policy tests
├── storage/                     # Generated artifacts (gitignored): regions/, companies/, cache/
├── Dockerfile
├── .dockerignore                # excludes .env*, .venv, storage, tests, .git, __pycache__
├── .gitignore
├── requirements.txt
├── README.md                    # human quickstart
└── details.md                   # this file
```

> Note: there is no `.env.example` currently; a live `.env` exists locally and is
> gitignored/dockerignored. Create `.env` from the variables in §5.

---

## 4. Request lifecycle (how a company investigation actually flows)

`POST /api/v1/research/company` → `research.research_company()` →
`research_service.investigate_company()`:

1. **Auth** — router has `Depends(require_token)`; a valid `Authorization: Bearer
   <SOURCING_API_TOKEN>` is required (see §6).
2. **Validation** — `CompanyResearchRequest` enforces length bounds; website must
   be a public HTTP(S) URL.
3. **Cache** (`_cached`) — a process-wide `RLock` serializes work (one worker per
   container; prevents duplicate paid calls from double-clicks). Cache key includes
   schema version (2), model name, region, company identity. Fresh, grounded,
   schema-v2 cache hits are returned with `cache_hit=true`.
4. **Phase 1 dependency** — `cached_region(region)` produces/loads the regional
   framework. If Phase 2 is called with no regional framework available it raises
   `Phase1NotFoundError` → HTTP 409.
5. **Phase 2 extraction** — `research_company_signals()` calls the model, validates
   against `Phase2Output`, and **hardens** the result (see §8).
6. **Verification** — `verify_report()` runs a *separate* web-search cross-check and
   assigns per-claim `verification_status`. Verification is owned by the verifier;
   extraction can never self-declare "verified".
7. **Persist** — atomic write to `storage/companies/{slug}_{region}_signals.json`,
   plus the durable cache envelope (only when verification completed).

Phase 1 and Phase 0 follow the same cache/lock pattern via `cached_region` and
`cached_universe`. `investigate_company(company_name, company_website, region,
industry_focus=None, framework=None)` accepts an already-fetched Phase 1 `framework`
(so the market workflow doesn't re-resolve it) and an `industry_focus` that is part of
the company cache key. The direct `POST /api/v1/research/company` route calls it with
neither, so region is resolved from cache/disk as before.

---

## 5. Configuration (`app/config.py`)

Loaded from environment / `.env` into a cached `Settings` singleton (`get_settings()`).

| Env var | Default | Meaning |
|---|---|---|
| `OPENAI_API_KEY` | `""` | OpenAI credential. Empty ⇒ research calls fail. Referenced by name only; never logged. |
| `OPENAI_MODEL` | `gpt-4o` | Model used for all research + verification calls. Part of the cache key. |
| `ENABLE_WEB_SEARCH` | `true` | When true, use the grounded Responses+`web_search` path. When false, live research is refused (`_cached` raises). |
| `LOG_LEVEL` | `INFO` | Root log level. |
| `STORAGE_DIR` | `storage` | Artifact root (absolute in Docker: `/app/storage`). |
| `SOURCING_API_TOKEN` | `""` | Bearer token for all `/api/v1/*` routes. |
| `REQUIRE_API_TOKEN` | `true` | If true and no token configured, protected routes return 503 (fail-closed). Set false only for explicit local-only opt-out. |
| `REGION_CACHE_HOURS` | `168` | Phase 1 cache TTL (7 days). |
| `COMPANY_CACHE_HOURS` | `24` | Phase 2 cache TTL. |
| `MODEL_API_URL` | `http://localhost:8080` | Base URL of the external Java structured-scoring API (`POST /api/score`). Used by the market workflow only. |
| `MODEL_API_TOKEN` | `""` | Optional bearer token for the Java scoring API. |

**Logging** is structured key=value on stdout (`_JsonishFormatter`,
`ts=… level=… logger=… msg=…`). `httpx` and `openai` loggers are quieted to WARNING.

---

## 6. Authentication (`app/auth.py`)

- Server-to-server only. **The browser never receives this token.**
- `require_token` compares the `Authorization` header against
  `"Bearer " + SOURCING_API_TOKEN` using `secrets.compare_digest` (constant-time).
- Fail-closed: if no token is configured and `REQUIRE_API_TOKEN` is true → **503**.
  Wrong/missing token → **401**.
- Applied as a router-level dependency on the whole `/api/v1` prefix. `/health` and
  `/` are unauthenticated.

---

## 7. AI model usage & prompting

### Model
- Default `gpt-4o`, configurable via `OPENAI_MODEL`. The model name is part of every
  cache key, so changing models invalidates caches correctly.
- Client (`openai_client.get_client`): lazily initialized singleton, `timeout=70.0`,
  `max_retries=0` (no silent retries on paid calls).

### Grounded path (primary) — `_run_with_responses_api`
- Uses the **Responses API** with `tools=[{"type": "web_search"}]` and
  `include=["web_search_call.action.sources"]`.
- After the call it **inspects the response output** to confirm a `web_search_call`
  actually happened and to collect real retrieved URLs (from search-call sources and
  from `url_citation` annotations).
- **If no web search was performed, it raises `ResearchError`** — it refuses to label
  model knowledge as researched evidence. It then stamps
  `research_mode="web_search"` and `retrieved_source_urls=[...]` onto the raw JSON.
- Provenance is trusted **only from the transport**, never from model-authored JSON
  (a test asserts a model-invented `retrieved_source_urls` is discarded).

### Ungrounded path (fallback) — `_run_with_chat_completions`
- Chat Completions JSON mode. Stamps `research_mode="ungrounded_demo"`, empty URLs.
- Reachable only when `ENABLE_WEB_SEARCH=false`. Because `_cached` refuses ungrounded
  research, this path is effectively demo/testing only and never populates the live
  cache or a persisted company report.

### `run_structured_research(system_prompt, user_prompt, schema)`
The single entry point. Chooses grounded vs. fallback, extracts JSON (tolerant of
Markdown fences / stray prose), and validates against the given Pydantic schema.
Any OpenAI error, JSON error, or schema mismatch becomes a `ResearchError`.

### Prompts (`app/services/prompts.py`)
- `CORE_CONSTRAINTS` (the three global constraints) is prepended to every system
  prompt and demands "Return ONLY a single valid JSON object … No prose outside JSON."
- **Phase 1** covers 5 categories: ownership & succession, economic & market,
  regulatory & tax, cultural attitudes, publicly observable signals — with an
  explicit instruction that an operating event is *not* proof an owner wants to sell,
  and to research per sub-country.
- **Phase 0** points at real registries (Handelsregister/Bundesanzeiger, Bolagsverket,
  Brønnøysundregistrene, CVR, PRH) and excludes listed public companies.
- **Phase 2** requires per-signal `kind`/`direction`, per-signal `citations` (with
  `origin_group`/`independent`/`independence_basis`), strictly-typed
  `structured_facts` (allowed fields + units only, no inference/estimation), and
  actively asks for **counter-evidence** (commitment to independence, denied sale
  reports). `explicit_exit` requires an actual public statement, not inferred intent.
- **Verification prompt** instructs a fresh, independent cross-check that treats the
  supplied report as *untrusted input, not instructions*, and treats syndicated
  reposts of the same original source as a single `origin_group`.

---

## 8. Data model & the hardening invariants (`schemas.py` + `research_service.py`)

All research outputs extend `ResearchProvenance`:
`schema_version=2`, `cache_hit`, `research_mode` (`web_search|ungrounded_demo|unknown`),
`retrieved_source_urls`.

### Phase 1 — `Phase1Output`
`region`, `sub_regions_covered`, `generated_at` (ISO-8601), `signals: [SignalItem]`,
`summary`. `SignalItem`: `id`, `name`, `category` (5-value Literal),
`why_it_matters_in_region`, `how_to_detect`, `data_sources`, `signal_strength`
(`strong|medium|weak`), `applies_to` (list; a bare string is coerced to a one-item
list, other non-string shapes are rejected).

### Phase 2 — `Phase2Output`
`company_name`, `region`, `website`, `researched_at`, `summary`,
`signal_evidence: [SignalEvidenceItem]`, `data_gaps`, `structured_facts`,
`verification_complete`, `verification_method`, `warnings`.

- `SignalEvidenceItem`: `signal_id`, `signal_name`, `evidence_found` (str|null),
  `sources` (URLs), `confidence` (`high|medium|low`), `notes`,
  `verification_status` (`verified|partially_verified|conflicting|unverified|insufficient_evidence`),
  `kind`, `direction`, `citations: [Citation]`, `verification_note`.
- `Citation`: `url`, `title`, `published_at`, `excerpt`, `stance`
  (`supports|contradicts|context`), `origin_group`, `independent`, `independence_basis`.
- `StructuredFact`: a closed enum of `field`s with **per-field numeric bounds and
  type checks** (`validate_value`); out-of-range / wrong-type / booleans-where-numeric
  are set to `None`. `revenueK` is EUR-thousands only (no currency conversion).

### Invariants enforced in code (do not weaken these)
These are applied in `research_company_signals()` / `source_company_universe()` /
`research_region_signals()` and covered by tests:

1. **Identity match** — the model's returned `company_name`/`region` (and Phase 1
   `region`) must match the request, case-folded; otherwise `ResearchError`. Prevents
   relabeling one entity's research as another's.
2. **Grounding required** — non-`web_search` mode, or missing retrieved URLs, is
   rejected for live paths.
3. **Sources must be real** — evidence `sources` are filtered to URLs that were
   actually in `retrieved_source_urls` and are HTTP(S). Unsupported claims are wiped
   to `evidence_found=null`, `confidence="low"`, `verification_status="insufficient_evidence"`,
   and moved to `data_gaps`.
4. **Citations ≠ verification** — extraction always sets `verification_status` no
   higher than `unverified`; only the separate verifier can promote a claim.
5. **Unknown IDs rejected** — every `signal_id` must exist in the Phase 1 checklist;
   duplicate ids are rejected.
6. **Structured facts** — only explicitly-sourced, dated, in-range values survive;
   conflicting duplicate fields are dropped and recorded as data gaps.
7. **`data_gaps`** is recomputed as `all Phase 1 ids − ids with surviving evidence`.

### Verification layer (`verification.py`)
- Fails **closed**: if the cross-check call fails or mismatches identity/grounding,
  the report keeps `verification_complete=false` and adds a warning
  ("do not contact yet"); statuses are not upgraded.
- A claim is `verified` only with ≥2 distinct `origin_group`s **and** ≥2 distinct
  domains among dated `supports` citations, plus at least one `independent` citation.
  Any `contradicts` citation ⇒ `conflicting`. Two domains that are syndicated reposts
  of one release do **not** count as independent corroboration.
- Empty research (no usable claims) is marked `verification_complete=true` with method
  "No supported claims to cross-check" — completed, but explicitly *not* "verified".

---

## 9. Storage (`app/services/storage.py`)

- Atomic writes via temp file + `os.replace` (never a half-written report).
- `slugify()` for filesystem-safe names.
- Layout: `storage/regions/{region_slug}_signals.json`,
  `storage/companies/{company_slug}_{region_slug}_signals.json`,
  `storage/cache/{sha256}.json` (cache envelopes: `{cached_at, value}`).
- `load_company_report_by_slug()` **rejects path-traversal** (`[\w-]+` only) and
  **refuses ambiguous slugs** that match multiple regional reports (raises `ValueError`
  → HTTP 400), requiring the exact `{company}_{region}_signals` stem.

---

## 10. HTTP API

Base path `/api/v1`. All routes require the bearer token. Response models are the
Pydantic schemas above (auto-documented at `/docs`).

| Method & path | Body | Action | Errors |
|---|---|---|---|
| `POST /api/v1/research/region` | `{region, industry_focus?}` | Phase 1; cached; returns `Phase1Output` | 502 upstream |
| `POST /api/v1/research/company` | `{company_name, company_website?, region}` | Phase 2 (+region dep, +verify); returns `Phase2Output` | 409 no Phase 1, 502 upstream |
| `POST /api/v1/sourcing/universe` | `{region, criteria, max_companies}` (1–10, default 5) | Phase 0; cached; returns `CompanyUniverseOutput` | 502 upstream |
| `GET /api/v1/reports/company/{company_slug}` | — | Load saved Phase 2 report | 400 bad/ambiguous slug, 404 not found |
| `POST /api/v1/investigate-market` | `{country, industry}` (strict, `extra=forbid`) | Start async market job; returns **202** + job snapshot `{id, status, stages, ...}` | 401 auth, 422 validation, 503 unavailable/busy |
| `GET /api/v1/investigate-market/{job_id}` | — | Poll job snapshot; `status` is `running\|complete\|error` | 404 expired/unknown |
| `GET /health` | — | `{status, research_configured, authentication_configured, schema_version:2}` (no auth) |
| `GET /` | — | service metadata (no auth) |

The `/` metadata `endpoints` list has not been updated to include the market routes —
it still lists only the four research/sourcing/report endpoints. Not a bug, just stale
metadata worth knowing.

Upstream/model failures return **502 with a generic message** (details are logged,
not leaked to the caller). Validation failures return 422 automatically.

---

## 10a. Market investigation workflow (`services/market.py`)

An asynchronous, bounded orchestration on top of the research pipeline. It exists
because a full multi-company investigation can exceed a hosted gateway's request
timeout, so the work runs in a background thread and the client polls.

- **Job model:** in-memory dict keyed by a UUID, guarded by an `RLock`. Each job has
  `id, country, industry, status, stages (6-stage progress list), results, warnings,
  error`, plus private `_key`/`_created`. `snapshot()` returns a deep copy with the
  private `_`-prefixed keys stripped.
- **Executor:** a single-worker `ThreadPoolExecutor`. At most **3 running jobs** at
  once (else 503 "busy"); completed/errored jobs older than 1 hour are pruned on the
  next `start()`.
- **De-duplication:** starting the same `(country, industry)` (case-folded) while a
  non-errored job exists returns that job's snapshot instead of launching another.
- **Preconditions:** requires `OPENAI_API_KEY` and `ENABLE_WEB_SEARCH` (else raises
  `ValueError` → 503 from the router).

`run()` pipeline (updates `stages` as it goes):
1. `cached_region(country, industry)` → regional framework.
2. `cached_universe(...)` for up to **3** well-sourced candidate companies.
3. For each candidate: skip (with a user-facing warning) if its country doesn't match
   the requested one; otherwise `investigate_company(..., framework=framework)`. Data
   gaps are relabeled to human-readable "No supporting public evidence: <signal name>".
   If candidates existed but none produced a report, the whole job errors.
4. `structured_model.score(report, industry)` for each surviving report.
5. `assessment.assess(report, model, country, industry)` per report; results are
   sorted by `priority` (descending, `None` last) and stored on the job.
Any exception marks the job `error` with a **generic** message (the real exception
type is logged, never surfaced).

## 10b. External structured scoring (`services/structured_model.py`)

- Calls the **external Java model API** at `MODEL_API_URL` + `/api/score` (stdlib
  `urllib`, 75s timeout, optional `MODEL_API_TOKEN` bearer). **No ML runs in Python;
  no training here.**
- `inputs_for()` only forwards `structured_facts` that are in the allowed field set,
  non-null, sourced, and dated **on or before today** (future-dated facts excluded).
  It never invents or estimates fields.
- Requires **≥2 supplied fields** or it returns `None` (no call made).
- The Java response is **strictly validated** (schema version, echoed company id/year,
  status ∈ `scored|insufficient_data`, supplied/missing field sets, coverage ≈
  supplied/11, probability/percentile ranges, `syntheticTraining` flag). Anything off,
  or any network/parse error, yields `None` — a scoring failure never blocks or
  corrupts the evidence result.

## 10c. Assessment / prioritization policy (`services/assessment.py`)

Ports the previous `liveResearch.ts` + `assessment.ts` policy behind the API. Produces
the per-company result object the market job returns. Key properties:

- **Priority** (`priority`, 0–100 or `None`) = a coverage-scaled blend of a regional
  nominal weight (Nordics 0.65 vs. 0.25 elsewhere) applied to the external model's
  percentile, combined with points from **verified** positive timing factors
  (leadership / operational / transaction-timing), evidence-quality and
  independent-corroboration bonuses, then a **contradiction penalty** (−20 per
  conflicting claim, capped −40). It is explicitly **uncalibrated research priority,
  not P(sell)**.
- **Verification gating:** a claim only counts as "Verified" with ≥2 distinct
  `origin_group`s **and** ≥2 distinct domains among dated `supports` citations, plus an
  independent citation, and only when `verification_complete`. Negative/conflicting
  claims are surfaced, not hidden.
- **Confidence** (`High|Moderate|Low`) from a certainty blend; **synthetic-trained**
  models are capped below "High".
- **Outreach drafting:** an outreach email is drafted only when gates pass
  (`draft_allowed`), and the `contact` flag additionally requires high confidence,
  verified principal evidence, a real (non-synthetic) model score ≥70, and no
  conflicts. The draft copy explicitly states there is no assumption the owner wants to
  sell — consistent with the core rule.
- Output fields include: `company, country, industry, priority, confidence, why_now,
  conversation, angle, evidence[], data_gaps, structured{...}, explanation, outreach,
  contact, factors[], structured_weight, contradiction_penalty, warnings, provenance`.

Example:
```bash
curl -X POST http://127.0.0.1:8000/api/v1/research/company \
  -H "Authorization: Bearer $SOURCING_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"company_name":"Target Co","company_website":"https://example.com","region":"Nordic"}'
```

---

## 11. Testing

Everything runs **offline** — no real OpenAI calls in tests.

- `tests/recorded_client.py` — a `RecordedClient` that mimics the OpenAI transport,
  returning recorded region/company/verification/universe payloads *with* a
  `web_search_call` in the output so the grounding check passes. It is a transport
  fixture, **not** real research data.
- `tests/test_api.py` — full HTTP tests: auth (401/503), validation (422), no paid
  calls on unauthorized/invalid requests, region→company→verification ordering,
  caching (`cache_hit`), counter-evidence retention, verifier fail-closed behavior,
  structured-fact validation, and empty-research handling.
- `tests/test_integrity.py` — the safety invariants: provenance can't be spoofed by
  the model, grounded failure never silently falls back to ungrounded, unsupported
  claims become data gaps, cited-but-not-corroborated stays `unverified`, storage
  rejects traversal and ambiguous slugs.
- `tests/test_market.py` — the market workflow and the scoring/assessment policy:
  full pipeline ordering (`region → universe → company → verification`), single-job
  reuse, market/industry propagation, strict two-field request contract, 503 when
  unconfigured, clean/generic worker-failure messages, and policy checks (regional
  weighting, contradiction penalty, synthetic-model caps, outreach gating, and that
  the Java client never invents fields or forwards future-dated facts). It loads a
  fixture from **`prompt-marketing/tests/fixtures/research-report.json`** (repo-root
  `tests/`, resolved via `Path(__file__).parents[2]`), *not* `sourcing-engine/tests/`.
- `tests/serve_recorded.py` — runs the *real* FastAPI app (real orchestration, cache,
  verification) on `127.0.0.1:8001` with only the OpenAI transport recorded. Handy for
  manual/integration poking without spending tokens or needing a key.

Run tests from the `tests/` directory (they import `recorded_client` directly), e.g.:
```bash
cd sourcing-engine
python -m pytest tests            # or: (cd tests && python -m unittest)
```

---

## 12. Deployment (`Dockerfile`)

- `python:3.12-slim`, installs pinned requirements, copies only `app/`.
- Creates a **non-root** `research` user (uid 10001) and a writable
  `/app/storage`.
- Env: `PORT=8000`, `STORAGE_DIR=/app/storage`, `PYTHONDONTWRITEBYTECODE=1`.
- Runs `uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1`.
- **Single worker is intentional** — the in-process `RLock` that dedupes paid
  research calls only holds within one process. Scaling horizontally would need a
  shared lock/cache (currently local-disk only), so revisit caching before running
  multiple workers/instances.
- `.dockerignore` keeps `.env*`, `.venv`, `storage`, `tests`, and `.git` out of the image.

---

## 13. Local quickstart

```bash
cd sourcing-engine
python -m venv .venv
.venv\Scripts\Activate.ps1        # Windows PowerShell
# source .venv/bin/activate       # macOS/Linux
pip install -r requirements.txt

# create .env with at least:
#   OPENAI_API_KEY=sk-...
#   SOURCING_API_TOKEN=<a long random string>
#   ENABLE_WEB_SEARCH=true

uvicorn app.main:app --reload      # docs at http://127.0.0.1:8000/docs
```

---

## 14. Guardrails for anyone (human or agent) changing this code

- **Never** add scoring, ranking, or intent inference to the *evidence layer*
  (Phase 1/2 extraction, verification, prompts). Prioritization lives only in the
  separate `structured_model.py` + `assessment.py` layer and stays labelled as an
  uncalibrated research priority, never a probability that an owner will sell.
- **Never** let ungrounded model output be persisted or cached as real research, and
  never trust model-authored provenance (`research_mode`, `retrieved_source_urls`) —
  those come from the transport only.
- **Never** relax the identity/grounding/citation invariants in §8, or the
  fail-closed behavior of auth (§6) and verification (§8), without updating the tests
  that guard them — those tests exist to encode intent, not to be deleted.
- Keep **private/sensitive personal data** out of prompts, schemas, and storage.
- Treat verification as separate from extraction; don't let extraction self-certify.
- If you add multi-worker/horizontal scaling, replace the in-process lock and
  local-disk cache with a shared mechanism first.
```
