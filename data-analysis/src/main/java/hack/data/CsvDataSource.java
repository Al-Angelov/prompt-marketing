package hack.data;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;

public record CsvDataSource(Path file) implements DataSource {
    @Override public List<CompanyYear> load() throws IOException { return CsvCodec.read(file); }

    @Override public String describe() { return "CSV " + file; }
}
