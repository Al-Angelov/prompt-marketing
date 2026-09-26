package hack.features;

import hack.data.CompanyYear;

import java.util.function.ToDoubleFunction;

/** One model input. Returns {@code NaN} when the underlying data is missing. */
public record Feature(String name, ToDoubleFunction<CompanyYear> extractor) {
    public double valueOf(CompanyYear row) { return extractor.applyAsDouble(row); }
}
