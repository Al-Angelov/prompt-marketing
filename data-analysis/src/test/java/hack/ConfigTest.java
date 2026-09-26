package hack;

import org.junit.jupiter.api.Test;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class ConfigTest {

    @Test void defaults() {
        Config c = Config.defaults();
        assertNull(c.data());
        assertEquals(20_000, c.companies());
        assertEquals(2015, c.fromYear());
        assertEquals(2025, c.toYear());
    }

    @Test void parsesOptions() {
        Config c = Config.parse(new String[]{"--data", "x.csv", "--years", "2010-2020", "--folds", "3", "--bootstrap", "0"});
        assertEquals(Path.of("x.csv"), c.data());
        assertEquals(2010, c.fromYear());
        assertEquals(2020, c.toYear());
        assertEquals(3, c.folds());
        assertEquals(0, c.bootstrap());
    }

    @Test void rejectsBadInput() {
        assertThrows(IllegalArgumentException.class, () -> Config.parse(new String[]{"--nope", "1"}));
        assertThrows(IllegalArgumentException.class, () -> Config.parse(new String[]{"--folds"}));
        assertThrows(IllegalArgumentException.class, () -> Config.parse(new String[]{"--folds", "0"}));
        assertThrows(IllegalArgumentException.class, () -> Config.parse(new String[]{"--years", "2020-2010"}));
        assertThrows(IllegalArgumentException.class, () -> Config.parse(new String[]{"--companies", "many"}));
        assertThrows(Config.HelpRequested.class, () -> Config.parse(new String[]{"--help"}));
    }
}
