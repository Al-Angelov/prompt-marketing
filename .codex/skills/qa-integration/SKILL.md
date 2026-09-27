---
name: qa-integration
description: Audit and verify the Mergero full-stack investigation flow after frontend, backend, model, API, deployment, or schema changes. Use this skill before declaring integration work complete.
---

# Goal

Prove the real product flow works end to end and catch conflicts introduced by multiple agents or teammate commits.

# Required audit

Trace one real request:

Country + Industry
→ `/api/investigate-market`
→ regional research
→ company discovery
→ company evidence
→ verification
→ structured extraction
→ Java model when enough data exists
→ deterministic Priority Score
→ persisted company report
→ frontend ranked results.

# Check for

- stale or duplicated scoring logic
- obsolete mocked data accidentally used in production
- schema mismatches across TypeScript, Python, and Java
- wrong endpoint paths
- broken environment variable names
- silent ungrounded AI fallback
- invented structured values
- missing provenance
- contradictory evidence being dropped
- double-counting the same signal
- secrets exposed through `VITE_*`, frontend code, logs, or reports
- backend failures presented as successful research
- race conditions or duplicate investigation jobs
- agent commits that overwrite newer teammate work

# Testing

Run what applies:

- `npm run build`
- `npm test`
- Playwright/integration tests
- Python tests
- Python health endpoint
- Maven tests
- Java health endpoint
- one complete market investigation

If a dependency is unavailable, report the exact blocker rather than claiming success.

# Definition of done

Report:
1. what was tested
2. what failed
3. what was fixed
4. whether frontend → Python → Java → score/report works
5. remaining deployment/config blockers

Do not declare the system working merely because it compiles.
