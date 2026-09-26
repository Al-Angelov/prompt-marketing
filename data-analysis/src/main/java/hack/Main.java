package hack;

import hack.data.*;
import hack.eval.Backtest;
import hack.eval.Evaluation;
import hack.eval.Metrics;
import hack.features.FeatureGroup;
import hack.features.FeatureSet;
import hack.model.*;
import hack.report.Explainer;
import hack.report.TextTable;

import java.io.IOException;
import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.stream.Collectors;

/**
 * M&A propensity scoring, end to end:
 * load data -> walk-forward backtest of several models -> pick the best -> retrain on all history
 * -> score the current year with reasons -> write CSVs.
 */
public final class Main {

    private final Config config;
    private final PrintStream out;

    Main(Config config, PrintStream out) {
        this.config = config;
        this.out = out;
    }

    public static void main(String[] args) throws IOException {
        Config config;
        try {
            config = Config.parse(args);
        } catch (Config.HelpRequested e) {
            System.out.print(Config.USAGE);
            return;
        } catch (IllegalArgumentException e) {
            System.err.println("error: " + e.getMessage());
            System.err.print(Config.USAGE);
            System.exit(2);
            return;
        }
        new Main(config, System.out).run();
    }

    /** The models under comparison. Adding one here is all it takes to include it everywhere. */
    static List<Trainer> trainers(FeatureSet fs) {
        int[] ownerAge = {fs.indexOf("ownerAge"), fs.indexOf("ownerOver62")};
        return List.of(
                new BaseRate(),
                new Imputing(new ColumnSubset("Rule of thumb (owner age)", ownerAge, new LogisticRegression(1.0))),
                new Imputing(new LogisticRegression(1.0)),
                new Imputing(new GradientBoosting(GradientBoosting.Params.defaults())));
    }

