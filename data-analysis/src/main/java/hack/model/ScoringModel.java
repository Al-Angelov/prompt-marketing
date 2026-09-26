package hack.model;

/** A fitted model. */
public interface ScoringModel {

    /** Probability that the company is sold within the year. */
    double score(double[] x);

    /**
     * Additive explanation in log-odds: {@code logit(score(x)) = bias + sum(contributions(x))},
     * where the bias does not depend on {@code x}. Positive values push the score up.
     */
    double[] contributions(double[] x);
}
