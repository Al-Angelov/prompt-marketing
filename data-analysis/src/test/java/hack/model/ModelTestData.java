package hack.model;

import java.util.Random;

/** Small generated datasets with a known answer. */
final class ModelTestData {
    private ModelTestData() {}

    record Data(double[][] x, int[] y) {}

    /** y ~ Bernoulli(sigmoid(bias + w . x)) with standard normal x. */
    static Data logistic(int n, double bias, double[] w, long seed) {
        Random r = new Random(seed);
        double[][] x = new double[n][w.length];
        int[] y = new int[n];
        for (int j = 0; j < n; j++) {
            double s = bias;
            for (int i = 0; i < w.length; i++) {
                x[j][i] = r.nextGaussian();
                s += w[i] * x[j][i];
            }
            y[j] = r.nextDouble() < Mathx.sigmoid(s) ? 1 : 0;
        }
        return new Data(x, y);
    }

    /** Sales peak at mid values of x0 (inverse-U) and when x1 and x2 are both high (interaction). */
    static Data nonLinear(int n, long seed) {
        Random r = new Random(seed);
        double[][] x = new double[n][3];
        int[] y = new int[n];
        for (int j = 0; j < n; j++) {
            for (int i = 0; i < 3; i++) x[j][i] = r.nextGaussian();
            double s = -1.0 - 2.0 * x[j][0] * x[j][0] + (x[j][1] > 0 && x[j][2] > 0 ? 2.5 : 0);
            y[j] = r.nextDouble() < Mathx.sigmoid(s) ? 1 : 0;
        }
        return new Data(x, y);
    }
}
