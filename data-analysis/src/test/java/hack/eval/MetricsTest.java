package hack.eval;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Random;

import static org.junit.jupiter.api.Assertions.*;

class MetricsTest {

    @Test void aucIsOneForPerfectRankingAndZeroForReversed() {
        double[] s = {0.1, 0.2, 0.8, 0.9};
        assertEquals(1.0, Metrics.auc(s, new int[]{0, 0, 1, 1}), 1e-12);
        assertEquals(0.0, Metrics.auc(s, new int[]{1, 1, 0, 0}), 1e-12);
    }

    @Test void aucCountsTiesAsHalf() {
        assertEquals(0.5, Metrics.auc(new double[]{0.3, 0.3, 0.3, 0.3}, new int[]{0, 1, 0, 1}), 1e-12);
        // positives 0.5 and 0.7; negatives 0.5 and 0.2 -> pairs: (0.5 vs 0.5)=0.5, (0.5 vs 0.2)=1, (0.7 vs *)=2 -> 3.5/4
        assertEquals(0.875, Metrics.auc(new double[]{0.5, 0.7, 0.5, 0.2}, new int[]{1, 1, 0, 0}), 1e-12);
    }

    @Test void aucMatchesBruteForce() {
        Random r = new Random(1);
        int n = 500;
        double[] s = new double[n];
        int[] y = new int[n];
        for (int i = 0; i < n; i++) {
            y[i] = r.nextDouble() < 0.2 ? 1 : 0;
            s[i] = Math.round((r.nextDouble() + 0.3 * y[i]) * 20) / 20.0;   // coarse -> many ties
        }
        double wins = 0, pairs = 0;
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++)
                if (y[i] == 1 && y[j] == 0) {
                    pairs++;
                    wins += s[i] > s[j] ? 1 : s[i] == s[j] ? 0.5 : 0;
                }
        assertEquals(wins / pairs, Metrics.auc(s, y), 1e-12);
    }

    @Test void aucIsUndefinedWithOneClass() {
        assertTrue(Double.isNaN(Metrics.auc(new double[]{0.1, 0.2}, new int[]{0, 0})));
    }

    @Test void averagePrecisionOnKnownRanking() {
        // ranked: 1 (hit), 0.8 (miss), 0.6 (hit) -> (1/1 + 2/3) / 2
        double ap = Metrics.averagePrecision(new double[]{1.0, 0.8, 0.6, 0.1}, new int[]{1, 0, 1, 0});
        assertEquals((1 + 2.0 / 3) / 2, ap, 1e-12);
    }

    @Test void brierAndLogLoss() {
        double[] s = {0.9, 0.2};
        int[] y = {1, 0};
        assertEquals((0.01 + 0.04) / 2, Metrics.brier(s, y), 1e-12);
        assertEquals(-(Math.log(0.9) + Math.log(0.8)) / 2, Metrics.logLoss(s, y), 1e-12);
        assertTrue(Double.isFinite(Metrics.logLoss(new double[]{0.0}, new int[]{1})), "log loss must clip 0");
    }

    @Test void liftAndRecallAtTopFraction() {
        double[] s = {0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.0};
        int[] y = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0};
        assertEquals(0.5, Metrics.precisionAt(s, y, 0.2), 1e-12);
        assertEquals(2.5, Metrics.liftAt(s, y, 0.2), 1e-12);   // 50% vs 20% base
        assertEquals(0.5, Metrics.recallAt(s, y, 0.2), 1e-12);
        assertEquals(1.0, Metrics.recallAt(s, y, 1.0), 1e-12);
    }

    @Test void calibrationBinsAreOrderedAndCoverAllRows() {
        Random r = new Random(2);
        int n = 1000;
        double[] s = new double[n];
        int[] y = new int[n];
        for (int i = 0; i < n; i++) {
            s[i] = r.nextDouble();
            y[i] = r.nextDouble() < s[i] ? 1 : 0;
        }
        List<Metrics.CalibrationBin> bins = Metrics.calibration(s, y, 10);
        assertEquals(10, bins.size());
        assertEquals(n, bins.stream().mapToInt(Metrics.CalibrationBin::count).sum());
        for (int b = 1; b < bins.size(); b++) assertTrue(bins.get(b).meanPredicted() > bins.get(b - 1).meanPredicted());
        for (var b : bins) assertEquals(b.meanPredicted(), b.observedRate(), 0.15, "a calibrated score should match its bin");
    }

    @Test void bootstrapIntervalBracketsThePointEstimate() {
        Random r = new Random(3);
        int n = 2000;
        double[] s = new double[n];
        int[] y = new int[n];
        String[] g = new String[n];
        for (int i = 0; i < n; i++) {
            y[i] = r.nextDouble() < 0.1 ? 1 : 0;
            s[i] = r.nextGaussian() + y[i];
            g[i] = "c" + (i / 4);   // 4 rows per company
        }
        double auc = Metrics.auc(s, y);
        double[] ci = Metrics.bootstrapInterval(s, y, g, Metrics::auc, 200, 0.95, 9);
        assertTrue(ci[0] < auc && auc < ci[1], "CI %s should contain %f".formatted(java.util.Arrays.toString(ci), auc));
        assertTrue(ci[1] - ci[0] < 0.15);
    }
}
