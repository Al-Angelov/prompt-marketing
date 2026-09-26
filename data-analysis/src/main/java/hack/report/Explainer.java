package hack.report;

import hack.data.CompanyYear;
import hack.features.FeatureGroup;
import hack.features.FeatureSet;
import hack.model.ScoringModel;

import java.util.List;
import java.util.stream.IntStream;

/** Turns a model's log-odds contributions into business-level reasons. */
public final class Explainer {

    public record Reason(String driver, String evidence, double logOdds) {
        @Override public String toString() { return "%s (%+.2f)".formatted(evidence, logOdds); }
    }

    private final FeatureSet features;
    private final ScoringModel model;

    public Explainer(FeatureSet features, ScoringModel model) {
        this.features = features;
        this.model = model;
    }

    /** Contribution of each feature group, in log-odds. */
    public double[] byGroup(CompanyYear row) {
        return features.byGroup(model.contributions(features.extract(row)));
    }

    /** The drivers pushing this company's score up the most. Only positive contributions count as reasons. */
    public List<Reason> reasons(CompanyYear row, int limit) {
        double[] g = byGroup(row);
        List<FeatureGroup> groups = features.groups();
        return IntStream.range(0, g.length).boxed()
                .filter(i -> g[i] > 0.01)
                .sorted((a, b) -> Double.compare(g[b], g[a]))
                .limit(limit)
                .map(i -> new Reason(groups.get(i).label(), groups.get(i).describe().apply(row), g[i]))
                .toList();
    }
}
