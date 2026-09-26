package hack.model;

/** Small numeric helpers shared by the models. */
public final class Mathx {
    private Mathx() {}

    public static double sigmoid(double s) { return 1.0 / (1.0 + Math.exp(-s)); }

    public static double logit(double p) {
        double q = Math.clamp(p, 1e-12, 1 - 1e-12);
        return Math.log(q / (1 - q));
    }

    public static double mean(int[] y) {
        double s = 0;
        for (int v : y) s += v;
        return y.length == 0 ? Double.NaN : s / y.length;
    }
}
