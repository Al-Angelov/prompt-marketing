# Mergero / MGX investigation workspace

React/Vite → same-origin HTTP API → existing Java structured model → combined investigation.
The public app remains https://prompt-marketing-1.vercel.app. There is no separate Java UI.

## Run locally

Requirements: Node, Java 21+, Maven. Start the API first:

```sh
mvn -f data-analysis/pom.xml verify
java -jar data-analysis/target/ma-score-0.2-server.jar
```

Then `npm install && npm run dev`. Vite proxies `/api/*` to `http://localhost:8080`.
Copy `.env.example` to `.env.local` to override the service URL/token. Do not put secrets in `VITE_*` variables.
`npm run build` produces the Vercel frontend. The original modeling/backtesting CLI remains available:

```sh
mvn -f data-analysis/pom.xml compile exec:java
```

## Product logic

- Select an example or enter a company, review nullable structured inputs, and run research.
- Java fits once at startup, then reuses the fitted model and training medians.
- `src/modelApi.ts` sends only known fields and validates response schema, identity, year, coverage and missingness.
- `src/research.ts` retains mocked public evidence/corroboration. Six public factors exclude old ownership/financial points, which belong to Java.
- `src/assessment.ts` is the sole fusion/contact policy. Maximum model weight is 65% for Nordics and 25% elsewhere, multiplied by observed-field coverage. Model **reference-cohort percentile**, not acquisition probability, blends with public priority; contradiction penalties subtract afterward at full strength.
- Missing fields reduce confidence. This transparent policy is uncalibrated and needs real-data backtesting.
- Synthetic training or mock sources cannot authorize real contact. Suitable examples still produce explicitly illustrative drafts. Unknown companies receive no fabricated owner signals or structured inputs.
- API errors/timeouts/malformed responses keep the evidence UI usable in explicit `demo-fallback` mode without an invented Java result. Editing inputs or rerunning discovery retries the API.
- Shortlist, filters, CSV export, editable saved drafts and responsive behavior remain intact.

## Model meaning

See [the HTTP contract](data-analysis/API.md). `GET /api/health` reports readiness; `POST /api/score` accepts existing CompanyYear fields, excluding `sold`. Null/absent fields stay missing. Internal median imputation is disclosed, never shown as a company fact.

Java estimates **historical acquisition propensity during the observation year**, not owner willingness to sell. Default training uses the synthetic Spanish-SME simulator, not validated Nordic/German transaction history. Public evidence and company fixtures are illustrative. No scraping, messages or automated owner contact occur.

## Deploy

Vercel runs React plus `api/health.js` and `api/score.js`, thin Node gateways to Java. No CORS exceptions are needed.

1. Deploy `data-analysis/Dockerfile` to a container host. `render.yaml` supplies a Render blueprint. The image runs Maven tests during build, runs as non-root, fits once on startup, listens on `PORT`, and exposes `/api/health`.
2. Set `REQUIRE_API_TOKEN=true` and secret `MODEL_API_TOKEN` on the service. Render generates this token. For real training, mount a CSV and set `MODEL_DATA_PATH`; invalid data fails startup. Do not commit private data.
3. Set server-side Vercel `MODEL_API_URL=https://<your-service>` and the same `MODEL_API_TOKEN`, then deploy with `npx vercel deploy --prod --yes`.
4. Verify the public `/api/health`, then run an investigation. Without configuration or an available backend, the gateway returns JSON 503 and the UI visibly falls back. Gateway timeout: 9 seconds.

Java does not execute in the static Vite deployment. The container must be provisioned; a Dockerfile alone does not make it live. Free hosts may cold-start; retry after readiness returns. GitHub auto-deployment requires host permissions; direct Vercel CLI deployment remains supported.

## Verify

```sh
mvn -f data-analysis/pom.xml verify
npm run build
npm test
```

Browser tests use Microsoft Edge; adjust the Playwright channel on other systems. Playwright starts Vite when needed. With Java running on port 8080, also run the true HTTP/browser integration:

```sh
# POSIX
RUN_JAVA_INTEGRATION=1 npx playwright test
# PowerShell
$env:RUN_JAVA_INTEGRATION='1'; npx playwright test
```

See [the integration audit](docs/INTEGRATION-AUDIT.md) for repaired assumptions and deployment limits.
