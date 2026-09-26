import type { Prospect } from './data';
import type { Investigation } from './research';

export type CombinedAssessment = {
 structuredWeight:number;nominalStructuredWeight:number;publicPositive:number;contradictionPenalty:number;structuredRank:number|null;
 coverage:number;mode:'java-synthetic'|'java-model'|'demo-fallback';explanation:string;demo:boolean;
};

/** One fusion policy. Probability is never mixed directly with a 0–100 priority rubric.
 * A reference-cohort percentile supplies the model's ranking component. This is a
 * transparent heuristic pending regional backtesting, not a calibrated probability. */
export function combineAssessment(p:Prospect,publicReport:Investigation):Investigation {
 const nordic=['Sweden','Finland','Denmark'].includes(p.country);
 const nominal=nordic?.65:.25;
 const result=p.structured?.status==='ready'?p.structured.result:null;
 const coverage=result?.coverage??0;
 const rank=result?.status==='scored'?result.percentile:null;
 const weight=rank===null?0:nominal*coverage;
 const positive=publicReport.factors.filter(f=>f.points>0).reduce((sum,f)=>sum+f.points,0);
 const penalty=publicReport.factors.filter(f=>f.points<0).reduce((sum,f)=>sum+f.points,0);
 const score=publicReport.score===null?null:Math.round(Math.max(0,Math.min(100,(1-weight)*positive+weight*(rank??0)+penalty)));
 const publicQuality=publicReport.confidence==='High'?1:publicReport.confidence==='Moderate'?.6:.15;
 let certainty=(1-nominal)*publicQuality+nominal*coverage;
 if(result?.metadata.syntheticTraining)certainty=Math.min(certainty,.79);
 const confidence=certainty>=.8?'High':certainty>=.5?'Moderate':'Low';
 const principalVerified=publicReport.evidence.slice(0,2).every(e=>e.status==='Verified'&&e.sources.some(s=>s.independent));
 const demo=!result||result.metadata.syntheticTraining||p.structured?.inputProvenance==='demo-fixture'||p.publicEvidenceMode!=='verified';
 const contact=score!==null&&score>=70&&confidence==='High'&&principalVerified&&!demo;
 const draftAllowed=contact||(demo&&score!==null&&score>=60&&principalVerified);
 const mode=!result?'demo-fallback':result.metadata.syntheticTraining?'java-synthetic':'java-model';
 const explanation=`${Math.round(positive*10)/10} public-signal points × ${(100*(1-weight)).toFixed(1)}% + ${rank===null?'no structured rank':rank.toFixed(1)+' model percentile × '+(100*weight).toFixed(1)+'%'} ${penalty<0?'− '+Math.abs(Math.round(penalty*10)/10)+' contradiction points':'+ 0 contradiction points'}.`;
 const combined:CombinedAssessment={structuredWeight:weight,nominalStructuredWeight:nominal,publicPositive:positive,contradictionPenalty:penalty,structuredRank:rank,coverage,mode,explanation,demo};
 return {...publicReport,score,confidence,contact,draftAllowed,combined,nextStep:contact?'Advisor review → a confidential introduction grounded in verified evidence.':demo&&draftAllowed?'Illustrative conversation only. Validate the model and replace mock public evidence before contacting the owner.':'Do not contact yet. Confirm material public claims and improve the missing or contradictory evidence; a model score alone cannot justify outreach.'};
}
