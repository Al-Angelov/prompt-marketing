package hack.features;

import hack.data.CompanyYear;

import java.util.*;

/** Turns company-years into a numeric matrix, and maps per-feature numbers back to business concepts. */
public final class FeatureSet {

    private final List<FeatureGroup> groups;
    private final List<Feature> features;
    private final int[] groupOf;

    public FeatureSet(List<FeatureGroup> groups) {
        this.groups = List.copyOf(groups);
        List<Feature> all = new ArrayList<>();
        List<Integer> owner = new ArrayList<>();
        for (int g = 0; g < groups.size(); g++)
            for (Feature f : groups.get(g).features()) { all.add(f); owner.add(g); }
        Set<String> seen = new HashSet<>();
        for (Feature f : all)
            if (!seen.add(f.name())) throw new IllegalArgumentException("duplicate feature " + f.name());
        this.features = List.copyOf(all);
        this.groupOf = owner.stream().mapToInt(Integer::intValue).toArray();
    }

    /** The default feature set for the M&A propensity model. */
    public static FeatureSet standard() {
        return new FeatureSet(List.of(
                group("firm age", r -> r.foundedYear() == null ? "founding year unavailable" : "%d yrs old".formatted(r.year() - r.foundedYear()),
                        new Feature("firmAge", r -> r.foundedYear() == null ? Double.NaN : r.year() - r.foundedYear())),
                group("size", r -> "revenue " + money(r.revenueK()),
                        new Feature("logRevenue", r -> logPositive(r.revenueK())),
                        // centred at ~EUR 3M so a linear model can express a mid-market sweet spot
                        new Feature("logRevenueSq", r -> sq(logPositive(r.revenueK()) - 8.0)),
                        new Feature("logEmployees", r -> Math.log1p(r.employees()))),
                group("profitability", r -> "EBITDA margin " + pct(r.ebitdaMargin()),
                        new Feature("ebitdaMargin", CompanyYear::ebitdaMargin)),
                group("leverage", r -> "debt/assets " + fmt("%.2f", r.leverage()),
                        new Feature("leverage", CompanyYear::leverage),
                        new Feature("leverageSq", r -> sq(r.leverage() - 0.5))),
                group("growth", r -> "3y revenue CAGR " + pct(r.revenueGrowth3y()),
                        new Feature("revenueGrowth3y", CompanyYear::revenueGrowth3y)),
                group("director tenure", r -> "longest director tenure " + fmt("%.0f yrs", r.maxDirectorTenure()),
                        new Feature("maxDirectorTenure", CompanyYear::maxDirectorTenure)),
                group("owner age", r -> "owner aged " + fmt("%.0f", r.ownerAge()),
                        new Feature("ownerAge", CompanyYear::ownerAge),
                        new Feature("ownerOver62", r -> Double.isNaN(r.ownerAge()) ? Double.NaN : r.ownerAge() >= 62 ? 1 : 0)),
                group("family ownership", r -> r.familyOwned() == null ? "family ownership unavailable" : r.familyOwned() ? "family-owned" : "not family-owned",
                        new Feature("familyOwned", r -> r.familyOwned() == null ? Double.NaN : r.familyOwned() ? 1 : 0)),
                group("shareholders", r -> r.shareholders() == null ? "shareholders unavailable" : r.shareholders() + " shareholders",
                        new Feature("logShareholders", r -> r.shareholders() == null ? Double.NaN : Math.log(Math.max(1, r.shareholders())))),
                group("sector M&A activity", r -> "sector deals " + fmt("%.1f", r.sectorDeals24m()) + "/1k firms (24m)",
                        new Feature("sectorDeals24m", CompanyYear::sectorDeals24m))));
    }

    public int size() { return features.size(); }

    public List<Feature> features() { return features; }

    public List<FeatureGroup> groups() { return groups; }

    public List<String> names() { return features.stream().map(Feature::name).toList(); }

    public int indexOf(String name) {
        for (int i = 0; i < features.size(); i++) if (features.get(i).name().equals(name)) return i;
        throw new IllegalArgumentException("no feature " + name);
    }

    public double[] extract(CompanyYear row) {
        double[] x = new double[features.size()];
        for (int i = 0; i < x.length; i++) x[i] = features.get(i).valueOf(row);
        return x;
    }

    public double[][] matrix(List<CompanyYear> rows) {
        return rows.stream().map(this::extract).toArray(double[][]::new);
    }

    /** Sums per-feature values (e.g. log-odds contributions) into one value per group. */
    public double[] byGroup(double[] perFeature) {
        if (perFeature.length != features.size()) throw new IllegalArgumentException("wrong width");
        double[] out = new double[groups.size()];
        for (int i = 0; i < perFeature.length; i++) out[groupOf[i]] += perFeature[i];
        return out;
    }

    private static FeatureGroup group(String label, java.util.function.Function<CompanyYear, String> describe, Feature... fs) {
        return new FeatureGroup(label, describe, List.of(fs));
    }

    private static double sq(double v) { return v * v; }

    private static double logPositive(double v) { return v > 0 ? Math.log(v) : Double.NaN; }

    private static String fmt(String pattern, double v) { return Double.isNaN(v) ? "n/a" : pattern.formatted(v); }

    private static String pct(double v) { return fmt("%.1f%%", v * 100); }

    private static String money(double thousands) {
        if (Double.isNaN(thousands)) return "n/a";
        return thousands >= 1000 ? "EUR %.1fM".formatted(thousands / 1000) : "EUR %.0fk".formatted(thousands);
    }
}
