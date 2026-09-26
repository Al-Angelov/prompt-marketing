package hack.data;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

/**
 * Reads and writes company-years as CSV. Columns are matched by header name, so extra columns
 * and any column order are fine. Empty numeric cells mean missing; an empty {@code sold} cell
 * means the outcome is unknown.
 */
public final class CsvCodec {

    public static final List<String> COLUMNS = List.of(
            "id", "year", "sector", "foundedYear", "revenueK", "employees", "ebitdaMargin",
            "leverage", "revenueGrowth3y", "maxDirectorTenure", "ownerAge", "familyOwned",
            "shareholders", "sectorDeals24m", "sold");

    private CsvCodec() {}

    public static void write(List<CompanyYear> rows, Path file) throws IOException {
        if (file.getParent() != null) Files.createDirectories(file.getParent());
        try (var w = Files.newBufferedWriter(file)) {
            w.write(String.join(",", COLUMNS));
            w.newLine();
            for (var r : rows) {
                w.write(String.join(",",
                        r.id(), Integer.toString(r.year()), r.sector(), Integer.toString(r.foundedYear()),
                        num(r.revenueK()), num(r.employees()), num(r.ebitdaMargin()), num(r.leverage()),
                        num(r.revenueGrowth3y()), num(r.maxDirectorTenure()), num(r.ownerAge()),
                        r.familyOwned() ? "1" : "0", Integer.toString(r.shareholders()),
                        num(r.sectorDeals24m()), r.labeled() ? Integer.toString(r.sold()) : ""));
                w.newLine();
            }
        }
    }

    public static List<CompanyYear> read(Path file) throws IOException {
        List<String> lines = Files.readAllLines(file);
        if (lines.isEmpty()) throw new IOException(file + ": empty file");

        String[] header = lines.get(0).split(",", -1);
        Map<String, Integer> col = new HashMap<>();
        for (int i = 0; i < header.length; i++) col.put(header[i].trim(), i);
        List<String> missing = COLUMNS.stream().filter(c -> !col.containsKey(c)).toList();
        if (!missing.isEmpty()) throw new IOException(file + ": missing columns " + missing);

        List<CompanyYear> rows = new ArrayList<>(lines.size());
        for (int n = 1; n < lines.size(); n++) {
            String line = lines.get(n);
            if (line.isBlank()) continue;
            String[] f = line.split(",", -1);
            try {
                if (f.length < header.length)
                    throw new IllegalArgumentException("expected %d fields, got %d".formatted(header.length, f.length));
                rows.add(new CompanyYear(
                        f[col.get("id")].trim(),
                        Integer.parseInt(f[col.get("year")].trim()),
                        f[col.get("sector")].trim(),
                        Integer.parseInt(f[col.get("foundedYear")].trim()),
                        dbl(f[col.get("revenueK")]),
                        dbl(f[col.get("employees")]),
                        dbl(f[col.get("ebitdaMargin")]),
                        dbl(f[col.get("leverage")]),
                        dbl(f[col.get("revenueGrowth3y")]),
                        dbl(f[col.get("maxDirectorTenure")]),
                        dbl(f[col.get("ownerAge")]),
                        bool(f[col.get("familyOwned")]),
                        Integer.parseInt(f[col.get("shareholders")].trim()),
                        dbl(f[col.get("sectorDeals24m")]),
                        label(f[col.get("sold")])));
            } catch (RuntimeException e) {
                throw new IOException("%s line %d: %s".formatted(file, n + 1, e.getMessage()), e);
            }
        }
        return rows;
    }

    private static String num(double v) { return Double.isNaN(v) ? "" : Double.toString(v); }

    private static double dbl(String s) { return s.isBlank() ? Double.NaN : Double.parseDouble(s.trim()); }

    private static boolean bool(String s) {
        return switch (s.trim().toLowerCase(Locale.ROOT)) {
            case "1", "true", "yes", "y" -> true;
            case "0", "false", "no", "n", "" -> false;
            default -> throw new IllegalArgumentException("not a boolean: " + s);
        };
    }

    private static int label(String s) { return s.isBlank() ? CompanyYear.UNKNOWN : Integer.parseInt(s.trim()); }
}
