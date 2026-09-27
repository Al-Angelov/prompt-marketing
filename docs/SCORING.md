# Mergero Priority Score policy v3

The only implementation is `sourcing-engine/app/services/assessment.py`. Research classifies evidence but never supplies a number. The score ranks how worthwhile further investigation is. It does not measure an owner's willingness to sell. The weights are provisional and informed by the literature below; they are not calibrated probabilities.

## Why v3

Under v2, public points required two independent sources, then got multiplied by four more factors between 0 and 1. The structured model was capped at 10% × coverage. In practice, almost every company scored 0–3. v3 keeps the same safeguards but works in odds, so missing information counts as *average* rather than *zero*.

## Formula

Each factor is a shift Δ in log-odds relative to a typical company in the same country.

```
Priority   = round_half_up(clamp(50 + 25·log2(e^ΣΔ), 0, 100))     # 25/ln2 ≈ 36.07 points per unit of log-odds
Likelihood = sigmoid(logit(base_rate) + ΣΔ)                          # indicative 12-month sale likelihood
```

Reading the score:
- 50 is a typical company.
- 75 means twice the odds of a typical company.
- 100 means four times the odds or more.
- 25 means half the odds.

Each factor's points appear in the report and they sum exactly to the priority (before clamping).

## Factors

| Category | Δ (log-odds) | Source |
|---|---|---|
| Company data | Java model contribution per business concept (owner age, size, leverage, …), **observed inputs only**. Imputed inputs count 0. Halved when the model is trained on synthetic data. Each group is capped at ±ln 3. | Official registry facts, or sourced facts from research |
| Sector owner ageing | 0.75 · ln(sector share of self-employed aged 50+ ÷ national share), capped at ±ln 1.4 | Eurostat `lfsa_esgan2` |
| Sector workforce ageing | 0.35 · ln(sector share of workers aged 50+ ÷ national share), capped at ±ln 1.15 | Eurostat `lfsa_egan2` |
| Official record | ln(LR) × quality × recency. Examples: BODACC management change (LR 1.35), share-capital change (1.15), Big-4 auditor at a company with fewer than 100 employees (1.15). | BODACC, Brønnøysund |
| Public evidence | ln(LR_kind) × verification × strength × recency × source reliability. At most 3 distinct events count. | Web research |
| Contradiction | −ln 1.5 per distinct contradicting event, at most 2 events | Web research |

Values used in the public-evidence and official-record formulas:
- **Event likelihood ratios (LR_kind):** explicit_exit 6, leadership 2, liquidity 1.7, operational 1.5, partnership 1.4, growth 1.3.
- **Verification:** Verified 1, partially verified 0.5, unverified with a retrieved source 0.25.
- **Regional strength:** strong 1, medium 0.75, weak 0.5.
- **Recency:** 1 up to 365 days old, 0.7 up to 730 days, 0.4 when older, 0.5 when the date is unknown. Future dates count 0.
- **Source reliability:** high 1, medium 0.8, low 0.5.

Only kinds in {leadership, operational, growth, liquidity, partnership, explicit_exit} with a positive direction earn public points. Claims linked to `structured_fields` earn nothing, because the model already counts those facts. Repeated `event_id`s count once. A contradicted event loses its positive points.

**Base rate:** the model's training base rate (about 1.5%/year, consistent with the ~1–3% annual SME ownership-change rates reported in business-transfer studies), or 1.5% when the model is unavailable.

**Negative equity** (liabilities over assets) is outside the model's training range. It is shown as a distress note and left out of the score. A distressed sale is a different situation from a succession sale.

## Confidence and contact rules (unchanged in spirit)

Confidence value:
- 0.45 × verified checklist coverage
- \+ 0.35 × model input coverage
- \+ 0.10 if sector statistics are available
- \+ 0.10 if official registry data is available

Caps:
- 0.69 if verification is incomplete, there are contradictions, or Java is unavailable
- 0.79 for synthetic training

Bands: High is 0.8 or above, Moderate 0.5 or above, otherwise Low.

Contact rules:
- **Contact** requires priority 70 or above, High confidence, fully verified principal evidence, a non-synthetic model and no contradictions.
- **A review draft** requires priority 65 or above and fully verified principal evidence.
- A registry screen alone never produces a draft.

## Literature behind the factors

- **Owner age and succession.** Retirement is the main reason owners transfer SMEs (European Commission business-transfer studies). Family-firm succession outcomes are covered by Bennedsen, Nielsen, Pérez-González & Wolfenzon (2007, *QJE*).
- **Sector waves.** Takeovers cluster in industries hit by economic, technological or regulatory shocks (Mitchell & Mulherin 1996, *JFE*; Harford 2005, *JFE*).
- **Size and financial profile.** Palepu (1986, *JAE*) covers size, growth and resource imbalance. It also shows that target prediction has modest accuracy, which is why this is a *priority* rather than a probability.
- **Leverage** has an inverse-U relationship with sale likelihood. Profitable, mid-sized firms attract buyers.

## Next steps toward calibration

Replace synthetic training with real outcomes:
- French BODACC "Ventes et cessions" notices and ownership changes
- UK Companies House ownership (PSC) changes

Then fit the likelihood ratios on held-out years with the existing walk-forward backtest in `data-analysis/`.
