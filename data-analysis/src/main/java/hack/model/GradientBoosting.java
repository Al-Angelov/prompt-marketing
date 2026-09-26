package hack.model;

import java.util.*;

/**
 * Gradient-boosted decision trees for log-loss (second-order, XGBoost-style split gain), with
 * quantile-binned features and row subsampling. Inputs must not contain NaN (wrap in {@link Imputing}).
 *
 * <p>Explanations use the Saabas path method: each split's change in node value is credited to the
 * split feature, so contributions add up exactly to the model's log-odds.
 */
public final class GradientBoosting implements Trainer {

    public record Params(int rounds, int maxDepth, double learningRate, double lambda,
                         double minChildHessian, int minChildRows, double subsample, int maxBins, long seed) {
        public Params {
            if (rounds < 1 || maxDepth < 1 || learningRate <= 0 || subsample <= 0 || subsample > 1 || maxBins < 2 || maxBins > 256)
                throw new IllegalArgumentException("invalid gradient boosting parameters");
        }

        /** Chosen by a small grid search on a different simulator seed than the one reported by default. */
        public static Params defaults() { return new Params(300, 3, 0.03, 1.0, 1.0, 200, 0.6, 32, 7); }
    }

    private final Params p;

    public GradientBoosting(Params params) { this.p = params; }

    @Override public String name() { return "Gradient boosting"; }

    /** A tree stored as parallel arrays. Leaves have {@code feature == -1}. Values already include the learning rate. */
    record Tree(int[] feature, double[] threshold, int[] splitBin, int[] left, int[] right, double[] value) {
        double predict(double[] x) {
            int n = 0;
            while (feature[n] >= 0) n = x[feature[n]] <= threshold[n] ? left[n] : right[n];
            return value[n];
        }

        double predictBinned(byte[][] bins, int row) {
            int n = 0;
            while (feature[n] >= 0) n = (bins[feature[n]][row] & 0xff) <= splitBin[n] ? left[n] : right[n];
            return value[n];
        }

        /** Adds this tree's per-feature contributions into {@code out}; returns the root value (the tree's bias). */
        double explain(double[] x, double[] out) {
            int n = 0;
            while (feature[n] >= 0) {
                int next = x[feature[n]] <= threshold[n] ? left[n] : right[n];
                out[feature[n]] += value[next] - value[n];
                n = next;
            }
            return value[0];
        }
    }

    public record Model(double baseScore, List<Tree> trees, double[] gainImportance) implements ScoringModel {
        @Override public double score(double[] x) {
            double s = baseScore;
            for (Tree t : trees) s += t.predict(x);
            return Mathx.sigmoid(s);
        }

        @Override public double[] contributions(double[] x) {
            double[] c = new double[x.length];
            for (Tree t : trees) t.explain(x, c);
            return c;
        }
    }

    @Override public Model fit(double[][] x, int[] y) {
        Trainer.requireBothClasses(x, y);
        int n = x.length, k = x[0].length;

        double[][] edges = new double[k][];
        byte[][] bins = new byte[k][n];
        for (int f = 0; f < k; f++) {
            edges[f] = quantileEdges(x, f, p.maxBins());
            for (int j = 0; j < n; j++) {
                if (Double.isNaN(x[j][f])) throw new IllegalArgumentException("NaN in column " + f + "; wrap in Imputing");
                bins[f][j] = (byte) binOf(edges[f], x[j][f]);
            }
        }

        double base = Mathx.logit(Mathx.mean(y));
        double[] margin = new double[n];
        Arrays.fill(margin, base);
        double[] grad = new double[n], hess = new double[n], importance = new double[k];
        Random rnd = new Random(p.seed());
        List<Tree> trees = new ArrayList<>(p.rounds());

        for (int round = 0; round < p.rounds(); round++) {
            for (int j = 0; j < n; j++) {
                double prob = Mathx.sigmoid(margin[j]);
                grad[j] = prob - y[j];
                hess[j] = Math.max(prob * (1 - prob), 1e-6);
            }
            Tree tree = new TreeBuilder(bins, edges, grad, hess, importance).build(subsample(n, rnd));
            trees.add(tree);
            for (int j = 0; j < n; j++) margin[j] += tree.predictBinned(bins, j);
        }
        return new Model(base, List.copyOf(trees), importance);
    }

    private int[] subsample(int n, Random rnd) {
        if (p.subsample() >= 1) {
            int[] all = new int[n];
            for (int j = 0; j < n; j++) all[j] = j;
            return all;
        }
        int[] buf = new int[n];
        int m = 0;
        for (int j = 0; j < n; j++) if (rnd.nextDouble() < p.subsample()) buf[m++] = j;
        return Arrays.copyOf(buf, m);
    }