    void run() throws IOException {
        long t0 = System.nanoTime();
        DataSource source = config.data() != null
                ? new CsvDataSource(config.data())
                : new SyntheticDataSource(config.companies(), config.fromYear(), config.toYear(), config.seed());
        List<CompanyYear> rows = source.load();
        if (rows.isEmpty()) throw new IllegalStateException("no data");
        if (config.exportData() != null) CsvCodec.write(rows, config.exportData());

        // ---------- data ----------
        heading("Data: " + source.describe());
        int scoringYear = rows.stream().mapToInt(CompanyYear::year).max().orElseThrow();
        int firstYear = rows.stream().mapToInt(CompanyYear::year).min().orElseThrow();
        List<CompanyYear> history = rows.stream().filter(r -> r.year() < scoringYear && r.labeled()).toList();
        List<CompanyYear> current = rows.stream().filter(r -> r.year() == scoringYear).toList();
        printDataSummary(rows);

        FeatureSet fs = FeatureSet.standard();
        printMissingness(fs, rows);

        int lastTest = scoringYear - 1, firstTest = lastTest - config.folds() + 1;
        if (firstTest - firstYear < 2)
            throw new IllegalArgumentException("need at least 2 training years before the first test year; use fewer --folds");

        // ---------- backtest ----------
        List<Trainer> trainers = trainers(fs);
        heading("Walk-forward backtest: train on all years before Y, test on Y, for Y = %d..%d".formatted(firstTest, lastTest));
        Backtest.Result bt = Backtest.run(history, fs, trainers, firstTest, lastTest);
        int[] y = bt.pooledLabels();
        String[] ids = bt.pooledRows().stream().map(CompanyYear::id).toArray(String[]::new);

        List<Evaluation> evals = new ArrayList<>();
        for (String m : bt.models())
            evals.add(Evaluation.of(m, bt.pooledScores(m), y, ids, config.bootstrap(), config.seed()));
        if (source instanceof SyntheticDataSource syn) {
            double[] truth = bt.pooledRows().stream().mapToDouble(r -> syn.trueProbability(r).orElseThrow()).toArray();
            evals.add(Evaluation.of("Oracle (true probability)", truth, y, ids, config.bootstrap(), config.seed()));
        }
        printEvaluations(evals);
        printPerYear(bt);

        Evaluation best = evals.stream()
                .filter(e -> bt.models().contains(e.model()) && !e.model().equals("Base rate"))
                .max(Comparator.comparingDouble(Evaluation::auc)).orElseThrow();
        Trainer bestTrainer = trainers.stream().filter(t -> t.name().equals(best.model())).findFirst().orElseThrow();
        out.printf("%nSelected model: %s (highest pooled AUC).%n", best.model());
        printCalibration(bt.pooledScores(best.model()), y);

        // ---------- final model ----------
        ScoringModel model = bestTrainer.fit(fs.matrix(history), history.stream().mapToInt(CompanyYear::sold).toArray());
        Explainer explainer = new Explainer(fs, model);
        if (current.isEmpty()) {
            out.println("\nNothing to score.");
            return;
        }
        double[] scores = current.stream().mapToDouble(r -> model.score(fs.extract(r))).toArray();
        Integer[] order = new Integer[current.size()];
        for (int i = 0; i < order.length; i++) order[i] = i;
        Arrays.sort(order, (a, b) -> Double.compare(scores[b], scores[a]));

        printDrivers(fs, explainer, current, order);
        double baseRate = history.stream().filter(r -> r.year() == lastTest).mapToInt(CompanyYear::sold).average().orElse(Double.NaN);
        printTargets(scoringYear, current, scores, order, explainer, baseRate);
        if (current.stream().allMatch(CompanyYear::labeled)) printHindsight(scoringYear, current, scores, order);

        // ---------- files ----------
        Files.createDirectories(config.out());
        Path scoresFile = config.out().resolve("scores-" + scoringYear + ".csv");
        Path backtestFile = config.out().resolve("backtest.csv");
        writeScores(scoresFile, current, scores, order, explainer);
        writeBacktest(backtestFile, bt);
        out.printf("%nWrote %s and %s", scoresFile, backtestFile);
        if (config.exportData() != null) out.printf(" and %s", config.exportData());
        out.printf("%nDone in %.1f s%n", (System.nanoTime() - t0) / 1e9);
    }

    // ---------- sections ----------

    private void printDataSummary(List<CompanyYear> rows) {
        long companies = rows.stream().map(CompanyYear::id).distinct().count();
        out.printf("%,d company-years, %,d companies%n%n", rows.size(), companies);
        TextTable t = new TextTable("year", "companies", "sold", "sale rate");
        rows.stream().collect(Collectors.groupingBy(CompanyYear::year, TreeMap::new, Collectors.toList()))
                .forEach((year, rs) -> {
                    long labeled = rs.stream().filter(CompanyYear::labeled).count();
                    long sold = rs.stream().filter(r -> r.sold() == 1).count();
                    t.row(year, "%,d".formatted(rs.size()),
                            labeled == 0 ? "?" : "%,d".formatted(sold),
                            labeled == 0 ? "unknown" : pct(sold / (double) labeled, 2));
                });
        out.print(t.render("  "));
    }

    private void printMissingness(FeatureSet fs, List<CompanyYear> rows) {
        double[][] x = fs.matrix(rows);
        TextTable t = new TextTable("feature", "missing");
        for (int i = 0; i < fs.size(); i++) {
            int miss = 0;
            for (double[] r : x) if (Double.isNaN(r[i])) miss++;
            if (miss > 0) t.row(fs.names().get(i), pct(miss / (double) x.length, 1));
        }
        out.println("\nMissing values (imputed with the training median):");
        out.print(t.render("  "));
    }

