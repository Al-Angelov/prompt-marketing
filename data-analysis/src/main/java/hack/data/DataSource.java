package hack.data;

import java.io.IOException;
import java.util.List;

/** Anything that can produce company-year rows: the simulator today, real registry data later. */
public interface DataSource {
    List<CompanyYear> load() throws IOException;

    String describe();
}
