package hack.model;

/** Trains the inner model on a subset of columns. Used for simple rule-of-thumb baselines. */
public final class ColumnSubset implements Trainer {

    private final String name;
    private final int[] columns;
    private final Trainer inner;

    public ColumnSubset(String name, int[] columns, Trainer inner) {
        this.name = name;
        this.columns = columns.clone();
        this.inner = inner;
    }

    @Override public String name() { return name; }

    @Override public ScoringModel fit(double[][] x, int[] y) {
        double[][] sub = new double[x.length][];
        for (int j = 0; j < x.length; j++) sub[j] = select(x[j]);
        ScoringModel model = inner.fit(sub, y);
        return new ScoringModel() {
            @Override public double score(double[] row) { return model.score(select(row)); }

            @Override public double[] contributions(double[] row) {
                double[] c = model.contributions(select(row));
                double[] full = new double[row.length];
                for (int i = 0; i < columns.length; i++) full[columns[i]] = c[i];
                return full;
            }
        };
    }

    private double[] select(double[] row) {
        double[] out = new double[columns.length];
        for (int i = 0; i < columns.length; i++) out[i] = row[columns[i]];
        return out;
    }
}