    /** Distinct upper bin edges at the column's quantiles. Bin i holds values {@code <= edges[i]}; the last bin holds the rest. */
    static double[] quantileEdges(double[][] x, int f, int maxBins) {
        double[] col = new double[x.length];
        for (int j = 0; j < x.length; j++) col[j] = x[j][f];
        Arrays.sort(col);
        double[] edges = new double[maxBins - 1];
        int m = 0;
        for (int q = 1; q < maxBins; q++) {
            double v = col[(int) ((long) q * (col.length - 1) / maxBins)];
            if (m == 0 || v > edges[m - 1]) edges[m++] = v;
        }
        return Arrays.copyOf(edges, m);
    }

    static int binOf(double[] edges, double v) {
        int lo = 0, hi = edges.length;   // first edge >= v
        while (lo < hi) {
            int mid = (lo + hi) >>> 1;
            if (edges[mid] < v) lo = mid + 1; else hi = mid;
        }
        return lo;
    }

    private final class TreeBuilder {
        final byte[][] bins;
        final double[][] edges;
        final double[] grad, hess, importance;
        final List<int[]> nodes = new ArrayList<>();       // {feature, splitBin, left, right}
        final List<double[]> nodeValues = new ArrayList<>(); // {threshold, value}

        TreeBuilder(byte[][] bins, double[][] edges, double[] grad, double[] hess, double[] importance) {
            this.bins = bins;
            this.edges = edges;
            this.grad = grad;
            this.hess = hess;
            this.importance = importance;
        }

        Tree build(int[] rows) {
            grow(rows, 0);
            int m = nodes.size();
            int[] feature = new int[m], splitBin = new int[m], left = new int[m], right = new int[m];
            double[] threshold = new double[m], value = new double[m];
            for (int i = 0; i < m; i++) {
                int[] nd = nodes.get(i);
                feature[i] = nd[0];
                splitBin[i] = nd[1];
                left[i] = nd[2];
                right[i] = nd[3];
                threshold[i] = nodeValues.get(i)[0];
                value[i] = nodeValues.get(i)[1];
            }
            return new Tree(feature, threshold, splitBin, left, right, value);
        }

        private int grow(int[] rows, int depth) {
            double g = 0, h = 0;
            for (int j : rows) { g += grad[j]; h += hess[j]; }
            int id = nodes.size();
            nodes.add(new int[]{-1, -1, -1, -1});
            nodeValues.add(new double[]{Double.NaN, -g / (h + p.lambda()) * p.learningRate()});
            if (depth >= p.maxDepth() || rows.length < 2 * p.minChildRows()) return id;

            double parentScore = g * g / (h + p.lambda());
            double bestGain = 1e-9;
            int bestFeature = -1, bestBin = -1;
            for (int f = 0; f < bins.length; f++) {
                int nb = edges[f].length + 1;
                if (nb < 2) continue;
                double[] hg = new double[nb], hh = new double[nb];
                int[] hc = new int[nb];
                byte[] col = bins[f];
                for (int j : rows) {
                    int b = col[j] & 0xff;
                    hg[b] += grad[j];
                    hh[b] += hess[j];
                    hc[b]++;
                }
                double gl = 0, hl = 0;
                int cl = 0;
                for (int b = 0; b < nb - 1; b++) {
                    gl += hg[b];
                    hl += hh[b];
                    cl += hc[b];
                    double gr = g - gl, hr = h - hl;
                    int cr = rows.length - cl;
                    if (cl < p.minChildRows() || cr < p.minChildRows()) continue;
                    if (hl < p.minChildHessian() || hr < p.minChildHessian()) continue;
                    double gain = gl * gl / (hl + p.lambda()) + gr * gr / (hr + p.lambda()) - parentScore;
                    if (gain > bestGain) {
                        bestGain = gain;
                        bestFeature = f;
                        bestBin = b;
                    }
                }
            }
            if (bestFeature < 0) return id;

            importance[bestFeature] += bestGain;
            byte[] col = bins[bestFeature];
            int nl = 0;
            for (int j : rows) if ((col[j] & 0xff) <= bestBin) nl++;
            int[] lr = new int[nl], rr = new int[rows.length - nl];
            int a = 0, c = 0;
            for (int j : rows) {
                if ((col[j] & 0xff) <= bestBin) lr[a++] = j; else rr[c++] = j;
            }
            int left = grow(lr, depth + 1);
            int right = grow(rr, depth + 1);
            nodes.set(id, new int[]{bestFeature, bestBin, left, right});
            nodeValues.get(id)[0] = edges[bestFeature][bestBin];
            return id;
        }
    }
}
