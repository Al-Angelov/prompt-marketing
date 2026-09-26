package hack.data;

/**
 * One company observed at the start of one year.
 *
 * <p>Financials come from the latest filed accounts (end of {@code year - 1}), so everything here
 * is known before the year starts. {@code sold} says whether the company was acquired during
 * {@code year}: 1 = sold, 0 = not sold, {@link #UNKNOWN} = outcome not yet known (the year being
 * scored). Missing numeric values are {@code NaN}.
 */
public record CompanyYear(
        String id,
        int year,
        String sector,
        int foundedYear,
        double revenueK,          // revenue, thousands of EUR
        double employees,
        double ebitdaMargin,      // EBITDA / revenue
        double leverage,          // total debt / total assets
        double revenueGrowth3y,   // 3-year revenue CAGR
        double maxDirectorTenure, // years, longest-serving director
        double ownerAge,          // age of the controlling shareholder
        boolean familyOwned,
        int shareholders,
        double sectorDeals24m,    // M&A deals in the sector over the prior 24 months, per 1,000 firms
        int sold) {

    public static final int UNKNOWN = -1;

    public CompanyYear {
        if (id == null || id.isBlank()) throw new IllegalArgumentException("id is required");
        if (sold != 0 && sold != 1 && sold != UNKNOWN)
            throw new IllegalArgumentException("sold must be 0, 1 or unknown, was " + sold);
    }

    public boolean labeled() { return sold != UNKNOWN; }
}
