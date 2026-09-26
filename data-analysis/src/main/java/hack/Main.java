package hack;

import java.util.*;
import java.util.stream.*;

/**
 * Setup test + mini version of the hackathon task. JDK only, no dependencies.
 *
 * 1. Generates synthetic company-years with a hidden "true" sale probability.
 * 2. Trains a logistic regression (batch gradient descent, standardized features).
 * 3. Validates on LATER years than it trained on (time split, no leakage).
 * 4. Reports AUC and top-decile lift, then ranks current companies with reasons.
 */
public class Main {

    static final String[] FEATURES = {
        "firmAge", "maxDirectorTenure", "leverage", "revenueGrowth3y", "sectorDeals24m"
    };

    record CompanyYear(String id, int year, double[] x, int sold) {}

    record Model(double[] w, double b, double[] mean, double[] sd) {
        double[] standardize(double[] x) {
            double[] z = new double[x.length];
            for (int i = 0; i < x.length; i++) z[i] = (x[i] - mean[i]) / sd[i];
            return z;
        }
        double score(double[] x) {
            double[] z = standardize(x);
            double s = b;
            for (int i = 0; i < z.length; i++) s += w[i] * z[i];
            return sigmoid(s);
        }
        /** Per-feature contribution to the log-odds, for explaining a score. */
        double[] contributions(double[] x) {
            double[] z = standardize(x);
            double[] c = new double[z.length];
            for (int i = 0; i < z.length; i++) c[i] = w[i] * z[i];
            return c;
        }
    }

    static double sigmoid(double s) { return 1.0 / (1.0 + Math.exp(-s)); }

    // ---------- synthetic data ----------

    static List<CompanyYear> generate(int companies, int fromYear, int toYear, long seed) {
        Random r = new Random(seed);
        List<CompanyYear> rows = new ArrayList<>();
        for (int c = 0; c < companies; c++) {
            String id = "B%08d".formatted(c);            // fake Spanish CIF-style ID
            double founded = 1960 + r.nextInt(60);
            double tenureStart = founded + r.nextInt(10);
            double leverage = Math.max(0, 0.5 + 0.3 * r.nextGaussian());
            double growth = 0.03 + 0.10 * r.nextGaussian();
            for (int y = fromYear; y <= toYear; y++) {
                double age = y - founded;
                double tenure = Math.max(0, y - tenureStart);
                double sectorDeals = Math.max(0, 4 + 3 * r.nextGaussian());
                growth += 0.03 * r.nextGaussian();
                double[] x = {age, tenure, leverage, growth, sectorDeals};

                // Hidden truth: long-tenured owners, stagnating growth, active sector => more likely to sell.
                // Leverage has an inverse-U effect (the literature's finding), which a linear model can't fully see.
                double logit = -4.2
                        + 0.045 * (tenure - 25)
                        - 4.0 * growth
                        + 0.18 * (sectorDeals - 4)
                        - 1.5 * Math.pow(leverage - 0.6, 2);
                int sold = r.nextDouble() < sigmoid(logit) ? 1 : 0;
                rows.add(new CompanyYear(id, y, x, sold));
                if (sold == 1) break;                       // company leaves the sample once sold
            }
        }
        return rows;
    }

    // ---------- model ----------

    static Model train(List<CompanyYear> data, int epochs, double lr, double l2) {
        int k = FEATURES.length, n = data.size();
        double[] mean = new double[k], sd = new double[k];
        for (var row : data) for (int i = 0; i < k; i++) mean[i] += row.x()[i] / n;
        for (var row : data) for (int i = 0; i < k; i++) sd[i] += Math.pow(row.x()[i] - mean[i], 2) / n;
        for (int i = 0; i < k; i++) sd[i] = Math.max(Math.sqrt(sd[i]), 1e-9);

        double[] w = new double[k];
        double b = 0;
        Model m = new Model(w, b, mean, sd);
        double[][] z = data.stream().map(row -> m.standardize(row.x())).toArray(double[][]::new);

        for (int e = 0; e < epochs; e++) {
            double[] gw = new double[k];
            double gb = 0;
            for (int j = 0; j < n; j++) {
                double s = b;
                for (int i = 0; i < k; i++) s += w[i] * z[j][i];
                double err = sigmoid(s) - data.get(j).sold();
                for (int i = 0; i < k; i++) gw[i] += err * z[j][i] / n;
                gb += err / n;
            }
            for (int i = 0; i < k; i++) w[i] -= lr * (gw[i] + l2 * w[i]);
            b -= lr * gb;
        }
        return new Model(w, b, mean, sd);
    }