    private void printEvaluations(List<Evaluation> evals) {
        Evaluation first = evals.getFirst();
        out.printf("Pooled out-of-sample predictions: %,d company-years, %,d sales (%s)%n%n",
                first.rows(), first.positives(), pct(first.positives() / (double) first.rows(), 2));
        TextTable t = new TextTable("model", "AUC", "95% CI", "PR-AUC", "Brier", "log loss", "lift@5%", "lift@10%", "recall@10%");
        for (Evaluation e : evals)
            t.row(e.model(), f3(e.auc()), Double.isNaN(e.aucLow()) ? "-" : "%.3f-%.3f".formatted(e.aucLow(), e.aucHigh()),
                    f3(e.averagePrecision()), "%.5f".formatted(e.brier()), "%.4f".formatted(e.logLoss()),
                    "%.2fx".formatted(e.liftTop5()), "%.2fx".formatted(e.liftTop10()), pct(e.recallTop10(), 1));
        out.print(t.render("  "));
        out.print("""
                  AUC: chance a sold company ranks above an unsold one (0.5 = random). CI resamples companies.
                  PR-AUC: precision averaged over recall; no-skill value = sale rate. Brier/log loss: lower is better.
                  lift@k: sale rate in the top k% vs overall. recall@10%: share of all sales caught in the top 10%.
                  (Base rate is constant within a year; pooled across years its AUC drifts slightly off 0.5.)
                """);
    }

    private void printPerYear(Backtest.Result bt) {
        List<String> models = bt.models().stream().filter(m -> !m.equals("Base rate")).toList();
        String[] headers = new String[3 + models.size()];
        headers[0] = "test year";
        headers[1] = "rows";
        headers[2] = "sold";
        for (int i = 0; i < models.size(); i++) headers[3 + i] = "AUC " + models.get(i);
        TextTable t = new TextTable(headers);
        for (Backtest.Fold f : bt.folds()) {
            int[] y = f.labels();
            Object[] cells = new Object[headers.length];
            cells[0] = f.testYear();
            cells[1] = "%,d".formatted(y.length);
            cells[2] = Arrays.stream(y).sum();
            for (int i = 0; i < models.size(); i++) cells[3 + i] = f3(Metrics.auc(f.scores().get(models.get(i)), y));
            t.row(cells);
        }
        out.println("\nStability by test year:");
        out.print(t.render("  "));
    }

    private void printCalibration(double[] s, int[] y) {
        TextTable t = new TextTable("score decile", "predicted", "observed", "rows", "sold");
        List<Metrics.CalibrationBin> bins = Metrics.calibration(s, y, 10);
        for (int i = bins.size() - 1; i >= 0; i--) {
            var b = bins.get(i);
            t.row(i == bins.size() - 1 ? "10 (highest)" : i == 0 ? "1 (lowest)" : Integer.toString(i + 1),
                    pct(b.meanPredicted(), 2), pct(b.observedRate(), 2), "%,d".formatted(b.count()), b.positives());
        }
        out.println("\nCalibration (does a 5% score mean 5% of those companies sell?):");
        out.print(t.render("  "));
    }

    private void printDrivers(FeatureSet fs, Explainer explainer, List<CompanyYear> current, Integer[] order) {
        List<FeatureGroup> groups = fs.groups();
        double[] meanAbs = new double[groups.size()], meanTop = new double[groups.size()];
        int top = Math.max(1, current.size() / 20);
        for (int r = 0; r < order.length; r++) {
            double[] g = explainer.byGroup(current.get(order[r]));
            for (int i = 0; i < g.length; i++) {
                meanAbs[i] += Math.abs(g[i]) / order.length;
                if (r < top) meanTop[i] += g[i] / top;
            }
        }
        Integer[] idx = new Integer[groups.size()];
        for (int i = 0; i < idx.length; i++) idx[i] = i;
        Arrays.sort(idx, (a, b) -> Double.compare(meanAbs[b], meanAbs[a]));
        TextTable t = new TextTable("driver", "avg |impact|", "avg impact in top 5%");
        for (int i : idx) t.row(groups.get(i).label(), "%.3f".formatted(meanAbs[i]), "%+.3f".formatted(meanTop[i]));
        heading("What drives the score (log-odds, final model on all history)");
        out.print(t.render("  "));
    }

