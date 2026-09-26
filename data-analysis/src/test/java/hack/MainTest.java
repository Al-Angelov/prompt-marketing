package hack;

import hack.data.CsvCodec;
import hack.data.SyntheticDataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** Runs the whole pipeline the way a user would, on a small dataset. */
class MainTest {

    @TempDir Path dir;

    @Test void syntheticRunProducesReportAndFiles() throws Exception {
        String report = run("--companies", "4000", "--folds", "3", "--bootstrap", "20", "--top", "5", "--out", dir.toString());
        assertTrue(report.contains("Walk-forward backtest"));
        assertTrue(report.contains("Oracle (true probability)"));
        assertTrue(report.contains("Top 5 companies to approach in 2025"));
        assertTrue(report.contains("Hindsight"));

        List<String> scores = Files.readAllLines(dir.resolve("scores-2025.csv"));
        assertEquals("rank,id,sector,score,reason1,reason2,reason3", scores.getFirst());
        assertTrue(scores.size() > 1000);
        assertTrue(Files.readAllLines(dir.resolve("backtest.csv")).size() == 1 + 3 * 4);
    }

    @Test void csvRunWithUnknownOutcomesInTheScoringYear() throws Exception {
        var rows = new SyntheticDataSource(4000, 2015, 2025, 9).load().stream()
                .map(r -> r.year() < 2025 ? r : new hack.data.CompanyYear(r.id(), r.year(), r.sector(), r.foundedYear(),
                        r.revenueK(), r.employees(), r.ebitdaMargin(), r.leverage(), r.revenueGrowth3y(), r.maxDirectorTenure(),
                        r.ownerAge(), r.familyOwned(), r.shareholders(), r.sectorDeals24m(), hack.data.CompanyYear.UNKNOWN))
                .toList();
        Path data = dir.resolve("real.csv");
        CsvCodec.write(rows, data);

        String report = run("--data", data.toString(), "--folds", "3", "--bootstrap", "0", "--out", dir.toString());
        assertTrue(report.contains("unknown"), "2025 sale rate should be shown as unknown");
        assertFalse(report.contains("Oracle"), "no ground truth for CSV data");
        assertFalse(report.contains("Hindsight"), "outcomes are unknown");
        assertTrue(Files.exists(dir.resolve("scores-2025.csv")));
    }

    private String run(String... args) throws Exception {
        var buf = new ByteArrayOutputStream();
        new Main(Config.parse(args), new PrintStream(buf, true)).run();
        return buf.toString();
    }
}
