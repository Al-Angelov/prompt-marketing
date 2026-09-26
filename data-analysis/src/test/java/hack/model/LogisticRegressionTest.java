package hack.model;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class LogisticRegressionTest {

    @Test void recoversKnownCoefficients() {
        double[] truth = {1.0, -0.5, 0.0};
        var d = ModelTestData.logistic(50_000, -1.0, truth, 1);
        var m = new LogisticRegression(0.0).fit(d.x(), d.y());
        // x is ~N(0,1), so per-SD weights are close to the raw weights
        for (int i = 0; i < truth.length; i++) assertEquals(truth[i], m.weights()[i], 0.05, "weight " + i);
        assertTrue(m.iterations() < 15, "Newton should converge fast, took " + m.iterations());
    }

    @Test void solvesTheOptimalityConditions() {
        var d = ModelTestData.logistic(5_000, -2.0, new double[]{0.8, 0.3}, 2);
        double l2 = 2.0;
        var m = new LogisticRegression(l2).fit(d.x(), d.y());
        // at the optimum: sum(y - p) = 0 and sum((y - p) z_i) = l2 * w_i
        double g0 = 0;
        double[] g = new double[2];
        for (int j = 0; j < d.y().length; j++) {
            double r = d.y()[j] - m.score(d.x()[j]);
            g0 += r;
            for (int i = 0; i < 2; i++) g[i] += r * (d.x()[j][i] - m.mean()[i]) / m.sd()[i];
        }
        assertEquals(0, g0, 1e-6);
        for (int i = 0; i < 2; i++) assertEquals(l2 * m.weights()[i], g[i], 1e-6);
    }

    @Test void separableDataStaysFiniteWithL2() {
        double[][] x = {{-2}, {-1}, {1}, {2}};
        int[] y = {0, 0, 1, 1};
        var m = new LogisticRegression(0.1).fit(x, y);
        assertTrue(Double.isFinite(m.weights()[0]));
        assertTrue(m.score(new double[]{2}) > 0.9 && m.score(new double[]{-2}) < 0.1);
    }

    @Test void constantColumnGetsZeroWeight() {
        var d = ModelTestData.logistic(2_000, -1, new double[]{1.0}, 3);
        double[][] x = new double[d.x().length][];
        for (int j = 0; j < x.length; j++) x[j] = new double[]{d.x()[j][0], 5.0};
        var m = new LogisticRegression(1.0).fit(x, d.y());
        assertEquals(0.0, m.weights()[1], 1e-9);
    }

    @Test void rejectsSingleClassAndNaN() {
        assertThrows(IllegalArgumentException.class, () -> new LogisticRegression(1).fit(new double[][]{{1}, {2}}, new int[]{0, 0}));
        assertThrows(IllegalArgumentException.class, () -> new LogisticRegression(1).fit(new double[][]{{1}, {Double.NaN}}, new int[]{0, 1}));
    }

    @Test void choleskySolvesAKnownSystem() {
        double[][] a = {{4, 0, 0}, {2, 5, 0}, {0, 1, 3}};   // lower triangle of [[4,2,0],[2,5,1],[0,1,3]]
        double[] x = LogisticRegression.choleskySolve(a, new double[]{6, 8, 4});
        assertArrayEquals(new double[]{1, 1, 1}, x, 1e-12);
    }
}
