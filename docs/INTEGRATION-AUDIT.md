# Integration audit

Baseline frontend `01d0ba9`; fast-forwarded the clean checkout to `d87408f` to include both remote Java commits. No framework replacement.

Reviewed React state/workflow/scoring/evidence/styling/tests, Java CLI/data/features/models/imputation/explanations/backtests/metrics/reporting/tests, and deployment/build/editor configuration.

Remote commits `2737c2c` and `5744488` added the Python sourcing engine. Their schemas, prompts, API and evidence-only design were preserved. The first integration (`a49d024`) repaired silent ungrounded fallback, missing provenance, unsupported claims, identity mismatches, report paths and atomic writes. This follow-up started from a clean checkout of `a49d024`; repeated fetches found no newer teammate commits. Reviewed all three application trees, test suites, tracked assets, configuration, source contracts and deployment files before integration.

Python is now connected: same-origin authenticated gateways, regional/company/universe caching, orchestration and a separate model-assisted verification search. The frontend validates identity/schema/citations, separates live reports from fixtures, retains contradictions/data gaps, sends only sourced or supplied structured facts to Java, and uses the existing regional fusion policy. No paid OpenAI call was made: no API key was configured. Historical tracked patches were scanned for common credential patterns with no matches; secrets were not printed.

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
| Python was not reachable from discovery and had no auth | Reused its endpoints through authenticated Vercel gateways; added auth to every `/api/v1/*` route |
| Phase 1 required manual sequencing and repeated paid work | Company orchestration reuses keyed regional framework; TTL caches and one-worker request deduplication |
| Citations could be confused with verification | Separate search, exact claim identity, retrieved URLs, dated sources, origin/domain checks, explicit model-assisted provenance |
| Live research risked inheriting fixture ownership or financials | Separate live adapter; no fixture merge, no owner/role invention, dated sourced fields only |
| Old outreach draft could outlive its source investigation | New investigation clears that company's saved draft |
| Nordics list omitted Norway/Iceland | Shared regional country list now covers both |
| OpenAI minimum version predated the Responses API | Pinned the six existing Python packages to the versions exercised in tests; no new runtime dependencies |

Preserved logistic/boosted models, imputation, backtesting, CLI, public evidence and cross-checks, contradictions, regional logic, filters, shortlist, saved drafts and responsive layout. Gson is the only Java runtime dependency added; no frontend runtime dependency added.

Validation: Maven verification (60 tests); production Vite/TypeScript build; two Node gateway tests; 13 Playwright tests including the complete browser → Python → Java → combined result → outreach path; ten Python integrity/API tests. The full HTTP test ran actual FastAPI orchestration, authentication, verification, caching and the actual Java service, replacing only external OpenAI transport with recorded responses. Desktop/mobile checks found no horizontal overflow. This is not a live-web accuracy test.

Remaining limits: hosted Java/Python services and their Vercel environment variables must be provisioned, and a funded OpenAI API key is required for live web research. Until then the public site clearly labels fallback. Prepared examples are still fixtures; default model training is synthetic; the regional priority policy is uncalibrated. Verification is automated, not human-certified. Caches on free Render storage do not survive every restart; use a persistent disk if required. Docker is unavailable locally, so images were not executed; their Java/Python entry points were tested directly. See [exact deployment steps](DEPLOYMENT.md).
