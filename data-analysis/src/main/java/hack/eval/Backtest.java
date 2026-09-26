package hack.eval;

import hack.data.CompanyYear;
import hack.features.FeatureSet;
import hack.model.ScoringModel;
import hack.model.Trainer;

import java.util.*;
import java.util.stream.IntStream;

/**
 * Walk-forward backtest: for each test year Y, train on every labelled year before Y and score Y.
 * This is exactly how the model would have been used in production, so there is no look-ahead.
 */
public final class Backtest {

    private Backtest() {}

    /** Rows used to train and test one fold. */
    public record FoldPlan(int testYear, List<CompanyYear> train, List<CompanyYear> test) {}

    /** Out-of-sample scores for one fold, one array per model, aligned with {@code test}. */
    public record Fold(int testYear, List<CompanyYear> test, Map<String, double[]> scores) {
        public int[] labels() { return test.stream().mapToInt(CompanyYear::sold).toArray(); }
    }

    public record Result(List<String> models, List<Fold> folds) {
        /** All folds' test rows concatenated. */
        public List<CompanyYear> pooledRows() {
            return folds.stream().flatMap(f -> f.test().stream()).toList();
        }

        public int[] pooledLabels() { return pooledRows().stream().mapToInt(CompanyYear::sold).toArray(); }

        public double[] pooledScores(String model) {
            return folds.stream().flatMapToDouble(f -> Arrays.stream(f.scores().get(model))).toArray();
        }
    }

    public static List<FoldPlan> plan(List<CompanyYear> rows, int firstTestYear, int lastTestYear) {
        List<FoldPlan> plans = new ArrayList<>();
        for (int year = firstTestYear; year <= lastTestYear; year++) {
            int y = year;
            List<CompanyYear> train = rows.stream().filter(r -> r.labeled() && r.year() < y).toList();
            List<CompanyYear> test = rows.stream().filter(r -> r.labeled() && r.year() == y).toList();
            if (train.isEmpty() || test.isEmpty())
                throw new IllegalArgumentException("fold %d has no training or test rows".formatted(y));
            plans.add(new FoldPlan(y, train, test));
        }
        return plans;
    }

    public static Result run(List<CompanyYear> rows, FeatureSet features, List<Trainer> trainers,
                             int firstTestYear, int lastTestYear) {
        List<FoldPlan> plans = plan(rows, firstTestYear, lastTestYear);
        for (FoldPlan p : plans)
            for (CompanyYear r : p.train())
                if (r.year() >= p.testYear()) throw new IllegalStateException("look-ahead in fold " + p.testYear());

        record Task(int fold, int model) {}
        List<Task> tasks = new ArrayList<>();
        for (int f = 0; f < plans.size(); f++) for (int m = 0; m < trainers.size(); m++) tasks.add(new Task(f, m));

        List<double[][]> trainX = plans.stream().map(p -> features.matrix(p.train())).toList();
        List<int[]> trainY = plans.stream().map(p -> p.train().stream().mapToInt(CompanyYear::sold).toArray()).toList();
        List<double[][]> testX = plans.stream().map(p -> features.matrix(p.test())).toList();

        double[][][] out = new double[plans.size()][trainers.size()][];
        tasks.parallelStream().forEach(t -> {
            ScoringModel model = trainers.get(t.model()).fit(trainX.get(t.fold()), trainY.get(t.fold()));
            double[][] x = testX.get(t.fold());
            out[t.fold()][t.model()] = IntStream.range(0, x.length).mapToDouble(j -> model.score(x[j])).toArray();
        });

        List<String> names = trainers.stream().map(Trainer::name).toList();
        List<Fold> folds = new ArrayList<>();
        for (int f = 0; f < plans.size(); f++) {
            Map<String, double[]> scores = new LinkedHashMap<>();
            for (int m = 0; m < trainers.size(); m++) scores.put(names.get(m), out[f][m]);
            folds.add(new Fold(plans.get(f).testYear(), plans.get(f).test(), scores));
        }
        return new Result(names, folds);
    }
}
