package hack.features;

import hack.data.CompanyYear;

import java.util.List;
import java.util.function.Function;

/**
 * Features that express one business concept (e.g. "leverage" = leverage + its squared term).
 * Explanations are reported per group, in the group's own words, not per engineered column.
 */
public record FeatureGroup(String label, Function<CompanyYear, String> describe, List<Feature> features) {
    public FeatureGroup {
        if (features.isEmpty()) throw new IllegalArgumentException("group " + label + " has no features");
        features = List.copyOf(features);
    }
}
