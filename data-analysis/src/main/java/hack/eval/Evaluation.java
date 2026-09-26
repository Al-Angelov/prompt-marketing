package hack.eval;

/** The headline numbers for one model on one set of out-of-sample predictions. */
public record Evaluation(String model, int rows, int positives,
                         double auc, double aucLow, double aucHigh,
                         double averagePrecision, double brier, double logLoss,
                         double liftTop5, double liftTop10, double recallTop10) {

    public static Evaluation of(String model, double[] s, int[] y, String[] groups, int bootstrapReps, long seed) {
        double[] ci = bootstrapReps > 0
                ? Metrics.bootstrapInterval(s, y, groups, Metrics::auc, bootstrapReps, 0.95, seed)
                : new double[]{Double.NaN, Double.NaN};
        int pos = 0;
        for (int v : y) pos += v;
        return new Evaluation(model, y.length, pos,
                Metrics.auc(s, y), ci[0], ci[1],
                Metrics.averagePrecision(s, y), Metrics.brier(s, y), Metrics.logLoss(s, y),
                Metrics.liftAt(s, y, 0.05), Metrics.liftAt(s, y, 0.10), Metrics.recallAt(s, y, 0.10));
    }
}
