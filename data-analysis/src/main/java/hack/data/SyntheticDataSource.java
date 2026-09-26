package hack.data;

import java.util.*;

/**
 * Simulates a panel of Spanish SMEs year by year, with a hidden "true" sale probability.
 *
 * <p>What makes it realistic enough to test the pipeline honestly:
 * <ul>
 *   <li>Firms are founded over decades, grow toward a firm-specific size, and have owners who age
 *       and occasionally hand over (succession), which resets director tenure.</li>
 *   <li>Firms leave the panel when sold <em>or</em> dissolved, so the sample is censored.</li>
 *   <li>Sector M&A "heat" is a hidden random walk. The observable {@code sectorDeals24m} is the
 *       <em>actual</em> count of simulated sales in the prior two years, a noisy proxy for it.</li>
 *   <li>Unfiled accounts (~5%), unknown owners and headcount, and young firms without a 3-year
 *       history all produce missing values.</li>
 *   <li>The true hazard has non-linear effects (inverse-U in leverage and size, an owner-age
 *       threshold) and an interaction (family firm x older owner) that a linear model can only
 *       approximate.</li>
 * </ul>
 */
public final class SyntheticDataSource implements DataSource {

    public static final List<String> SECTORS = List.of(
            "Manufacturing", "Wholesale", "Retail", "Construction", "Hospitality",
            "Logistics", "Food & Beverage", "Healthcare", "Software & IT", "Professional Services");

    /** Years simulated before {@code fromYear} so that the 24-month deal counts are populated. */
    private static final int BURN_IN = 2;
    private static final double SALE_INTERCEPT = -4.4;

    private final int companies, fromYear, toYear;
    private final long seed;
    private final Map<String, Double> truth = new HashMap<>();

    public SyntheticDataSource(int companies, int fromYear, int toYear, long seed) {
        if (companies <= 0) throw new IllegalArgumentException("companies must be positive");
        if (toYear < fromYear) throw new IllegalArgumentException("toYear before fromYear");
        this.companies = companies;
        this.fromYear = fromYear;
        this.toYear = toYear;
        this.seed = seed;
    }

    @Override public String describe() {
        return "synthetic (%,d companies, %d-%d, seed %d)".formatted(companies, fromYear, toYear, seed);
    }

    /** The probability the simulator actually used for this row. Only exists for synthetic data. */
    public OptionalDouble trueProbability(CompanyYear row) {
        Double p = truth.get(key(row.id(), row.year()));
        return p == null ? OptionalDouble.empty() : OptionalDouble.of(p);
    }

    @Override public List<CompanyYear> load() {
        truth.clear();
        Random r = new Random(seed);
        int start = fromYear - BURN_IN, years = toYear - start + 1, sectors = SECTORS.size();

        double[] sectorBias = new double[sectors];
        double[][] heat = new double[sectors][years];
        for (int s = 0; s < sectors; s++) {
            sectorBias[s] = 0.2 * r.nextGaussian();
            double h = 0.6 * r.nextGaussian();
            for (int t = 0; t < years; t++) {
                h = 0.7 * h + 0.45 * r.nextGaussian();
                heat[s][t] = h;
            }
        }

        List<Firm> firms = new ArrayList<>(companies);
        for (int c = 0; c < companies; c++) {
            Firm f = new Firm("B%08d".formatted(c), r, toYear);
            for (int y = f.founded + 1; y < start; y++) f.step(y, r);
            firms.add(f);
        }

        int[][] sales = new int[sectors][years], alive = new int[sectors][years];
        List<CompanyYear> rows = new ArrayList<>();
        for (int y = start; y <= toYear; y++) {
            int t = y - start;
            for (Firm f : firms) if (f.eligible(y)) alive[f.sector][t]++;
            for (Firm f : firms) {
                if (!f.eligible(y)) continue;
                double deals = t >= 2
                        ? 1000.0 * (sales[f.sector][t - 1] + sales[f.sector][t - 2]) / Math.max(1, alive[f.sector][t - 1])
                        : Double.NaN;
                double p = sigmoid(f.saleLogit(y) + 0.6 * heat[f.sector][t] + sectorBias[f.sector]);
                boolean sold = r.nextDouble() < p;
                boolean dissolved = !sold && r.nextDouble() < f.dissolutionHazard();
                if (y >= fromYear) {
                    rows.add(f.observe(y, deals, sold ? 1 : 0, r));
                    truth.put(key(f.id, y), p);
                }
                if (sold) {
                    f.active = false;
                    sales[f.sector][t]++;
                } else if (dissolved) {
                    f.active = false;
                } else {
                    f.step(y, r);
                }
            }
        }
        return rows;
    }

    private static String key(String id, int year) { return id + '|' + year; }

