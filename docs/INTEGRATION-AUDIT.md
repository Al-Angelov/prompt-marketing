# Integration audit

Baseline frontend `01d0ba9`; fast-forwarded the clean checkout to `d87408f` to include both remote Java commits. No framework replacement.

Reviewed React state/workflow/scoring/evidence/styling/tests, Java CLI/data/features/models/imputation/explanations/backtests/metrics/reporting/tests, and deployment/build/editor configuration.

During this work, remote commits `2737c2c` and `5744488` added an independent Python sourcing engine. Fast-forwarded those changes and audited its schemas, prompts, API, OpenAI calls and storage. Repaired silent ungrounded fallback, missing provenance, unsupported company claims, company/region identity mismatches, report path validation, ambiguous regional reports and non-atomic writes. Four offline regression tests pass. Retrieved citations remain unverified until independently corroborated. This service is preserved for future source integration; the UI's existing public evidence remains explicitly mocked, and no paid research calls were made.

| Finding | Repair |
|---|---|
| Java was CLI-only and intentionally excluded from Vercel | Preserved CLI; added JDK HTTP service, one startup model, container and same-origin gateway |
| Unknown family ownership became false; founding year/shareholders required | Nullable values, NaN feature propagation, null-preserving CSV/JSON and regression tests |
| Stale hardcoded scores and unused outreach generator in data.ts | Removed duplicates; one public investigation and one fusion policy |
| Ownership/financial points duplicated structured evidence | Removed those categories from public scoring; Java supplies them |
| Probability and heuristic priority incompatible | Separate probability display; labeled reference percentile used for ranking fusion |
| Discovery retained stale existing prospect instead of new result | Replaces existing investigation including model response |
| Dead settings/notification/analytics branches | Removed branches/imports rather than adding a second interface |
| CSV split on commas; could not preserve quoted or missing values | Quoted/multiline CSV parsing, null handling, non-finite rejection and tests |
| AP/top-k metrics depended on row order for ties | Grouped thresholds and fractional tie-boundary membership; tests |
| Browser tests required a manual frontend | Playwright webServer plus optional real Java integration test |
| No model/mock provenance boundary | Contract/identity/coverage validation, training/input provenance, explicit fallback, no real contact from demo records |

Preserved logistic/boosted models, imputation, backtesting, CLI, public evidence and cross-checks, contradictions, regional logic, filters, shortlist, saved drafts and responsive layout. Gson is the only Java runtime dependency added; no frontend runtime dependency added.

Validation: Maven verification (60 tests); production Vite/TypeScript build; Node gateway test; nine Playwright tests including the real browser → Vite proxy → Java → investigation path; four Python integrity tests. Desktop/mobile checks retain the existing layout without horizontal overflow.

Remaining limits: public sources and company values are fixtures; default training is synthetic; regional blend/ranking policy is not calibrated; no real training dataset or source connector was supplied. Model artifact persistence is deferred—startup fitting is reused per process. A container account/service must be connected for hosted Java. Without `MODEL_API_URL`, Vercel intentionally returns 503 and uses explicit fallback. Docker is not installed locally; the packaged Java service and real HTTP/browser path were exercised. The Dockerfile uses that same entry point and runs Maven verification during image build.
