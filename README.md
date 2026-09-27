# Mergero / MGX investigation workspace

React/Vite → one same-origin market endpoint → Python research and verification → Java structured model → ranked opportunities.
The public app remains https://prompt-marketing-1.vercel.app. There is no separate Java UI.

## Run locally

Requirements: Node, Java 21+, Maven. Start the API first:

```sh
mvn -f data-analysis/pom.xml verify
java -jar data-analysis/target/ma-score-0.2-server.jar
```

Start Python separately: install `sourcing-engine/requirements.txt`, set `OPENAI_API_KEY`, `ALLOW_PAID_RESEARCH=true` and `SOURCING_API_TOKEN` in its untracked `.env`, then run `uvicorn app.main:app --port 8000` from `sourcing-engine`.
Then `npm install && npm run dev`. Vite proxies `/api/investigate-market` and `/api/research/*` to Python on 8000; `/api/health` and `/api/score` still route to Java on 8080. Put the same sourcing token in root `.env.local`. Configure Python's `MODEL_API_URL` (default `http://localhost:8080`) and `MODEL_API_TOKEN` when Java requires authentication.
Copy `.env.example` to `.env.local` to override the service URL/token. Do not put secrets in `VITE_*` variables.
`npm run build` produces the Vercel frontend. The original modeling/backtesting CLI remains available:

```sh
mvn -f data-analysis/pom.xml compile exec:java
```

## Quick search and scoring (v3)

- **Search starts with a quick screen.** Clicking **Search companies** first runs a free registry screen (Norway, France and Finland today). It ranks about 30 real SMEs within seconds from official registry data, Eurostat sector ageing statistics and the Java model.
- **Deep research follows automatically.** Research then runs in the background on the top 3 candidates, and their cards update when it finishes. Other countries use the original research-only flow.
- **Reading the score.** Priority v3 is odds-based: 50 is a typical company in the country, 75 is twice its odds, and every point is listed per factor. See [docs/SCORING.md](docs/SCORING.md).
- **Demo prep.** Run `sourcing-engine/scripts/warm_demo.py` before presenting so demo markets answer from cache.

## Product logic

- Confirm Country and Industry in the two searchable selectors, then click **Search companies**. Typing or confirming a selection never starts research.
- **Potential Sellers** keeps completed company reports in this browser's IndexedDB, including their evidence, website links, and JSON downloads. It starts empty, deduplicates companies within each country/industry, and keeps the latest research. Search locally by company, country or industry; sort by existing Priority Score, research date or name. Rank remains research priority, not a probability of becoming a client. Export the entire library (including reports, regional context and source evidence) as a portable versioned JSON backup, and import it on another browser/device. Imports validate every report before a single atomic write; older duplicate reports never replace newer ones. It is a device-local library, not a shared cloud account; unavailable browser storage is disclosed and reports remain usable in the current session.
- **Regional Intent Signals** shows the actual regional checklist from saved reports. Choose a researched market and a signal to inspect its regional significance, detection criteria, sources, and verified/conflicting/unverified finding counts. Expand Outreach evidence to inspect each matching company's discovery source, shortlist rationale, verification notes, facts, dated citations/excerpts, structured metrics and gaps. Explicitly identified academic references are displayed when included in the saved report; ordinary source URLs are not automatically classified as academic. Empty or older reports without a checklist show an honest placeholder.
- **Seller contact plan**, prominently above regional metrics, selects a saved company and shows whom to approach, a recorded contact channel, an evidence-based approach, and the saved draft. It uses existing report data only: no enrichment requests or message sending. Named contacts and email addresses require matching saved citation excerpts; unsupported details remain missing. Older reports can surface literal business-domain emails and contact-page URLs from citations on the recorded company website. Optional `report.contact_routes` metadata can link a named recipient, business email, LinkedIn profile or contact page to an existing evidence citation via `source_url`; address/profile values must match that source. Suggested roles are labeled as suggestions. Backend contact holds, contradictory evidence and provisional models stay visible. The plan reconstructs from archived reports after reload and library export/import.
- The frontend posts only `{country, industry}` to `/api/investigate-market`, then polls that endpoint with `?job=<id>`. Python runs regional research, discovery of up to five companies (configurable from 1?10), company extraction, separate verification, structured scoring and ranking. Progress reflects actual backend stages.
- Java fits once at startup, then reuses the fitted model and training medians.
- `sourcing-engine/app/services/structured_model.py` sends only sourced, dated fields and validates response schema, identity, year, coverage and missingness. Fewer than two fields skip model scoring.
- Existing regional/company caches and public evidence verification are reused. Expanding a result never calls research services.
- `sourcing-engine/app/services/assessment.py` is the sole fusion/contact policy, moved from the removed frontend modules. Model contributions count only observed inputs (missing inputs are neutral) and are halved for synthetic training; public evidence, official records, sector statistics and contradictions add log-odds shifts to a typical-company baseline of 50.
- Public evidence uses regional strength, recency, verification, confidence and distinct events. [Exact deterministic formula](docs/SCORING.md).
- Final JSON reports, including scoring inputs and Java output, are persisted under `STORAGE_DIR/reports/<job-id>/<report-id>.json` and embedded in results; expanding a company exposes evidence and a JSON download.
- Missing fields reduce confidence. This transparent policy is uncalibrated and needs real-data backtesting.
- Synthetic training or unresolved contradictions cannot authorize real contact. Suitable verified evidence can produce a review draft, explicitly held pending review.
- Java outages leave public evidence usable with reduced confidence and a disclosed missing model contribution. Research outages show a clean retry state; no demo companies replace live results. Recorded demo data exists only in the offline test harness.
- Ranked rows disclose evidence, contradictions, source links, company-data insight, priority explanation and outreach when expanded. The sidebar provides the deal engine, saved regional evidence and the searchable seller library.
- Jobs are deduplicated for one hour in one Python worker, with at most three active/queued markets. Jobs do not survive process restarts. Per-company caches retain their existing expiry policy.

