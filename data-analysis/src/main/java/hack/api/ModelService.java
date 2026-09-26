package hack.api;

import hack.data.*;
import hack.features.FeatureSet;
import hack.model.*;
import java.time.Instant;
import java.util.*;

/** One startup fit, immutable model reused for all HTTP requests. CLI/backtesting stays separate. */
public final class ModelService {
    private final FeatureSet features = FeatureSet.standard();
    private final ScoringModel model;
    private final double[] referenceScores;
    private final double baseline;
    private final Metadata metadata;
    public record Metadata(String modelId,String modelUsed,String initializedAt,String trainingSource,
            boolean syntheticTraining,int trainingRows,int trainedThroughYear,double trainingBaseRate,
            String target,String calibration,String explanationMethod) {}
    public record Contribution(String feature,Double observedValue,boolean imputed,double logOdds) {}
    public record Result(int schemaVersion,String companyId,int year,String status,Double probability,Double percentile,
            Double baselineLogOdds,List<Contribution> contributions,List<String> suppliedFields,List<String> missingFields,
            double coverage,String confidence,Metadata metadata,List<String> warnings) {}

    public ModelService(DataSource source,Trainer trainer) throws java.io.IOException {
        List<CompanyYear> rows=source.load().stream().filter(CompanyYear::labeled).toList();
        if(rows.isEmpty()) throw new IllegalArgumentException("No labeled training history");
        double[][] x=features.matrix(rows);
        int[] y=rows.stream().mapToInt(CompanyYear::sold).toArray();
        model=new Imputing(trainer).fit(x,y);
        double[] reference=Arrays.stream(x).filter(row->{double p=model.score(row);return p>1e-10&&p<1-1e-10;}).findFirst()
                .orElseThrow(()->new IllegalArgumentException("Model is saturated; inspect training data before serving"));
        double referenceProbability=model.score(reference);
        baseline=Math.log(referenceProbability/(1-referenceProbability))-Arrays.stream(model.contributions(reference)).sum();
        referenceScores=Arrays.stream(x).mapToDouble(model::score).sorted().toArray();
        metadata=new Metadata(UUID.randomUUID().toString(),trainer.name(),Instant.now().toString(),
                source instanceof SyntheticDataSource?"synthetic":"configured CSV",source instanceof SyntheticDataSource,
                rows.size(),rows.stream().mapToInt(CompanyYear::year).max().orElseThrow(),Arrays.stream(y).average().orElseThrow(),
                "Acquired during the observation year from start-of-year structured features; not owner willingness to sell",
                "Not externally calibrated or validated for Mergero markets",
                trainer instanceof GradientBoosting?"Saabas additive log-odds":"Additive standardized-feature log-odds");
    }
    public Metadata metadata(){return metadata;}

    public Result score(CompanyInput input) {
        CompanyYear row=input.row();
        if(row.year()<=metadata.trainedThroughYear()) throw new IllegalArgumentException("year must be after training history: "+metadata.trainedThroughYear());
        double coverage=input.supplied().size()/(double)CompanyInput.FIELDS.size();
        String confidence=coverage>=.8?"High":coverage>=.5?"Moderate":"Low";
        List<String> warnings=new ArrayList<>();
        warnings.add("Model output is historical acquisition propensity, never owner intent.");
        if(metadata.syntheticTraining()) warnings.add("Synthetic training only; output is demonstrative, not real-world validated.");
        if(!input.missing().isEmpty()) warnings.add("Missing features are median-imputed inside the model, not asserted as observed facts. Coverage reduces combined weight and confidence.");
        if(row.year()>metadata.trainedThroughYear()+2) warnings.add("Observation year is more than two years beyond training; review model drift.");
        if(input.supplied().size()<2) return new Result(1,row.id(),row.year(),"insufficient_data",null,null,null,List.of(),input.supplied(),input.missing(),coverage,"Low",metadata,warnings);
        double[] x=features.extract(row), contributions=model.contributions(x);
        double probability=model.score(x);
        List<Contribution> reasons=new ArrayList<>();
        for(int i=0;i<x.length;i++) reasons.add(new Contribution(features.names().get(i),Double.isNaN(x[i])?null:x[i],Double.isNaN(x[i]),contributions[i]));
        int below=lowerBound(probability),atOrBelow=upperBound(probability);
        double percentile=100.0*(below+atOrBelow)/2/referenceScores.length;
        return new Result(1,row.id(),row.year(),"scored",probability,percentile,baseline,
                List.copyOf(reasons),input.supplied(),input.missing(),coverage,confidence,metadata,List.copyOf(warnings));
    }
    private int lowerBound(double value){int l=0,h=referenceScores.length;while(l<h){int m=(l+h)>>>1;if(referenceScores[m]<value)l=m+1;else h=m;}return l;}
    private int upperBound(double value){int l=0,h=referenceScores.length;while(l<h){int m=(l+h)>>>1;if(referenceScores[m]<=value)l=m+1;else h=m;}return l;}
}
