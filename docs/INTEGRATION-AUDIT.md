# Current integration audit

Audited current tracked application sources, Java models/CLI/tests, Python services/schemas/tests, frontend/gateways/tests, assets, dependency lockfile, deployment and editor configuration before modifying code. Fetched and fast-forward checked main at `b8e30df`; no remote changes were pending. Preserved initial uncommitted config/schema/client changes and connected the untracked regional prompt template. No history rewriting or force push.

Retained the two-selector UI, single market start/poll endpoint, cached research, required web search, separate cited-source gathering and extraction, independently searched verification, nullable Java inputs, source provenance, authentication and tested Java models.

Repaired missing final report persistence/return, unused regional template, three-company cap, absence of regional strength/recency/event deduplication, excessive synthetic weighting, lost structured-value conflicts and research gaps, generation without strict schema enforcement, missing score breakdown/download, misleading progress initiation and stale documentation. Canonical reports now live in `STORAGE_DIR/reports/<job-id>/<report-id>.json`. Raw research artifacts remain intermediate records. Failed company attempts get an explicit empty evidence report and warning; they never become invented opportunities.

One authoritative priority policy lives in `assessment.py`; see [exact scoring](SCORING.md). Model training code was retained. Search, extraction and verification remain separate. Browser requests send only country/industry, then poll. Final results embed the exact persisted report.

Common credential-pattern scans of all 107 tracked files and full git patch history found no matches. This is a bounded pattern scan, not a credential audit guarantee. No environment files or secrets were printed or committed.

Validation is recorded in the final task response. Offline integration replaces only OpenAI transport: actual browser, Vite gateway, FastAPI pipeline and Java service execute. Live-web tests are reported separately from offline results. Default Java training is synthetic; heuristic weights and automated source verification remain unvalidated for real-world transaction prediction.

Free-host storage is temporary, jobs are in-process, and only one Python worker is supported. See [deployment](DEPLOYMENT.md) for persistent storage and service configuration. No production deployment was performed by this change.

## Validation from this change

- `npm run build`: passed TypeScript and production Vite build.
- `npm test` with `FULL_STACK_URL=http://localhost:5174`: 3 gateway tests and all 5 Playwright tests passed, including actual Python/Java HTTP integration with recorded OpenAI transport.
- Python unittest discovery: 26 tests passed.
- Maven `verify`: 60 tests passed; packaged the server JAR.
- Live Germany / Industrial manufacturing investigation: discovered five candidates; two completed with actual web research, one executed actual Java scoring. Three failed because provider responses had no retrievable source URLs; no fixtures replaced them. Five report files persisted, including failed attempts. Priorities were 1 and 0, both Low confidence.
- Replayed those actual live result payloads in the browser: both scores displayed, both downloaded JSON files exactly matched their report payloads, desktop/mobile rendering had no horizontal overflow. This display check is separate from the recorded full HTTP test above.
- `git diff --check` passed; final fetch found zero commits ahead of local main. Changes remain local and uncommitted; production was not redeployed.

Live source coverage remains incomplete. Successful transport and schema checks do not validate every factual claim, source's credibility, event classification, or model calibration. Automated verification should be reviewed by an analyst. The app reports this uncertainty instead of manufacturing high scores.