## Model meaning

See [the HTTP contract](data-analysis/API.md). `GET /api/health` reports readiness; `POST /api/score` accepts existing CompanyYear fields, excluding `sold`. Null/absent fields stay missing. Internal median imputation is disclosed, never shown as a company fact.

Java estimates **historical acquisition propensity during the observation year**, not owner willingness to sell. Default training uses the synthetic Spanish-SME simulator, not validated Nordic/German transaction history. Prepared examples are illustrative; configured live research uses OpenAI web search. No messages or automated owner contact occur. Verification is model-assisted; a retrieved citation alone is not corroboration or proof of owner intent.

## Deploy

Vercel runs React and thin Node gateways: `/api/investigate-market` for the main flow, `/api/health`, `/api/score` for Java and the preserved `/api/research/{health,region,company,universe}` APIs for Python. No CORS exceptions are needed. [Exact setup and offline integration instructions](docs/DEPLOYMENT.md).

1. Import root `render.yaml` as a Render blueprint to create both Docker services. Supply Python's `OPENAI_API_KEY`. Both images run as non-root; Java runs Maven tests during build and fits once on startup.
2. Set `REQUIRE_API_TOKEN=true` and secret `MODEL_API_TOKEN` on the service. Render generates this token. For real training, mount a CSV and set `MODEL_DATA_PATH`; invalid data fails startup. Do not commit private data.
3. Set server-side Vercel `MODEL_API_URL`, `MODEL_API_TOKEN`, `SOURCING_API_URL`, `SOURCING_API_TOKEN` to the corresponding Render origins/tokens, then deploy with `npx vercel deploy --prod --yes`.
4. Set Python's `MODEL_API_URL` and `MODEL_API_TOKEN` to Java's origin/token. Verify both health endpoints, then confirm Country and Industry. Unavailable research returns JSON 503 and a clear retry state. Multi-company work runs as a background job, outside the gateway request lifetime.

Java does not execute in the static Vite deployment. The container must be provisioned; a Dockerfile alone does not make it live. Free hosts may cold-start; retry after readiness returns. GitHub auto-deployment requires host permissions; direct Vercel CLI deployment remains supported.

## Verify

```sh
mvn -f data-analysis/pom.xml verify
npm run build
npm test
```

Browser tests use Microsoft Edge; adjust the Playwright channel on other systems. Playwright starts Vite when needed. With Java, the recorded Python harness, and its Vite proxy running as described in the deployment guide, run the full HTTP/browser integration:

```sh
# POSIX
FULL_STACK_URL=http://localhost:5174 npm test
# PowerShell
$env:FULL_STACK_URL='http://localhost:5174'; npm test
```

See [the integration audit](docs/INTEGRATION-AUDIT.md) for repaired assumptions and deployment limits.
