# Structured model HTTP contract (schemaVersion 1)

Run `java -jar target/ma-score-0.2-server.jar` after `mvn verify`. Existing CLI: `mvn compile exec:java`; modeling/backtesting is preserved.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8080 | HTTP port |
| `MODEL_TYPE` | logistic | `logistic` or `gradient`; existing trainers plus median imputation |
| `MODEL_DATA_PATH` | unset | CSV history; otherwise synthetic data (4,000 companies, 2015–2025, seed 42) |
| `MODEL_API_TOKEN` | unset | Bearer token for scoring; server-side only |
| `REQUIRE_API_TOKEN` | false | Require token configuration at startup |

One fit **per process start**, never per request. Only labeled rows train the service. Request years must follow the latest labeled training year to prevent same-year leakage. Restarts refit; requests share model ID/initialization time. Serving selects a configured trainer; the CLI still performs model comparison and backtests.

## GET /api/health

200 after initialization: `status: ready`, `modelId`, `modelUsed`, `syntheticTraining`. No requests are accepted until initialization succeeds. Health is public for container checks.

## POST /api/score

Content-Type `application/json`; `Authorization: Bearer <MODEL_API_TOKEN>` when configured. Body limit 16 KiB.

```json
{"id":"example-1","year":2027,"sector":"Manufacturing","foundedYear":1998,"revenueK":24600,"employees":120,"ownerAge":null,"familyOwned":null}
```

`id` and `year` are required; `sector` is metadata, not a fitted feature. Nullable raw inputs: `foundedYear`, `revenueK`, `employees`, `ebitdaMargin`, `leverage`, `revenueGrowth3y`, `maxDirectorTenure`, `ownerAge`, `familyOwned`, `shareholders`, `sectorDeals24m`. Units match the CLI: ratios for margin/growth, EUR thousands for revenue. Family ownership accepts boolean or numeric 0/1. Unknown means null or omitted, never empty string/zero. No `sold` label is accepted. Unknown fields, non-finite numbers, numeric strings, invalid ranges and malformed JSON return 400.

Features must have been available before the observation year began. Demo inputs use 2027 because fixture sources are dated in 2026; this does not imply real 2027 observations exist.

| Response field | Meaning |
|---|---|
| `schemaVersion` | 1 |
| `companyId`, `year` | Echoed identity; client rejects stale/mismatched results |
| `status` | `scored` or `insufficient_data` |
| `probability` | Model acquisition propensity 0–1; null with fewer than two raw inputs |
| `percentile` | Midrank 0–100 against fitted training-cohort scores; neither sale probability nor out-of-sample performance |
| `baselineLogOdds` | Constant model explanation baseline |
| `contributions` | Every engineered feature: `feature`, `observedValue` (nullable), `imputed`, signed `logOdds` |
| `suppliedFields`, `missingFields`, `coverage` | Raw-input completeness; imputed values never count as supplied |
| `confidence` | Coverage category: High ≥80%, Moderate ≥50%, otherwise Low; not statistical certainty |
| `metadata` | Model ID/name, initialization time, provenance, rows, last training year/base rate, target, calibration limitation and explanation method |
| `warnings` | Synthetic training, missingness, drift and interpretation caveats |

Baseline + all contributions explains model log-odds. Missing contributions remain in the decomposition but are flagged rather than treated as observed evidence. The frontend separates them from public priority points.

Failures: 400 invalid input, 401 invalid/missing configured token, 404 route, 405 method, 413 payload size, 415 content type. Errors are JSON. Vercel also returns 503 for unconfigured/unavailable/timed-out or mis-authenticated upstream. No wildcard CORS or second UI.
