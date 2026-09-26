package hack.model;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

/** Every trainer must honour the {@link ScoringModel} contract, whatever the algorithm. */
class ScoringModelContractTest {

    static Stream<Trainer> trainers() {
        return Stream.of(
                new BaseRate(),
                new LogisticRegression(1.0),
                new GradientBoosting(GradientBoosting.Params.defaults()),
                new Imputing(new LogisticRegression(1.0)),
                new ColumnSubset("first column", new int[]{0}, new LogisticRegression(1.0)));
    }

    @ParameterizedTest @MethodSource("trainers")
    void contributionsAddUpToTheLogOdds(Trainer t) {
        var d = ModelTestData.nonLinear(4_000, 5);
        ScoringModel m = t.fit(d.x(), d.y());
        // logit(score) - sum(contributions) must be the same constant for every row
        Double bias = null;
        for (int j = 0; j < 200; j++) {
            double[] x = d.x()[j];
            double[] c = m.contributions(x);
            assertEquals(x.length, c.length);
            double rest = Mathx.logit(m.score(x));
            for (double v : c) rest -= v;
            if (bias == null) bias = rest;
            else assertEquals(bias, rest, 1e-8);
        }
    }

    @ParameterizedTest @MethodSource("trainers")
    void scoresAreProbabilities(Trainer t) {
        var d = ModelTestData.nonLinear(2_000, 6);
        ScoringModel m = t.fit(d.x(), d.y());
        for (double[] x : d.x()) {
            double p = m.score(x);
            assertTrue(p > 0 && p < 1, "score " + p);
        }
    }
}
