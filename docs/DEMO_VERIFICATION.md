# Demo verification and research limits

The seven-dimension update is verified with recorded research transports and local browser tests. These checks do not prove that a particular private company has publicly available contacts, owner intentions, accounts or valuation data. No live research or enrichment calls are needed to run the tests.

## Rehearse safely

1. In the production app, select a country and industry previously researched on that browser. Search opens saved research immediately, with its original dates, without contacting the backend. Potential Sellers and Outreach also read the saved library.
2. Export that library and keep the backup in the presentation browser. A fresh browser has an empty local library.
3. For the expanded seven-dimension data, run a new investigation before the presentation when live research is authorized. Old reports are preserved, not retroactively relabeled as newly researched.
4. Confirm the actual selected company's facts, contacts and message before choosing it for the demo. The absence of sale intent is not an error or proof of unwillingness to sell.
5. Use **Check for updates** only if live research is intended; it may reuse recent server caches. Updates run the quick screen and deep workflow concurrently. A failed update keeps saved reports available. A new market still depends on registry, research and hosting availability, so keep a completed report available. Daily scheduling is still a proposed operating model, not an implemented feature.

## Latency and cost controls

- Browser replay: no network requests or research charges. A library backup can be imported into the presentation browser ahead of time.
- Server replay: completed verified investigations reuse a 24-hour cache by default, including after process restart while its disk survives. Cached original report dates remain unchanged.
- Fresh research: three companies by default, parallel company work, regional/company cache reuse, no automatic SDK retries, six built-in tool calls maximum per search-stage response, and 12,000 output tokens maximum per response. These limits are configurable and are not a fixed dollar guarantee. JSON schema is supplied once via the strict extraction contract.
- Java scoring: eight-second request timeout, 60-second failure cooldown and five-minute successful-score cache. Missing model contributions remain disclosed; evidence and outreach are never fabricated to conceal an outage.
- Offline tests validate orchestration and request bounds, not actual provider latency, paid research quality or current prices. Do not claim a brand-new live market will finish instantly.

## Offline checks

Run `npm run build` and `npm test`. Run the Python suite with the sourcing-engine virtual environment: `python -m unittest discover -s tests -q` from that directory. Tests replace external transports with recorded responses; do not use the optional live harness or warm-demo script when research/API calls are prohibited.

The recorded pipeline exercises discovery, source grounding, verification, mocked Java response validation, seven-dimension report persistence, contact provenance, and final ranking. Browser tests cover rendering, missing evidence, safe links, storage/reload/import, responsive layout and search controls. Live research quality must be evaluated separately on actual returned evidence.
