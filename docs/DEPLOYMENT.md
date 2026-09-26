# Deploy the integrated Mergero app

Frontend: https://prompt-marketing-1.vercel.app. Keep this existing Vercel project.
Both backends need a host; Vercel only runs the frontend and Node gateways.

## Render

1. In Render choose **New > Blueprint**, connect `Al-Angelov/prompt-marketing`, branch `main`, and select root `render.yaml`.
2. The blueprint creates `mergero-model-api` and `mergero-sourcing-api`, using their existing Dockerfiles. Supply `OPENAI_API_KEY` when prompted for the Python service. Never put this key in Vercel client variables or source code.
3. On Java retain `MODEL_TYPE=logistic`, `REQUIRE_API_TOKEN=true` and the generated `MODEL_API_TOKEN`. Default training is synthetic. To replace it, mount a validated CSV, set `MODEL_DATA_PATH` to its absolute path and redeploy. Training runs once per process, not per request.
4. On Python retain `ENABLE_WEB_SEARCH=true`, `REQUIRE_API_TOKEN=true`, generated `SOURCING_API_TOKEN`, `OPENAI_MODEL=gpt-4o`, `STORAGE_DIR=/app/storage`, `REGION_CACHE_HOURS=168`, `COMPANY_CACHE_HOURS=24`. The model must support Responses `web_search` and be available to the API account. One Uvicorn worker preserves request deduplication.
5. Wait for both services to become healthy. Java `GET /api/health` should return `status: ready`; Python `GET /health` should report `research_configured: true` and `authentication_configured: true`. These are configuration/readiness checks, not proof of a successful OpenAI call.
6. Copy each service's actual HTTPS URL and generated token into Vercel as below. Do not assume the Render URL equals its service name.

Free containers have ephemeral filesystems. Caches survive requests in a running container, but may disappear on restart/redeploy. To retain cached paid research across deployments, upgrade the Python service and attach a persistent disk mounted at `/app/storage`. Render requires a paid service for persistent disks. [Render disk documentation](https://render.com/docs/disks).

## Vercel

Project **prompt-marketing-1 > Settings > Environment Variables**; add to Production:

| Variable | Value |
|---|---|
| `MODEL_API_URL` | Java Render HTTPS origin, without `/api` |
| `MODEL_API_TOKEN` | Exact Java token from Render |
| `SOURCING_API_URL` | Python Render HTTPS origin, without `/api` |
| `SOURCING_API_TOKEN` | Exact Python token from Render |

Enable Fluid Compute in the Vercel project if it is not enabled. Research routes use `maxDuration: 300`; the gateway times out at 230 seconds, and Python allows at most 70 seconds per OpenAI call with no automatic retry. These settings fit the [Vercel Fluid Compute limits](https://vercel.com/docs/functions/limitations).

Redeploy the existing production project after setting variables:

```sh
npx vercel deploy --prod --yes
```

Do not use `VITE_*` for any key/token. No CORS configuration is needed.

## Verify production

1. Open `/api/health` and `/api/research/health` on the public Vercel domain. Both should return JSON 200. A JSON 503 means missing configuration, bad authentication or an unavailable backend.
2. Open **Discover prospects**. Use a real company name, its website and country; keep **Live public research** selected. Or use **Discover a few companies by criteria**, then select a grounded candidate.
3. Inspect live/cached provenance, source links/dates, verification, contradictions and gaps. Check that Java uses only available structured facts; no facts can legitimately produce an insufficient-data result.
4. Repeat the same company/website/country to confirm `cache_hit: true` without another paid research call. Regional research is reused for seven days, company research for one day. Failed verification is retried instead of cached as verified.
5. A synthetic Java model or unresolved contradiction must keep contact on hold. Outreach is a reviewable draft and is never sent automatically.

Unconfigured or failed services produce explicitly labeled fallback. Unknown companies get no invented evidence. A previously researched live company retains its dated report with an outage warning; it is not overwritten by fixtures.

## Reproduce offline integration checks

Install Python requirements in `sourcing-engine/.venv`, then run Python tests from `sourcing-engine`:

```sh
python -m unittest discover -s tests -v
```

For the full browser test, start Java on 8080. In another PowerShell terminal:

```powershell
cd sourcing-engine
$env:PYTHONPATH='.'
./.venv/Scripts/python.exe tests/serve_recorded.py
```

From the repository root in a second terminal:

```powershell
$env:SOURCING_API_URL='http://127.0.0.1:8001'
$env:SOURCING_API_TOKEN='integration-test-token'
npm run dev -- --port 5174 --strictPort
```

Then run from the root:

```powershell
$env:RUN_JAVA_INTEGRATION='1'
$env:FULL_STACK_URL='http://localhost:5174'
npm test
```

The integration harness replaces only external OpenAI transport with **recorded test responses**; real FastAPI authentication, orchestration, cache, source checks, Java scoring, Vite HTTP proxy and browser UI execute. It does not establish real-world source accuracy. `tests/` is excluded from both service images and Vercel uploads.
