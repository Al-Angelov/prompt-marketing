package hack.data;

import org.junit.jupiter.api.Test;

import java.util.*;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;

class SyntheticDataSourceTest {

    private final SyntheticDataSource source = new SyntheticDataSource(5_000, 2015, 2025, 11);
    private final List<CompanyYear> rows = source.load();

    @Test void sameSeedSameData() {
        assertEquals(rows, new SyntheticDataSource(5_000, 2015, 2025, 11).load());
        assertNotEquals(rows, new SyntheticDataSource(5_000, 2015, 2025, 12).load());
    }

    @Test void saleRateIsRealisticForSmes() {
        double rate = rows.stream().mapToInt(CompanyYear::sold).average().orElseThrow();
        assertTrue(rate > 0.005 && rate < 0.05, "annual sale rate " + rate);
    }

    @Test void companiesLeaveThePanelOnceSold() {
        Map<String, List<CompanyYear>> byId = rows.stream().collect(Collectors.groupingBy(CompanyYear::id));
        for (var history : byId.values()) {
            history.sort(Comparator.comparingInt(CompanyYear::year));
            for (int i = 0; i < history.size() - 1; i++) {
                assertEquals(0, history.get(i).sold(), "row after a sale for " + history.get(i).id());
                assertEquals(history.get(i).year() + 1, history.get(i + 1).year(), "gap in panel");
            }
        }
    }

    @Test void valuesArePlausible() {
        for (CompanyYear r : rows) {
            assertTrue(r.foundedYear() < r.year());
            if (!Double.isNaN(r.ownerAge())) assertTrue(r.ownerAge() >= 18 && r.ownerAge() <= 85, "owner age " + r.ownerAge());
            if (!Double.isNaN(r.leverage())) assertTrue(r.leverage() >= 0);
            if (!Double.isNaN(r.revenueK())) assertTrue(r.revenueK() > 0);
            assertTrue(r.maxDirectorTenure() >= 0 && r.maxDirectorTenure() <= r.year() - r.foundedYear());
            assertTrue(r.sectorDeals24m() >= 0);
        }
    }

    @Test void truthIsAvailableForEveryRowAndDrivesSales() {
        double soldMean = 0, keptMean = 0;
        int sold = 0, kept = 0;
        for (CompanyYear r : rows) {
            double p = source.trueProbability(r).orElseThrow();
            if (r.sold() == 1) { soldMean += p; sold++; } else { keptMean += p; kept++; }
        }
        assertTrue(soldMean / sold > 1.5 * keptMean / kept, "sold companies should have had higher true probabilities");
    }
}
