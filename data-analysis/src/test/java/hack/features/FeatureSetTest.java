package hack.features;

import hack.data.CompanyYear;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class FeatureSetTest {

    private final FeatureSet fs = FeatureSet.standard();

    private static CompanyYear company(double revenueK, double ownerAge) {
        return new CompanyYear("B1", 2024, "Retail", 2000, revenueK, 20, 0.1, 0.5, 0.03, 15, ownerAge, true, 2, 10, 0);
    }

    @Test void extractsAndPropagatesMissingValues() {
        double[] x = fs.extract(company(Double.NaN, 70));
        assertTrue(Double.isNaN(x[fs.indexOf("logRevenue")]));
        assertTrue(Double.isNaN(x[fs.indexOf("logRevenueSq")]));
        assertEquals(24, x[fs.indexOf("firmAge")]);
        assertEquals(1, x[fs.indexOf("ownerOver62")]);
        assertTrue(Double.isNaN(fs.extract(company(1000, Double.NaN))[fs.indexOf("ownerOver62")]));
    }

    @Test void groupsCoverEveryFeatureOnce() {
        double[] ones = new double[fs.size()];
        java.util.Arrays.fill(ones, 1);
        double[] perGroup = fs.byGroup(ones);
        assertEquals(fs.size(), java.util.Arrays.stream(perGroup).sum(), 1e-12);
        assertEquals(fs.groups().size(), perGroup.length);
    }

    @Test void rejectsDuplicateNames() {
        Feature f = new Feature("a", r -> 1);
        assertThrows(IllegalArgumentException.class,
                () -> new FeatureSet(List.of(new FeatureGroup("g", r -> "", List.of(f, f)))));
    }

    @Test void descriptionsHandleMissingValues() {
        for (FeatureGroup g : fs.groups()) assertNotNull(g.describe().apply(company(Double.NaN, Double.NaN)));
    }
}
