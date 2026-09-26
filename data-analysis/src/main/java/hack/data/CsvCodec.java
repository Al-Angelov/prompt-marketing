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
                        escape(r.id()), Integer.toString(r.year()), escape(r.sector()), integerText(r.foundedYear()),
                        num(r.revenueK()), num(r.employees()), num(r.ebitdaMargin()), num(r.leverage()),
                        num(r.revenueGrowth3y()), num(r.maxDirectorTenure()), num(r.ownerAge()),
                        r.familyOwned() == null ? "" : r.familyOwned() ? "1" : "0", integerText(r.shareholders()),
                        num(r.sectorDeals24m()), r.labeled() ? Integer.toString(r.sold()) : ""));
                w.newLine();
            }
        }
    }

    public static List<CompanyYear> read(Path file) throws IOException {
        List<List<String>> lines = records(Files.readString(file));
        if (lines.isEmpty()) throw new IOException(file + ": empty file");

        String[] header = lines.get(0).toArray(String[]::new);
        header[0]=header[0].replace("\uFEFF","");
        Map<String, Integer> col = new HashMap<>();
        for (int i = 0; i < header.length; i++) col.put(header[i].trim(), i);
        List<String> missing = COLUMNS.stream().filter(c -> !col.containsKey(c)).toList();
        if (!missing.isEmpty()) throw new IOException(file + ": missing columns " + missing);

        List<CompanyYear> rows = new ArrayList<>(lines.size());
        for (int n = 1; n < lines.size(); n++) {
            String[] f = lines.get(n).toArray(String[]::new);
            if(f.length==1&&f[0].isBlank())continue;
            try {
                if (f.length < header.length)
                    throw new IllegalArgumentException("expected %d fields, got %d".formatted(header.length, f.length));
                rows.add(new CompanyYear(
                        f[col.get("id")].trim(),
                        Integer.parseInt(f[col.get("year")].trim()),
                        f[col.get("sector")].trim(),
                        nullableInteger(f[col.get("foundedYear")]),
                        dbl(f[col.get("revenueK")]),
                        dbl(f[col.get("employees")]),
                        dbl(f[col.get("ebitdaMargin")]),
                        dbl(f[col.get("leverage")]),
                        dbl(f[col.get("revenueGrowth3y")]),
                        dbl(f[col.get("maxDirectorTenure")]),
                        dbl(f[col.get("ownerAge")]),
                        bool(f[col.get("familyOwned")]),
                        nullableInteger(f[col.get("shareholders")]),
                        dbl(f[col.get("sectorDeals24m")]),
                        label(f[col.get("sold")])));
            } catch (RuntimeException e) {
                throw new IOException("%s line %d: %s".formatted(file, n + 1, e.getMessage()), e);
            }
        }
        return rows;
    }

    private static String num(double v) { return Double.isNaN(v) ? "" : Double.toString(v); }

    private static double dbl(String s) {
        if(s.isBlank())return Double.NaN;
        double value=Double.parseDouble(s.trim());
        if(!Double.isFinite(value))throw new IllegalArgumentException("non-finite numeric value");
        return value;
    }

    public static String escape(String s) {
        return s.contains(",")||s.contains("\"")||s.contains("\n")||s.contains("\r")?'"'+s.replace("\"","\"\"")+'"':s;
    }

    /** Quoted commas, escaped quotes and multiline values; one codec for input and output. */
    private static List<List<String>> records(String text) throws IOException {
        List<List<String>> result=new ArrayList<>();List<String> row=new ArrayList<>();
        StringBuilder cell=new StringBuilder();boolean quoted=false,closed=false;
        for(int i=0;i<text.length();i++) {
            char c=text.charAt(i);
            if(quoted) {
                if(c=='"') {if(i+1<text.length()&&text.charAt(i+1)=='"'){cell.append('"');i++;}else{quoted=false;closed=true;}}
                else cell.append(c);
            } else if(c==','||c=='\n'||c=='\r') {
                row.add(cell.toString());cell.setLength(0);closed=false;
                if(c!=','){result.add(List.copyOf(row));row.clear();if(c=='\r'&&i+1<text.length()&&text.charAt(i+1)=='\n')i++;}
            } else if(c=='"') {
                if(cell.length()!=0||closed)throw new IOException("unexpected quote in CSV");quoted=true;
            } else {if(closed)throw new IOException("characters after closing CSV quote");cell.append(c);}
        }
        if(quoted)throw new IOException("unterminated CSV quote");
        if(!row.isEmpty()||cell.length()>0||closed){row.add(cell.toString());result.add(List.copyOf(row));}
        return result;
    }

    private static String integerText(Integer n) { return n == null ? "" : n.toString(); }
    private static Integer nullableInteger(String s) { return s.isBlank() ? null : Integer.valueOf(s.trim()); }

    private static Boolean bool(String s) {
        return switch (s.trim().toLowerCase(Locale.ROOT)) {
            case "1", "true", "yes", "y" -> true;
            case "0", "false", "no", "n" -> false;
            case "" -> null;
            default -> throw new IllegalArgumentException("not a boolean: " + s);
        };
    }

    private static int label(String s) { return s.isBlank() ? CompanyYear.UNKNOWN : Integer.parseInt(s.trim()); }
}
