package hack.report;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Fixed-width console table. The first column is left-aligned, the rest right-aligned unless told otherwise. */
public final class TextTable {

    private final String[] headers;
    private final boolean[] left;
    private final List<String[]> rows = new ArrayList<>();

    public TextTable(String... headers) {
        this.headers = headers;
        this.left = new boolean[headers.length];
        left[0] = true;
    }

    public TextTable leftAlign(int... columns) {
        for (int c : columns) left[c] = true;
        return this;
    }

    public TextTable row(Object... cells) {
        if (cells.length != headers.length) throw new IllegalArgumentException("expected %d cells".formatted(headers.length));
        rows.add(Arrays.stream(cells).map(String::valueOf).toArray(String[]::new));
        return this;
    }

    public String render(String indent) {
        int[] w = new int[headers.length];
        for (int c = 0; c < w.length; c++) {
            w[c] = headers[c].length();
            for (String[] r : rows) w[c] = Math.max(w[c], r[c].length());
        }
        StringBuilder sb = new StringBuilder();
        line(sb, indent, headers, w);
        sb.append(indent);
        for (int c = 0; c < w.length; c++) sb.append(c == 0 ? "" : "  ").append("-".repeat(w[c]));
        sb.append('\n');
        for (String[] r : rows) line(sb, indent, r, w);
        return sb.toString();
    }

    private void line(StringBuilder sb, String indent, String[] cells, int[] w) {
        StringBuilder l = new StringBuilder(indent);
        for (int c = 0; c < cells.length; c++) {
            if (c > 0) l.append("  ");
            String pad = " ".repeat(w[c] - cells[c].length());
            l.append(left[c] ? cells[c] + pad : pad + cells[c]);
        }
        sb.append(l.toString().stripTrailing()).append('\n');
    }
}