    private void printTargets(int year, List<CompanyYear> current, double[] scores, Integer[] order,
                              Explainer explainer, double baseRate) {
        heading("Top %d companies to approach in %d".formatted(Math.min(config.top(), order.length), year));
        TextTable t = new TextTable("#", "id", "sector", "P(sale)", "vs avg", "why").leftAlign(1, 2, 5);
        for (int r = 0; r < Math.min(config.top(), order.length); r++) {
            CompanyYear c = current.get(order[r]);
            String why = explainer.reasons(c, 3).stream().map(Explainer.Reason::toString).collect(Collectors.joining("; "));
            t.row(r + 1, c.id(), c.sector(), pct(scores[order[r]], 1), "%.1fx".formatted(scores[order[r]] / baseRate), why);
        }
        out.print(t.render("  "));
        out.printf("  vs avg = score / last year's sale rate (%s). Reasons show log-odds impact vs a typical company.%n", pct(baseRate, 2));
    }

    private void printHindsight(int year, List<CompanyYear> current, double[] scores, Integer[] order) {
        int[] y = current.stream().mapToInt(CompanyYear::sold).toArray();
        int n = Math.min(config.top(), order.length), hits = 0;
        for (int r = 0; r < n; r++) hits += y[order[r]];
        double rate = Arrays.stream(y).average().orElse(0);
        out.printf("%nHindsight (outcomes for %d are known here, which would not be true in production):%n", year);
        out.printf("  %d of the top %d were sold in %d (%.1f expected at random); AUC %.3f, top 10%% caught %s of sales%n",
                hits, n, year, n * rate, Metrics.auc(scores, y), pct(Metrics.recallAt(scores, y, 0.10), 1));
    }

    // ---------- files ----------

    private void writeScores(Path file, List<CompanyYear> current, double[] scores, Integer[] order, Explainer explainer) throws IOException {
        try (var w = Files.newBufferedWriter(file)) {
            w.write("rank,id,sector,score,reason1,reason2,reason3\n");
            for (int r = 0; r < order.length; r++) {
                CompanyYear c = current.get(order[r]);
                List<String> reasons = new ArrayList<>(explainer.reasons(c, 3).stream().map(Explainer.Reason::toString).toList());
                while (reasons.size() < 3) reasons.add("");
                w.write("%d,%s,%s,%.6f,%s%n".formatted(r + 1, csv(c.id()), csv(c.sector()), scores[order[r]],
                        reasons.stream().map(Main::csv).collect(Collectors.joining(","))));
            }
        }
    }

    private void writeBacktest(Path file, Backtest.Result bt) throws IOException {
        try (var w = Files.newBufferedWriter(file)) {
            w.write("model,testYear,rows,sold,auc,averagePrecision,brier,logLoss,liftTop10\n");
            for (Backtest.Fold f : bt.folds()) {
                int[] y = f.labels();
                for (String m : bt.models()) {
                    double[] s = f.scores().get(m);
                    w.write("%s,%d,%d,%d,%.5f,%.5f,%.6f,%.6f,%.4f%n".formatted(csv(m), f.testYear(), y.length, Arrays.stream(y).sum(),
                            Metrics.auc(s, y), Metrics.averagePrecision(s, y), Metrics.brier(s, y), Metrics.logLoss(s, y),
                            Metrics.liftAt(s, y, 0.10)));
                }
            }
        }
    }

    // ---------- formatting ----------

    private void heading(String title) { out.printf("%n== %s ==%n%n", title); }

    private static String pct(double v, int decimals) { return Double.isNaN(v) ? "n/a" : ("%." + decimals + "f%%").formatted(v * 100); }

    private static String f3(double v) { return Double.isNaN(v) ? "n/a" : "%.3f".formatted(v); }

    private static String csv(String s) {
        return s.contains(",") || s.contains("\"") ? '"' + s.replace("\"", "\"\"") + '"' : s;
    }
}