    // ---------- evaluation ----------

    /** AUC = probability a random positive is scored above a random negative (rank-based). */
    static double auc(List<CompanyYear> data, Model m) {
        double[] s = data.stream().mapToDouble(r -> m.score(r.x())).toArray();
        Integer[] idx = IntStream.range(0, s.length).boxed().toArray(Integer[]::new);
        Arrays.sort(idx, Comparator.comparingDouble(i -> s[i]));
        double rankSumPos = 0;
        long pos = 0;
        for (int r = 0; r < idx.length; r++) {
            if (data.get(idx[r]).sold() == 1) { rankSumPos += r + 1; pos++; }
        }
        long neg = s.length - pos;
        return (rankSumPos - pos * (pos + 1) / 2.0) / (pos * (double) neg);
    }

    /** Sale rate among the top X% by score, divided by the overall sale rate. */
    static double liftAt(List<CompanyYear> data, Model m, double topFraction) {
        var sorted = data.stream()
                .sorted(Comparator.comparingDouble((CompanyYear r) -> m.score(r.x())).reversed())
                .toList();
        int top = (int) Math.max(1, sorted.size() * topFraction);
        double topRate = sorted.subList(0, top).stream().mapToInt(CompanyYear::sold).average().orElse(0);
        double baseRate = data.stream().mapToInt(CompanyYear::sold).average().orElse(0);
        return topRate / baseRate;
    }

    // ---------- main ----------

    public static void main(String[] args) {
        long t0 = System.nanoTime();
        var all = generate(20_000, 2015, 2025, 42);

        var train = all.stream().filter(r -> r.year() <= 2021).toList();
        var test = all.stream().filter(r -> r.year() >= 2022 && r.year() <= 2024).toList();
        var current = all.stream().filter(r -> r.year() == 2025).toList();

        double base = test.stream().mapToInt(CompanyYear::sold).average().orElse(0);
        System.out.printf("Java %s | rows: train %,d  test %,d  score %,d%n",
                Runtime.version().feature(), train.size(), test.size(), current.size());
        System.out.printf("Base rate (sold within year, test period): %.2f%%%n%n", base * 100);

        Model m = train(train, 400, 0.5, 1e-3);

        System.out.println("Coefficients (per 1 SD, log-odds):");
        for (int i = 0; i < FEATURES.length; i++)
            System.out.printf("  %-18s %+.3f%n", FEATURES[i], m.w()[i]);

        System.out.printf("%nOut-of-time validation (2022-2024):%n");
        System.out.printf("  AUC              %.3f%n", auc(test, m));
        System.out.printf("  Lift top 5%%      %.2fx%n", liftAt(test, m, 0.05));
        System.out.printf("  Lift top 10%%     %.2fx%n", liftAt(test, m, 0.10));

        System.out.println("\nTop 10 companies to approach (2025):");
        System.out.println("  id          score   top reasons");
        current.stream()
                .sorted(Comparator.comparingDouble((CompanyYear r) -> m.score(r.x())).reversed())
                .limit(10)
                .forEach(r -> {
                    double[] c = m.contributions(r.x());
                    String reasons = IntStream.range(0, c.length).boxed()
                            .sorted(Comparator.comparingDouble(i -> -c[i]))
                            .limit(2)
                            .map(i -> "%s=%.2f".formatted(FEATURES[i], r.x()[i]))
                            .collect(Collectors.joining(", "));
                    System.out.printf("  %s  %5.1f%%  %s%n", r.id(), m.score(r.x()) * 100, reasons);
                });

        System.out.printf("%nDone in %d ms%n", (System.nanoTime() - t0) / 1_000_000);
    }
}
