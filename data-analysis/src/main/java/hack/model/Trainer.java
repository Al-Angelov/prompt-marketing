package hack.model;

/** A learning algorithm with fixed hyperparameters. Must not keep state between calls to {@link #fit}. */
public interface Trainer {

    String name();

    /** @param x rows x features, may contain NaN unless the trainer says otherwise; @param y labels, 0 or 1 */
    ScoringModel fit(double[][] x, int[] y);

    static void requireBothClasses(double[][] x, int[] y) {
        if (x.length != y.length) throw new IllegalArgumentException("x has %d rows, y has %d".formatted(x.length, y.length));
        boolean pos = false, neg = false;
        for (int v : y) {
            if (v == 1) pos = true;
            else if (v == 0) neg = true;
            else throw new IllegalArgumentException("labels must be 0 or 1, got " + v);
        }
        if (!pos || !neg) throw new IllegalArgumentException("training data needs both sold and not-sold examples");
    }
}
