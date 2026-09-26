package hack.data;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class CsvCodecTest {
    @Test void quotedTextAndNullableFieldsRoundTrip() throws IOException {
        var row=new CompanyYear("A,\"B\"",2027,"Health,\ncare",null,1000,20,Double.NaN,Double.NaN,Double.NaN,Double.NaN,Double.NaN,null,null,Double.NaN,CompanyYear.UNKNOWN);
        Path file=dir.resolve("quoted.csv");CsvCodec.write(List.of(row),file);
        assertEquals(List.of(row),CsvCodec.read(file));
    }

    @TempDir Path dir;

    @Test void roundTripsSyntheticDataExactly() throws IOException {
        List<CompanyYear> rows = new SyntheticDataSource(300, 2018, 2021, 5).load();
        Path file = dir.resolve("data.csv");
        CsvCodec.write(rows, file);
        assertEquals(rows, CsvCodec.read(file));   // records compare NaN fields as equal
    }

    @Test void readsMissingValuesUnknownLabelsAndAnyColumnOrder() throws IOException {
        Path file = dir.resolve("real.csv");
        Files.writeString(file, """
                sold,id,year,sector,foundedYear,revenueK,employees,ebitdaMargin,leverage,revenueGrowth3y,maxDirectorTenure,ownerAge,familyOwned,shareholders,sectorDeals24m,extra
                ,B123,2025,Retail,1990,1500,,0.1,0.4,,22,61,yes,3,12.5,ignored
                1,B124,2024,Retail,2001,800,9,,0.7,0.02,10,,0,1,,x
                """);
        List<CompanyYear> rows = CsvCodec.read(file);
        assertEquals(2, rows.size());
        CompanyYear a = rows.get(0), b = rows.get(1);
        assertFalse(a.labeled());
        assertTrue(Double.isNaN(a.employees()));
        assertTrue(a.familyOwned());
        assertEquals(1, b.sold());
        assertTrue(Double.isNaN(b.ownerAge()));
        assertTrue(Double.isNaN(b.sectorDeals24m()));
    }

    @Test void reportsMissingColumnsAndBadLines() throws IOException {
        Path noCols = dir.resolve("a.csv");
        Files.writeString(noCols, "id,year\nB1,2020\n");
        var e = assertThrows(IOException.class, () -> CsvCodec.read(noCols));
        assertTrue(e.getMessage().contains("sector"), e.getMessage());

        Path badLabel = dir.resolve("b.csv");
        Files.writeString(badLabel, String.join(",", CsvCodec.COLUMNS) + "\nB1,2020,Retail,1990,1,1,0,0,0,1,50,0,1,1,7\n");
        e = assertThrows(IOException.class, () -> CsvCodec.read(badLabel));
        assertTrue(e.getMessage().contains("line 2"), e.getMessage());
    }
}