    private static double sigmoid(double s) { return 1.0 / (1.0 + Math.exp(-s)); }

    private static double sq(double v) { return v * v; }

    /** Mutable simulation state for one company. State always describes the end of the last simulated year. */
    private static final class Firm {
        final String id;
        final int sector, founded, shareholders;
        final boolean family;
        final double growthMean, marginMean, targetLogSize, revenuePerEmployee;
        final double[] logRevenueByYear;   // index = year - founded
        double logRevenue, margin, leverage;
        int ownerBirth, tenureStart;
        boolean active = true;

        Firm(String id, Random r, int lastYear) {
            this.id = id;
            sector = r.nextInt(SECTORS.size());
            int age = (int) Math.min(75, -22 * Math.log(1 - r.nextDouble()));   // older firms are rarer
            founded = lastYear - 1 - age;
            family = r.nextDouble() < 0.6;
            shareholders = 1 + geometric(r, family ? 0.5 : 0.25, 39);
            growthMean = 0.03 + 0.04 * r.nextGaussian();
            marginMean = 0.07 + 0.06 * r.nextGaussian();
            targetLogSize = Math.log(2500) + r.nextGaussian();
            revenuePerEmployee = 110 * Math.exp(0.35 * r.nextGaussian());
            logRevenue = targetLogSize - 1.5 + 0.5 * r.nextGaussian();
            margin = marginMean;
            leverage = Math.max(0.05, 0.55 + 0.25 * r.nextGaussian());
            ownerBirth = founded - (28 + r.nextInt(25));
            tenureStart = founded;
            logRevenueByYear = new double[lastYear - founded + 1];
            logRevenueByYear[0] = logRevenue;
        }

        boolean eligible(int year) { return active && founded < year; }

        void step(int year, Random r) {
            logRevenue += growthMean + 0.15 * (targetLogSize - logRevenue) + 0.10 * r.nextGaussian();
            logRevenueByYear[year - founded] = logRevenue;
            margin = 0.6 * margin + 0.4 * marginMean + 0.03 * r.nextGaussian();
            leverage = Math.max(0, leverage + 0.05 * r.nextGaussian());
            int ownerAge = year - ownerBirth;   // handover gets likelier with age, certain by 85
            if (ownerAge >= 85 || ownerAge >= 68 && r.nextDouble() < 0.08 + 0.04 * (ownerAge - 68)) {
                ownerBirth = year - (35 + r.nextInt(15));
                tenureStart = year;
            }
        }

        /** 3-year revenue CAGR from the accounts available at the start of {@code year}. */
        double growth3y(int year) {
            int last = year - 1 - founded, first = year - 4 - founded;
            if (first < 0) return Double.NaN;
            return Math.exp((logRevenueByYear[last] - logRevenueByYear[first]) / 3) - 1;
        }

        /** The hidden truth, excluding sector effects. */
        double saleLogit(int year) {
            double ownerAge = year - ownerBirth, tenure = year - tenureStart;
            double growth = growth3y(year);
            if (Double.isNaN(growth)) growth = growthMean;
            double log10Revenue = logRevenue / Math.log(10);
            return SALE_INTERCEPT
                    + 1.3 * Math.clamp((ownerAge - 55) / 15.0, 0.0, 1.3)   // retirement / succession pressure
                    + (family && ownerAge >= 63 ? 0.7 : 0)               // family firm without a successor
                    + 0.015 * (tenure - 20)
                    - 3.0 * growth                                        // stagnation
                    + 3.0 * (margin - 0.07)                               // profitable firms attract buyers
                    - 3.0 * sq(leverage - 0.6)                            // inverse-U
                    - 0.5 * sq(log10Revenue - 3.5);                       // mid-market sweet spot (~EUR 3M)
        }

        double dissolutionHazard() { return margin < 0 ? 0.05 : 0.012; }

        CompanyYear observe(int year, double sectorDeals, int sold, Random r) {
            boolean filed = r.nextDouble() >= 0.05;
            double revenueK = Math.exp(logRevenue);
            double employees = r.nextDouble() < 0.08 ? Double.NaN : Math.max(1, Math.round(revenueK / revenuePerEmployee));
            double ownerAge = r.nextDouble() < 0.03 ? Double.NaN : year - ownerBirth;
            return new CompanyYear(id, year, SECTORS.get(sector), founded,
                    filed ? revenueK : Double.NaN,
                    employees,
                    filed ? margin : Double.NaN,
                    filed ? leverage : Double.NaN,
                    filed ? growth3y(year) : Double.NaN,
                    year - tenureStart,
                    ownerAge,
                    family,
                    shareholders,
                    sectorDeals,
                    sold);
        }

        private static int geometric(Random r, double p, int max) {
            int n = 0;
            while (n < max && r.nextDouble() > p) n++;
            return n;
        }
    }
}
