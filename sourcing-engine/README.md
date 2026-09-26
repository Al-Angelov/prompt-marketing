# Mergero Regional M&A Sourcing Engine

FastAPI backend that runs a two-phase, regionally-grounded sell-signal research
pipeline on top of OpenAI. The service **only gathers and structures evidence** —
it never calculates a likelihood score or ranking. Scoring is handled downstream
by the MGX Deal Engine.

## Pipeline

```
region input
   │
   ▼
[Phase 1] Regional signal research  →  storage/regions/{region_slug}_signals.json
   │
   ▼ (optional) [Phase 0] company universe sourcing
   │
   ▼
[Phase 2] per-company research      →  storage/companies/{company_slug}_{region_slug}_signals.json
```

### Constraints enforced in every prompt
1. **Public professional context only** — no private/personal, health, or family data.
2. **No score calculation** — evidence only.
3. **Grounding** — every Phase 2 evidence item needs source URLs; otherwise the
   signal is recorded under `data_gaps` with `evidence_found = null`.

> Grounded results require a browsing-capable model. This service uses the OpenAI
> Responses API with the hosted `web_search` tool when `ENABLE_WEB_SEARCH=true`.
> With it disabled, HTTP research fails closed; ungrounded output is never served as live evidence.

## Setup

```bash
cd sourcing-engine
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

pip install -r requirements.txt

# Set OPENAI_API_KEY in your environment or an untracked .env file.
# Set OPENAI_MODEL to a model that supports the hosted web_search tool.
# Set SOURCING_API_TOKEN; REQUIRE_API_TOKEN defaults to true.
```

## Integrity and integration

Web-search failures return an error; they never silently retry with ungrounded
model knowledge. Responses carry `research_mode` and retrieved source URLs.
Company claims without a retrieved citation become data gaps. A citation is
initially `unverified`. A separate web-search pass checks the exact claims,
original publishers, publication dates and counter-evidence. Verification is
model-assisted and requires advisor review; two syndicated domains do not count.

The frontend calls this service through authenticated Vercel `/api/research/*`
gateways, then sends sourced structured fields to the separate Java API. The
company endpoint now orchestrates cached regional research and verification.
All `/api/v1/*` endpoints require `Authorization: Bearer <SOURCING_API_TOKEN>`.
`GET /health` remains a public configuration/liveness probe. Set
`REQUIRE_API_TOKEN=false` only for isolated local development.

Regional frameworks cache for 168 hours; company reports and candidate discovery
for 24 hours. Cache keys include model, schema and request identity. One worker
deduplicates concurrent work. Free Render storage is ephemeral; use a persistent
disk for cache survival across restarts. See [deployment instructions](../docs/DEPLOYMENT.md).
Run offline checks with `python -m unittest discover -s tests -v`.

## Run

```bash
uvicorn app.main:app --reload
```

Interactive docs: http://127.0.0.1:8000/docs

## Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/research/region` | Phase 1 — regional sell-signal checklist |
| POST | `/api/v1/research/company` | Phase 2 — company evidence vs. checklist |
| POST | `/api/v1/sourcing/universe` | Phase 0 — source candidate companies |
| GET  | `/api/v1/reports/company/{company_slug}` | Fetch a saved Phase 2 report |

### Examples

Include `-H "Authorization: Bearer $SOURCING_API_TOKEN"` in each API example below.
Company research automatically initializes/reuses the regional framework.

```bash
# Phase 1
curl -X POST http://127.0.0.1:8000/api/v1/research/region \
  -H "Content-Type: application/json" \
  -d '{"region":"Nordic","industry_focus":"Industrial Services"}'

# Phase 2 (requires Phase 1 for the region to exist first)
curl -X POST http://127.0.0.1:8000/api/v1/research/company \
  -H "Content-Type: application/json" \
  -d '{"company_name":"Target Co","company_website":"https://example.com","region":"Nordic"}'

# Phase 0
curl -X POST http://127.0.0.1:8000/api/v1/sourcing/universe \
  -H "Content-Type: application/json" \
  -d '{"region":"DACH","criteria":"SME software companies revenue €5M-€50M","max_companies":10}'

# Fetch a saved report
curl http://127.0.0.1:8000/api/v1/reports/company/target-co
```

## Project layout

```
sourcing-engine/
├── app/
│   ├── main.py                     # FastAPI app + router registration
│   ├── config.py                   # settings (.env) + structured logging
│   ├── models/schemas.py           # Pydantic v2 schemas + request bodies
│   ├── routers/research.py         # REST endpoints
│   └── services/
│       ├── openai_client.py        # OpenAI wrapper (Responses + web_search / Chat fallback)
│       ├── prompts.py              # Phase 0/1/2 prompt templates
│       ├── research_service.py     # pipeline orchestration
│       └── storage.py              # JSON persistence
├── storage/                        # generated artifacts (gitignored)
└── requirements.txt
```

## GDPR note
All target regions are EU/EEA. Leadership names/profiles are personal data even
when public. The prompts scope the agent to business-context signals and avoid
storing sensitive personal data. Get a compliance review before moving past demo.
