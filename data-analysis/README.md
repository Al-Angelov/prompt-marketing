# ma-score

Scores companies on how likely they are to be sold (acquired) in the coming year, and says why.
It's a proof of concept for an M&A origination tool. The production code is plain Java 21 with no dependencies.

```
mvn -q compile exec:java                                          # synthetic data, full report
mvn -q compile exec:java -Dexec.args="--data companies.csv"       # your data
mvn -q compile exec:java -Dexec.args="--help"
mvn -q test
```

A full run on 20,000 simulated companies takes about 7 seconds. It writes
`target/output/scores-<year>.csv` (every company, ranked, with reasons) and `target/output/backtest.csv`.

## What it does

1. **Loads company-years.** Each row is one company at the start of one year, with the latest filed
   accounts and a label saying whether it was sold during that year.
2. **Runs a walk-forward backtest.** For each of the last N years, it trains on all earlier years and
   tests on that year. That matches how the model would run in production, so no future information
   leaks in (a test checks this).
3. **Compares models against baselines:**
   - base rate (everyone gets the average)
   - a one-variable rule of thumb (owner age)
   - L2 logistic regression (Newton/IRLS, exact optimum)
   - gradient-boosted trees
   - on synthetic data only, an **oracle** that uses the true probability, which shows the best any
     model could do
4. **Reports** the following:
   - AUC with a 95% CI from a company-clustered bootstrap
   - PR-AUC, Brier score and log loss
   - lift at 5% and 10%, and recall at 10%
   - AUC by test year
   - a calibration table
5. **Retrains the best model on all history and scores the latest year.** Every score breaks down
   exactly into additive log-odds contributions. For trees this uses the Saabas path method. The
   contributions are grouped into business drivers ("owner aged 71 (+1.12)").

## Results on synthetic data (seed 42)

| model | AUC | lift@10% | recall@10% |
|---|---|---|---|
| Rule of thumb (owner age) | 0.699 | 3.5x | 35% |
| Logistic regression | 0.742 | 3.9x | 39% |
| Gradient boosting | 0.736 | 3.8x | 38% |
| Oracle (ceiling) | 0.767 | 4.2x | 42% |

- **Ranking:** the models close most of the gap between the rule of thumb and the ceiling. Calling
  the top 10% reaches about 40% of next year's sellers.
- **Calibration:** holds up. Top-decile companies were predicted at 5.95% and sold at 5.83%.
- **Model choice:** logistic regression with a few domain-shaped features (squared leverage and size
  terms, an owner-over-62 flag) matches boosting here. Boosting's advantage should show up on real
  data with interactions nobody has hand-coded. Both models stay in the comparison.

**These numbers show that the pipeline works, not that the model works on real companies.** The
simulator's hidden rules were written by us, so it can only confirm that the methods can recover
them and that the evaluation is honest.

## Using real data

Pass a CSV with these columns (any order; extra columns are ignored). Leave a cell empty if the
value is missing. Leave `sold` empty for the year you want to score.

| column | meaning |
|---|---|
| `id` | company identifier (e.g. CIF) |
| `year` | observation year; features must be known at the start of it |
| `sector` | sector label |
| `foundedYear` | year of incorporation |
| `revenueK` | revenue, EUR thousands, latest filed accounts |
| `employees` | headcount |
| `ebitdaMargin` | EBITDA / revenue (0.12 = 12%) |
| `leverage` | total debt / total assets |
| `revenueGrowth3y` | 3-year revenue CAGR (0.05 = 5%) |
| `maxDirectorTenure` | years served by the longest-serving director |
| `ownerAge` | age of the controlling shareholder |
| `familyOwned` | 1/0 |
| `shareholders` | number of shareholders |
| `sectorDeals24m` | sector M&A deals in the prior 24 months per 1,000 firms |
| `sold` | 1 if acquired during `year`, 0 if not, empty if not yet known |

`--export-data synthetic.csv` writes the simulated panel in this format, as an example to copy.

Two data traps to watch for. Both inflate backtest results:

- **Filing lag.** Spanish accounts are filed months after year end. `year`'s features must be ones
  that were actually *available* on 1 January of that year.
- **Survivorship.** Keep dissolved and acquired companies in the history until they exit. Dropping
  them biases the base rate and the features.

## Layout

```
hack/Main.java, Config.java   CLI and the end-to-end run
hack/data/                    CompanyYear, CSV reader and writer, simulator
hack/features/                feature definitions, grouped into business drivers
hack/model/                   Trainer / ScoringModel interfaces, models, imputation and column-subset decorators
hack/eval/                    metrics, bootstrap, walk-forward backtest
hack/report/                  explanations and console tables
```

To add a model, implement `Trainer` (which returns a `ScoringModel`) and add it to `Main.trainers()`.
It then shows up in the backtest, the comparison table and the selection automatically.
`ScoringModelContractTest` checks that its explanations add up to its scores.

## Known limitations and next steps

- **Hyperparameters are fixed.** They were chosen once on a different simulator seed. With real data,
  tune them inside the walk-forward loop, for example on the last training year.
- **The label is "sold within one year".** A 2–3 year horizon, or a survival model, may suit
  origination better.
- **Missing values use median imputation.** On real data the fact that a value is missing can itself
  predict a sale (for example, unfiled accounts). Consider adding missing-value indicator columns.
- **There is no monitoring yet.** Before relying on it, track drift in the inputs and in calibration
  over time.
