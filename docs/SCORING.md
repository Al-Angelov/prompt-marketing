# Mergero Priority Score policy v2

The sole implementation is `sourcing-engine/app/services/assessment.py`. Research classifies evidence; it never supplies a numeric priority. The score ranks how worthwhile further investigation is, not owner willingness to sell. These are provisional policy weights, not calibrated probabilities.

For each positive company timing event:

`points = (100 / 3) × regional strength × verification × recency × evidence confidence`

- Regional strength: strong 1, medium 0.65, weak 0.35. Regional signals without retrieved supporting URLs are downgraded to weak.
- Verification: 1 for independently verified; 0.25 for partially verified after a separate search; 0 otherwise. Verification requires dated sources, distinct editorial origins and domains, and an explicit independence basis. Syndicated releases share one origin.
- Recency from latest supporting publication, evaluated on the saved assessment date: at most 365 days = 1; at most 730 = 0.7; older = 0.4; unknown = 0.2. Future dates are unusable.
- Evidence confidence: high 1; medium 0.75; low 0.4. This is a source-quality classification, not statistical confidence.
- Eligible kinds: leadership, operational, growth, liquidity, partnership, explicit_exit. Context, numeric/ownership structured facts, and claims linked to `structured_fields` earn no public points.
- Repeated `event_id` values (or identical normalized claims when no event ID exists) earn points only once. Keep the strongest instance and sum the three strongest distinct events to obtain public score P (0–100). Event identification is model-assisted and needs analyst review.

Let C be Java's supplied input count / 11 and R its reference-cohort percentile. Nominal cap is 0.65 for Finland, Sweden, Denmark, Norway and Iceland; 0.25 elsewhere. This preserves the existing regional policy only as a provisional upper bound for future real-data models. For synthetic models, the cap is further limited to 0.10. Actual weight w = cap × C; w = 0 if Java has no usable result. Java runs with at least two sourced, dated fields; missing inputs remain null/omitted and model-internal imputation is disclosed.

Each distinct contradictory/negative event subtracts 20 points, capped at 40, after blending. A conflict also disqualifies that event's positive points.

`Priority = round_half_up(clamp((1 − w) × P + w × R − min(40, 20 × contradictory_events), 0, 100))`

Zero means no established priority under this policy, not proof against a transaction. Structured propensity remains separately visible and is labeled `synthetic / demonstration model` when applicable.

Confidence value = 0.7 × min(1, sum(recency × evidence confidence for verified checklist claims) / expected checklist count) + 0.3 × C. Missing evidence and model fields reduce it. Cap at 0.69 if verification is incomplete, contradictions exist, or Java is unavailable; cap at 0.79 for synthetic training. High ≥0.8, Moderate ≥0.5, otherwise Low. This category describes completeness/reliability, not statistical certainty. Duplicate-event scoring is suppressed; confidence counts checklist coverage, which is a separate quantity.

Reports save the policy version, assessment date, per-claim multipliers, chosen factors, public/model contributions, regional/synthetic caps, coverage, percentile, contradiction penalty, confidence value, complete research evidence and Java response. An analyst can reproduce the calculation without another model call. The UI downloads the same canonical JSON written by Python.
