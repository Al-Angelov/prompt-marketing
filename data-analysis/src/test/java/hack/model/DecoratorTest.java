package hack.model;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class DecoratorTest {

    /** Records what the inner trainer and model are given. */
    static final class Spy implements Trainer {
        double[][] trainedOn;
        final List<double[]> scored = new ArrayList<>();

        @Override public String name() { return "spy"; }

        @Override public ScoringModel fit(double[][] x, int[] y) {
            trainedOn = x;
            return new ScoringModel() {
                @Override public double score(double[] row) { scored.add(row); return 0.5; }

                @Override public double[] contributions(double[] row) { return row.clone(); }
            };
        }
    }

    @Test void imputesWithTrainingMedianOnly() {
        Spy spy = new Spy();
        double nan = Double.NaN;
        ScoringModel m = new Imputing(spy).fit(new double[][]{{1, nan}, {2, 10}, {9, 20}, {nan, 30}}, new int[]{0, 1, 0, 1});
        assertEquals(2, spy.trainedOn[3][0]);    // median of 1, 2, 9
        assertEquals(20, spy.trainedOn[0][1]);   // median of 10, 20, 30
        m.score(new double[]{nan, nan});
        assertArrayEquals(new double[]{2, 20}, spy.scored.getFirst(), "scoring must reuse the training medians");
    }

    @Test void imputingDoesNotMutateTheCallersArrays() {
        double[][] x = {{Double.NaN}, {1}};
        new Imputing(new Spy()).fit(x, new int[]{0, 1});
        assertTrue(Double.isNaN(x[0][0]));
    }

    @Test void medianOfEvenCountAveragesTheMiddle() {
        assertArrayEquals(new double[]{2.5}, Imputing.medians(new double[][]{{4}, {1}, {3}, {2}}));
    }

    @Test void columnSubsetSelectsAndMapsContributionsBack() {
        Spy spy = new Spy();
        ScoringModel m = new ColumnSubset("s", new int[]{2, 0}, spy).fit(new double[][]{{1, 2, 3}}, new int[]{1});
        assertArrayEquals(new double[]{3, 1}, spy.trainedOn[0]);
        assertArrayEquals(new double[]{7, 0, 9}, m.contributions(new double[]{7, 8, 9}));
    }
}
