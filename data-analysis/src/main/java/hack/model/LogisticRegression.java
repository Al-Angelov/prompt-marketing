package hack.model;

/**
 * L2-regularised logistic regression fitted by Newton's method (IRLS) on standardised features.
 * Converges in a handful of iterations to the exact optimum, so there is no learning rate to tune.
 * Inputs must not contain NaN (wrap in {@link Imputing}).
 */
public final class LogisticRegression implements Trainer {

    private final double l2;
    private final int maxIterations;
    private final double tolerance;

    public LogisticRegression(double l2) { this(l2, 50, 1e-8); }

    public LogisticRegression(double l2, int maxIterations, double tolerance) {
        if (l2 < 0) throw new IllegalArgumentException("l2 must be >= 0");
        this.l2 = l2;
        this.maxIterations = maxIterations;
        this.tolerance = tolerance;
    }

    @Override public String name() { return "Logistic regression"; }

    /** Weights are per 1 SD of each feature, in log-odds. */
    public record Model(double bias, double[] weights, double[] mean, double[] sd, int iterations) implements ScoringModel {
        @Override public double score(double[] x) {
            double s = bias;
            for (int i = 0; i < weights.length; i++) s += weights[i] * (x[i] - mean[i]) / sd[i];
            return Mathx.sigmoid(s);
        }

        /** Contribution relative to the average training company. */
        @Override public double[] contributions(double[] x) {
            double[] c = new double[weights.length];
            for (int i = 0; i < c.length; i++) c[i] = weights[i] * (x[i] - mean[i]) / sd[i];
            return c;
        }
    }

    @Override public Model fit(double[][] x, int[] y) {
        Trainer.requireBothClasses(x, y);
        int n = x.length, k = x[0].length, d = k + 1;

        double[] mean = new double[k], sd = new double[k];
        for (double[] row : x) for (int i = 0; i < k; i++) mean[i] += row[i] / n;
        for (double[] row : x) for (int i = 0; i < k; i++) sd[i] += (row[i] - mean[i]) * (row[i] - mean[i]) / n;
        for (int i = 0; i < k; i++) {
            sd[i] = Math.sqrt(sd[i]);
            if (!(sd[i] > 1e-12)) sd[i] = 1;   // constant column: weight will be pinned at 0 by L2
        }

        // design matrix with a leading 1 for the intercept
        double[][] z = new double[n][d];
        for (int j = 0; j < n; j++) {
            z[j][0] = 1;
            for (int i = 0; i < k; i++) {
                double v = (x[j][i] - mean[i]) / sd[i];
                if (!Double.isFinite(v)) throw new IllegalArgumentException("non-finite input at row %d, column %d".formatted(j, i));
                z[j][i + 1] = v;
            }
        }

        double[] beta = new double[d];
        beta[0] = Mathx.logit(Mathx.mean(y));
        int iter = 0;
        while (iter < maxIterations) {
            iter++;
            double[] g = new double[d];
            double[][] h = new double[d][d];
            for (int j = 0; j < n; j++) {
                double[] zj = z[j];
                double eta = 0;
                for (int a = 0; a < d; a++) eta += beta[a] * zj[a];
                double p = Mathx.sigmoid(eta), w = Math.max(p * (1 - p), 1e-12), r = y[j] - p;
                for (int a = 0; a < d; a++) {
                    double wa = w * zj[a];
                    g[a] += r * zj[a];
                    for (int b = 0; b <= a; b++) h[a][b] += wa * zj[b];
                }
            }
            for (int a = 1; a < d; a++) {   // intercept is not penalised
                g[a] -= l2 * beta[a];
                h[a][a] += l2;
            }
            double[] step = choleskySolve(h, g);
            double maxStep = 0;
            for (int a = 0; a < d; a++) {
                beta[a] += step[a];
                maxStep = Math.max(maxStep, Math.abs(step[a]));
            }
            if (maxStep < tolerance) break;
        }

        double[] w = new double[k];
        System.arraycopy(beta, 1, w, 0, k);
        return new Model(beta[0], w, mean, sd, iter);
    }

    /** Solves A x = b for symmetric positive-definite A, given only its lower triangle. */
    static double[] choleskySolve(double[][] a, double[] b) {
        int d = b.length;
        double[][] l = new double[d][d];
        for (int i = 0; i < d; i++) {
            for (int j = 0; j <= i; j++) {
                double s = a[i][j];
                for (int m = 0; m < j; m++) s -= l[i][m] * l[j][m];
                if (i == j) {
                    // tiny jitter keeps an unpenalised, perfectly separable problem from blowing up
                    l[i][i] = Math.sqrt(Math.max(s, 1e-10));
                } else {
                    l[i][j] = s / l[j][j];
                }
            }
        }
        double[] v = new double[d];
        for (int i = 0; i < d; i++) {
            double s = b[i];
            for (int m = 0; m < i; m++) s -= l[i][m] * v[m];
            v[i] = s / l[i][i];
        }
        double[] out = new double[d];
        for (int i = d - 1; i >= 0; i--) {
            double s = v[i];
            for (int m = i + 1; m < d; m++) s -= l[m][i] * out[m];
            out[i] = s / l[i][i];
        }
        return out;
    }
}
