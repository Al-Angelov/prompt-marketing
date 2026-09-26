package hack.eval;

import java.util.*;
import java.util.function.ToDoubleBiFunction;

/** Ranking and probability metrics. All take parallel arrays of scores and 0/1 labels. */
public final class Metrics {
    private Metrics() {}

    /** ROC AUC: probability a random sold company outscores a random unsold one. Ties count half. */
    public static double auc(double[] s, int[] y) {
        check(s, y);
        int pos = 0;
        for (int v : y) pos += v;
        int neg = y.length - pos;
        if (pos == 0 || neg == 0) return Double.NaN;
        double[] p = new double[pos], q = new double[neg];
        int a = 0, b = 0;
        for (int i = 0; i < s.length; i++) if (y[i] == 1) p[a++] = s[i]; else q[b++] = s[i];
        Arrays.sort(p);
        Arrays.sort(q);
        double wins = 0;
        int lo = 0, hi = 0;   // q[0..lo) < p[i], q[0..hi) <= p[i]
        for (double v : p) {
            while (lo < neg && q[lo] < v) lo++;
            if (hi < lo) hi = lo;
            while (hi < neg && q[hi] <= v) hi++;
            wins += lo + 0.5 * (hi - lo);
        }
        return wins / ((double) pos * neg);
    }

    /** Average precision (area under the precision-recall curve). Its no-skill value is the base rate. */
    public static double averagePrecision(double[] s, int[] y) {
        check(s, y);
        int[] order = argsortDescending(s);
        int pos = 0;
        for (int v : y) pos += v;
        if (pos == 0) return Double.NaN;
        double sum = 0;
        int hits = 0;
        for (int r = 0; r < order.length; r++) {
            if (y[order[r]] == 1) {
                hits++;
                sum += hits / (double) (r + 1);
            }
        }
        return sum / pos;
    }

    public static double brier(double[] s, int[] y) {
        check(s, y);
        double sum = 0;
        for (int i = 0; i < s.length; i++) sum += (s[i] - y[i]) * (s[i] - y[i]);
        return sum / s.length;
    }

    public static double logLoss(double[] s, int[] y) {
        check(s, y);
        double sum = 0;
        for (int i = 0; i < s.length; i++) {
            double p = Math.clamp(s[i], 1e-15, 1 - 1e-15);
            sum -= y[i] == 1 ? Math.log(p) : Math.log(1 - p);
        }
        return sum / s.length;
    }

    /** Sale rate in the top fraction by score, divided by the overall sale rate. */
    public static double liftAt(double[] s, int[] y, double fraction) {
        double base = Arrays.stream(y).average().orElse(Double.NaN);
        return precisionAt(s, y, fraction) / base;
    }

    public static double precisionAt(double[] s, int[] y, double fraction) {
        int top = topCount(s.length, fraction);
        return hitsInTop(s, y, top) / (double) top;
    }

    /** Share of all sales that fall in the top fraction by score. */
    public static double recallAt(double[] s, int[] y, double fraction) {
        int pos = Arrays.stream(y).sum();
        return pos == 0 ? Double.NaN : hitsInTop(s, y, topCount(s.length, fraction)) / (double) pos;
    }

    public record CalibrationBin(double meanPredicted, double observedRate, int count, int positives) {}

    /** Splits rows into equal-count bins by score and compares predicted with observed sale rates. */
    public static List<CalibrationBin> calibration(double[] s, int[] y, int bins) {
        check(s, y);
        int[] desc = argsortDescending(s);
        int n = s.length;
        List<CalibrationBin> out = new ArrayList<>();   // lowest scores first
        for (int b = 0; b < bins; b++) {
            int from = (int) ((long) b * n / bins), to = (int) ((long) (b + 1) * n / bins);
            double sp = 0;
            int pos = 0;
            for (int r = from; r < to; r++) {
                int i = desc[n - 1 - r];
                sp += s[i];
                pos += y[i];
            }
            if (to > from) out.add(new CalibrationBin(sp / (to - from), pos / (double) (to - from), to - from, pos));
        }
        return out;
    }

    /**
     * Percentile bootstrap confidence interval, resampling whole groups (companies) rather than rows,
     * because one company contributes several correlated years to a backtest.
     */
    public static double[] bootstrapInterval(double[] s, int[] y, String[] groups,
                                             ToDoubleBiFunction<double[], int[]> metric,
                                             int reps, double level, long seed) {
        check(s, y);
        Map<String, List<Integer>> byGroup = new LinkedHashMap<>();
        for (int i = 0; i < groups.length; i++) byGroup.computeIfAbsent(groups[i], g -> new ArrayList<>()).add(i);
        int[][] members = byGroup.values().stream().map(l -> l.stream().mapToInt(Integer::intValue).toArray()).toArray(int[][]::new);

        Random r = new Random(seed);
        double[] stats = new double[reps];
        int kept = 0;
        for (int rep = 0; rep < reps; rep++) {
            int size = 0;
            int[][] draw = new int[members.length][];
            for (int g = 0; g < members.length; g++) {
                draw[g] = members[r.nextInt(members.length)];
                size += draw[g].length;
            }
            double[] bs = new double[size];
            int[] by = new int[size];
            int m = 0;
            for (int[] grp : draw) for (int i : grp) { bs[m] = s[i]; by[m] = y[i]; m++; }
            double v = metric.applyAsDouble(bs, by);
            if (!Double.isNaN(v)) stats[kept++] = v;
        }
        if (kept == 0) return new double[]{Double.NaN, Double.NaN};
        Arrays.sort(stats, 0, kept);
        double tail = (1 - level) / 2;
        return new double[]{stats[(int) Math.floor(tail * (kept - 1))], stats[(int) Math.ceil((1 - tail) * (kept - 1))]};
    }

    static int[] argsortDescending(double[] s) {
        return java.util.stream.IntStream.range(0, s.length).boxed()
                .sorted((a, b) -> Double.compare(s[b], s[a]))
                .mapToInt(Integer::intValue).toArray();
    }

    private static int topCount(int n, double fraction) {
        if (fraction <= 0 || fraction > 1) throw new IllegalArgumentException("fraction must be in (0, 1]");
        return Math.max(1, (int) Math.round(n * fraction));
    }

    private static int hitsInTop(double[] s, int[] y, int top) {
        int[] order = argsortDescending(s);
        int hits = 0;
        for (int r = 0; r < top; r++) hits += y[order[r]];
        return hits;
    }

    private static void check(double[] s, int[] y) {
        if (s.length != y.length) throw new IllegalArgumentException("scores and labels differ in length");
        if (s.length == 0) throw new IllegalArgumentException("no rows");
    }
}
