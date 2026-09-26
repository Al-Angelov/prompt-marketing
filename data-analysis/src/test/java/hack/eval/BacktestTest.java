package hack.eval;

import hack.data.CompanyYear;
import hack.data.SyntheticDataSource;
import hack.features.FeatureSet;
import hack.model.*;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class BacktestTest {

    private static final List<CompanyYear> ROWS = new SyntheticDataSource(8_000, 2015, 2024, 3).load();

    @Test void trainingDataAlwaysPrecedesTheTestYear() {
        for (var fold : Backtest.plan(ROWS, 2019, 2024)) {
            assertTrue(fold.train().stream().allMatch(r -> r.year() < fold.testYear()));
            assertTrue(fold.test().stream().allMatch(r -> r.year() == fold.testYear()));
            assertEquals(ROWS.stream().filter(r -> r.year() < fold.testYear()).count(), fold.train().size(),
                    "every earlier year should be used for training");
        }
    }

    @Test void unlabeledRowsAreNeverTrainedOrTestedOn() {
        List<CompanyYear> withUnknown = ROWS.stream()
                .map(r -> r.year() == 2020 ? withLabel(r, CompanyYear.UNKNOWN) : r).toList();
        for (var fold : Backtest.plan(withUnknown, 2021, 2022))
            assertTrue(fold.train().stream().allMatch(CompanyYear::labeled));
    }

    @Test void endToEndModelsBeatTheBaselines() {
        FeatureSet fs = FeatureSet.standard();
        var result = Backtest.run(ROWS, fs, List.of(
                new BaseRate(),
                new Imputing(new LogisticRegression(1.0)),
                new Imputing(new GradientBoosting(GradientBoosting.Params.defaults()))), 2021, 2024);

        assertEquals(4, result.folds().size());
        int[] y = result.pooledLabels();
        double base = Metrics.auc(result.pooledScores("Base rate"), y);
        double lr = Metrics.auc(result.pooledScores("Logistic regression"), y);
        double gbm = Metrics.auc(result.pooledScores("Gradient boosting"), y);
        assertEquals(0.5, base, 0.05);
        assertTrue(lr > 0.68, "logistic AUC " + lr);
        assertTrue(gbm > 0.68, "boosting AUC " + gbm);
        assertTrue(Metrics.liftAt(result.pooledScores("Logistic regression"), y, 0.1) > 2.5);
    }

    @Test void rejectsFoldsWithoutTrainingData() {
        assertThrows(IllegalArgumentException.class, () -> Backtest.plan(ROWS, 2015, 2016));
    }

    private static CompanyYear withLabel(CompanyYear r, int sold) {
        return new CompanyYear(r.id(), r.year(), r.sector(), r.foundedYear(), r.revenueK(), r.employees(), r.ebitdaMargin(),
                r.leverage(), r.revenueGrowth3y(), r.maxDirectorTenure(), r.ownerAge(), r.familyOwned(), r.shareholders(),
                r.sectorDeals24m(), sold);
    }
}
