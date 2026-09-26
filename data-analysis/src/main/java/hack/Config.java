package hack;

import java.nio.file.Path;

/** Command-line options. */
public record Config(Path data, int companies, int fromYear, int toYear, long seed,
                     int folds, int top, int bootstrap, Path out, Path exportData) {

    public static final String USAGE = """
            Usage: ma-score [options]
              --data <file.csv>        score real data (see README for columns); default: synthetic
              --companies <n>          synthetic companies (default 20000)
              --years <from>-<to>      synthetic panel years (default 2015-2025)
              --seed <n>               synthetic data seed (default 42)
              --folds <n>              walk-forward test years (default 5)
              --top <n>                targets to print (default 20)
              --bootstrap <n>          bootstrap resamples for AUC intervals, 0 = off (default 200)
              --out <dir>              where to write CSV outputs (default target/output)
              --export-data <file>     also write the input data as CSV (handy for the synthetic set)
            """;

    public static Config defaults() { return parse(new String[0]); }

    public static Config parse(String[] args) {
        Path data = null, out = Path.of("target", "output"), exportData = null;
        int companies = 20_000, fromYear = 2015, toYear = 2025, folds = 5, top = 20, bootstrap = 200;
        long seed = 42;
        for (int i = 0; i < args.length; i++) {
            String flag = args[i];
            if (flag.equals("--help") || flag.equals("-h")) throw new HelpRequested();
            if (i + 1 >= args.length) throw new IllegalArgumentException("missing value for " + flag);
            String v = args[++i];
            switch (flag) {
                case "--data" -> data = Path.of(v);
                case "--companies" -> companies = positive(flag, v);
                case "--years" -> {
                    String[] p = v.split("-");
                    if (p.length != 2) throw new IllegalArgumentException("--years expects <from>-<to>, e.g. 2015-2025");
                    fromYear = integer(flag, p[0]);
                    toYear = integer(flag, p[1]);
                }
                case "--seed" -> seed = integer(flag, v);
                case "--folds" -> folds = positive(flag, v);
                case "--top" -> top = positive(flag, v);
                case "--bootstrap" -> bootstrap = Math.max(0, integer(flag, v));
                case "--out" -> out = Path.of(v);
                case "--export-data" -> exportData = Path.of(v);
                default -> throw new IllegalArgumentException("unknown option " + flag);
            }
        }
        if (toYear < fromYear) throw new IllegalArgumentException("--years: <to> is before <from>");
        return new Config(data, companies, fromYear, toYear, seed, folds, top, bootstrap, out, exportData);
    }

    private static int integer(String flag, String v) {
        try {
            return Integer.parseInt(v.trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(flag + " expects a whole number, got '" + v + "'");
        }
    }

    private static int positive(String flag, String v) {
        int n = integer(flag, v);
        if (n <= 0) throw new IllegalArgumentException(flag + " must be positive");
        return n;
    }

    public static final class HelpRequested extends RuntimeException {
        HelpRequested() { super(null, null, false, false); }
    }
}
