package hack.api;

import com.google.gson.*;
import hack.data.CompanyYear;
import java.util.*;

/** Validated, nullable transport fields. Missing values never become asserted company facts. */
public record CompanyInput(CompanyYear row, List<String> supplied, List<String> missing) {
    public static final List<String> FIELDS = List.of("foundedYear", "revenueK", "employees", "ebitdaMargin",
            "leverage", "revenueGrowth3y", "maxDirectorTenure", "ownerAge", "familyOwned", "shareholders", "sectorDeals24m");

    public static CompanyInput parse(JsonObject json) {
        Set<String> allowed = new HashSet<>(FIELDS);
        allowed.addAll(List.of("id", "year", "sector"));
        for (String name : json.keySet()) if (!allowed.contains(name)) throw new IllegalArgumentException("Unknown input: " + name);
        String id = text(json, "id", true), sector = text(json, "sector", false);
        Integer year = integer(json, "year", 1900, 2200);
        if (year == null) throw new IllegalArgumentException("year is required (features available at start of year)");
        Integer founded = integer(json, "foundedYear", 1000, year);
        List<String> supplied = FIELDS.stream().filter(f -> has(json, f)).toList();
        List<String> missing = FIELDS.stream().filter(f -> !has(json, f)).toList();
        CompanyYear row = new CompanyYear(id, year, sector, founded,
                number(json,"revenueK",Double.MIN_VALUE,1e12), number(json,"employees",0,1e8),
                number(json,"ebitdaMargin",-100,100), number(json,"leverage",0,100),
                number(json,"revenueGrowth3y",-1,100), number(json,"maxDirectorTenure",0,150),
                number(json,"ownerAge",18,120), bool(json,"familyOwned"), integer(json,"shareholders",1,10000000),
                number(json,"sectorDeals24m",0,1000000), CompanyYear.UNKNOWN);
        return new CompanyInput(row, supplied, missing);
    }
    private static boolean has(JsonObject j,String key) { return j.has(key) && !j.get(key).isJsonNull(); }
    private static String text(JsonObject j,String key,boolean required) {
        if (!has(j,key)) { if(required) throw new IllegalArgumentException(key+" is required"); return "Unknown"; }
        JsonElement e=j.get(key);
        if(!e.isJsonPrimitive()||!e.getAsJsonPrimitive().isString()) throw new IllegalArgumentException(key+" must be a string");
        String s=e.getAsString().trim();
        if(s.isEmpty()||s.length()>200) throw new IllegalArgumentException(key+" must be 1–200 characters");
        return s;
    }
    private static double number(JsonObject j,String key,double min,double max) {
        if(!has(j,key)) return Double.NaN;
        JsonElement e=j.get(key);
        if(!e.isJsonPrimitive()||!e.getAsJsonPrimitive().isNumber()) throw new IllegalArgumentException(key+" must be a number or null");
        double v=e.getAsDouble();
        if(!Double.isFinite(v)||v<min||v>max) throw new IllegalArgumentException(key+" outside permitted range");
        return v;
    }
    private static Integer integer(JsonObject j,String key,int min,int max) {
        double v=number(j,key,min,max);
        if(Double.isNaN(v)) return null;
        if(v!=Math.rint(v)) throw new IllegalArgumentException(key+" must be an integer");
        return (int)v;
    }
    private static Boolean bool(JsonObject j,String key) {
        if(!has(j,key)) return null;
        JsonElement e=j.get(key);
        if(e.isJsonPrimitive()&&e.getAsJsonPrimitive().isBoolean()) return e.getAsBoolean();
        double n=number(j,key,0,1);
        if(n!=0&&n!=1) throw new IllegalArgumentException(key+" must be true, false, 1, 0 or null");
        return n==1;
    }
}
