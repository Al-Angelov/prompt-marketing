package hack.model;

import java.util.Arrays;

/**
 * Replaces missing values with the training median, then delegates. The medians are learned from
 * the training rows only and frozen into the returned model, so scoring never looks at test data.
 */
public final class Imputing implements Trainer {

    private final Trainer inner;

    public Imputing(Trainer inner) { this.inner = inner; }

    @Override public String name() { return inner.name(); }

    @Override public ScoringModel fit(double[][] x, int[] y) {
        double[] medians = medians(x);
        ScoringModel model = inner.fit(Arrays.stream(x).map(r -> impute(r, medians)).toArray(double[][]::new), y);
        return new ScoringModel() {
            @Override public double score(double[] row) { return model.score(impute(row, medians)); }

            @Override public double[] contributions(double[] row) { return model.contributions(impute(row, medians)); }
        };
    }

    static double[] medians(double[][] x) {
        int k = x.length == 0 ? 0 : x[0].length;
        double[] med = new double[k];
        double[] col = new double[x.length];
        for (int i = 0; i < k; i++) {
            int n = 0;
            for (double[] row : x) if (!Double.isNaN(row[i])) col[n++] = row[i];
            if (n == 0) continue;   // column entirely missing: impute 0, it carries no information anyway
            Arrays.sort(col, 0, n);
            med[i] = n % 2 == 1 ? col[n / 2] : (col[n / 2 - 1] + col[n / 2]) / 2;
        }
        return med;
    }

    static double[] impute(double[] row, double[] medians) {
        double[] out = row.clone();
        for (int i = 0; i < out.length; i++) if (Double.isNaN(out[i])) out[i] = medians[i];
        return out;
    }
}
