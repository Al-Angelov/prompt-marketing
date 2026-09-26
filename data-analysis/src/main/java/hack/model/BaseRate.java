package hack.model;

/** Scores every company at the historical sale rate. The floor any real model has to beat. */
public final class BaseRate implements Trainer {

    @Override public String name() { return "Base rate"; }

    @Override public ScoringModel fit(double[][] x, int[] y) {
        double p = Mathx.mean(y);
        return new ScoringModel() {
            @Override public double score(double[] row) { return p; }

            @Override public double[] contributions(double[] row) { return new double[row.length]; }
        };
    }
}
