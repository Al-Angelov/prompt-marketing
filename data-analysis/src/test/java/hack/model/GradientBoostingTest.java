package hack.model;

import hack.eval.Metrics;
import org.junit.jupiter.api.Test;

import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.*;

class GradientBoostingTest {

    private static final GradientBoosting GBM = new GradientBoosting(GradientBoosting.Params.defaults());

    @Test void learnsNonLinearStructureALinearModelMisses() {
        var train = ModelTestData.nonLinear(20_000, 1);
        var test = ModelTestData.nonLinear(10_000, 2);
        double gbm = auc(GBM.fit(train.x(), train.y()), test);
        double lr = auc(new LogisticRegression(1).fit(train.x(), train.y()), test);
        assertTrue(gbm > 0.8, "boosting AUC " + gbm);
        assertTrue(gbm > lr + 0.1, "boosting %.3f should clearly beat linear %.3f".formatted(gbm, lr));
    }

    @Test void deterministicForAFixedSeed() {
        var d = ModelTestData.nonLinear(3_000, 3);
        var a = GBM.fit(d.x(), d.y());
        var b = GBM.fit(d.x(), d.y());
        for (double[] row : d.x()) assertEquals(a.score(row), b.score(row));
    }

    @Test void binningIsConsistentWithThresholds() {
        double[] edges = {1.0, 2.0, 3.0};
        assertEquals(0, GradientBoosting.binOf(edges, 0.5));
        assertEquals(0, GradientBoosting.binOf(edges, 1.0));
        assertEquals(1, GradientBoosting.binOf(edges, 1.5));
        assertEquals(3, GradientBoosting.binOf(edges, 9.0));
    }

    @Test void quantileEdgesAreStrictlyIncreasing() {
        double[][] x = new double[1000][1];
        for (int j = 0; j < x.length; j++) x[j][0] = j % 3;   // only 3 distinct values
        double[] e = GradientBoosting.quantileEdges(x, 0, 32);
        for (int i = 1; i < e.length; i++) assertTrue(e[i] > e[i - 1]);
        assertTrue(e.length <= 3, Arrays.toString(e));
    }

    private static double auc(ScoringModel m, ModelTestData.Data d) {
        return Metrics.auc(Arrays.stream(d.x()).mapToDouble(m::score).toArray(), d.y());
    }
}
