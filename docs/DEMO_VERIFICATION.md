# Demo verification and research limits

The seven-dimension update is verified with recorded research transports and local browser tests. These checks do not prove that a particular private company has publicly available contacts, owner intentions, accounts or valuation data. No live research or enrichment calls are needed to run the tests.

## Rehearse safely

1. In the production app, use a previously completed investigation from Potential Sellers to demonstrate the saved evidence and Outreach plan without a new research call.
2. Export that library and keep the backup in the presentation browser. A fresh browser has an empty local library.
3. For the expanded seven-dimension data, run a new investigation before the presentation when live research is authorized. Old reports are preserved, not retroactively relabeled as newly researched.
4. Confirm the actual selected company's facts, contacts and message before choosing it for the demo. The absence of sale intent is not an error or proof of unwillingness to sell.
5. A cold live search depends on registry, research and hosting availability. Keep a completed report available for the presentation. Daily scheduling is still a proposed operating model, not an implemented feature.

## Offline checks

Run `npm run build` and `npm test`. Run the Python suite with the sourcing-engine virtual environment: `python -m unittest discover -s tests -q` from that directory. Tests replace external transports with recorded responses; do not use the optional live harness or warm-demo script when research/API calls are prohibited.

The recorded pipeline exercises discovery, source grounding, verification, mocked Java response validation, seven-dimension report persistence, contact provenance, and final ranking. Browser tests cover rendering, missing evidence, safe links, storage/reload/import, responsive layout and search controls. Live research quality must be evaluated separately on actual returned evidence.
