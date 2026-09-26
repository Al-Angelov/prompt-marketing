import type { Prospect } from './data';

export const structuredFields = [
 ['foundedYear','Founded year'], ['revenueK','Revenue (EUR thousands)'], ['employees','Employees'],
 ['ebitdaMargin','EBITDA margin (ratio)'], ['leverage','Debt / assets'], ['revenueGrowth3y','3-year revenue CAGR (ratio)'],
 ['maxDirectorTenure','Longest director tenure (years)'], ['ownerAge','Controlling owner age'],
 ['familyOwned','Family owned'], ['shareholders','Shareholder count'], ['sectorDeals24m','Sector deals / 1,000 firms (24 months)'],
] as const;
export type StructuredField = typeof structuredFields[number][0];
export type CompanyInput = { id:string; year:number; sector:string } & Partial<Record<Exclude<StructuredField,'familyOwned'>,number|null>> & {familyOwned?:boolean|null};
export type ModelResult = {
 schemaVersion:1;companyId:string;year:number;status:'scored'|'insufficient_data';probability:number|null;percentile:number|null;baselineLogOdds:number|null;
 contributions:{feature:string;observedValue:number|null;imputed:boolean;logOdds:number}[];
 suppliedFields:string[];missingFields:string[];coverage:number;confidence:'High'|'Moderate'|'Low';
 metadata:{modelId:string;modelUsed:string;initializedAt:string;trainingSource:string;syntheticTraining:boolean;trainingRows:number;trainedThroughYear:number;trainingBaseRate:number;target:string;calibration:string;explanationMethod:string};warnings:string[];
};
export type StructuredState = {status:'ready';input:CompanyInput;result:ModelResult;inputProvenance:'demo-fixture'|'user-supplied'|'public-sourced'} | {status:'unavailable';input:CompanyInput;error:string;inputProvenance:'demo-fixture'|'user-supplied'|'public-sourced'};

// Only the values already present in the prospect fixtures are sent. No invented
// ages, margins, ownership flags or registry values to make the model look complete.
export function companyInput(p:Prospect):CompanyInput {
 if(p.structured)return p.structured.input;
 const result:CompanyInput={id:String(p.id),year:2027,sector:p.sector};
 if(p.employees>0)result.employees=p.employees;
 const revenue=/^€([\d.]+)m$/.exec(p.revenue);
 if(revenue)result.revenueK=Number(revenue[1])*1000;
 if(p.id===1)result.foundedYear=1998; // explicit existing source fixture
 return result;
}

function validResult(value:unknown,input:CompanyInput):value is ModelResult {
 if(!value||typeof value!=='object')return false;
 const v=value as ModelResult;
 const finite=(x:unknown,min:number,max:number)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
 const supplied=structuredFields.map(([key])=>key).filter(key=>input[key]!=null);
 return v.schemaVersion===1&&v.companyId===input.id&&v.year===input.year&&['scored','insufficient_data'].includes(v.status)
  &&(v.status==='scored'?finite(v.probability,0,1)&&finite(v.percentile,0,100)&&typeof v.baselineLogOdds==='number'&&Number.isFinite(v.baselineLogOdds):v.probability===null&&v.percentile===null)
  &&finite(v.coverage,0,1)&&['High','Moderate','Low'].includes(v.confidence)
  &&Array.isArray(v.suppliedFields)&&Array.isArray(v.missingFields)&&[...v.suppliedFields,...v.missingFields].every(x=>typeof x==='string')
  &&v.suppliedFields.length===supplied.length&&supplied.every(key=>v.suppliedFields.includes(key))
  &&new Set([...v.suppliedFields,...v.missingFields]).size===structuredFields.length
  &&structuredFields.every(([key])=>v.suppliedFields.includes(key)!==v.missingFields.includes(key))
  &&Math.abs(v.coverage-supplied.length/structuredFields.length)<1e-8
  &&Array.isArray(v.contributions)&&v.contributions.every(c=>typeof c.feature==='string'&&typeof c.imputed==='boolean'&&Number.isFinite(c.logOdds)&&(c.observedValue===null||Number.isFinite(c.observedValue)))
  &&typeof v.metadata?.modelId==='string'&&typeof v.metadata.modelUsed==='string'&&typeof v.metadata.syntheticTraining==='boolean'&&typeof v.metadata.trainingSource==='string'
  &&finite(v.metadata.trainingRows,1,1e12)&&finite(v.metadata.trainedThroughYear,1000,input.year-1)&&typeof v.metadata.explanationMethod==='string'
  &&Array.isArray(v.warnings)&&v.warnings.every(w=>typeof w==='string');
}

export async function scoreCompany(input:CompanyInput,signal?:AbortSignal,inputProvenance:StructuredState['inputProvenance']='demo-fixture'):Promise<StructuredState> {
 const controller=new AbortController();const cancel=()=>controller.abort();
 signal?.addEventListener('abort',cancel,{once:true});
 const timeout=window.setTimeout(cancel,12000);
 try {
  if(signal?.aborted)controller.abort();
  const response=await fetch('/api/score',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:controller.signal});
  if(!response.ok){let message=`Scoring API returned ${response.status}`;try{const body=await response.json();message=body.message||message}catch{}throw new Error(message)}
  const value:unknown=await response.json();
  if(!validResult(value,input))throw new Error('Scoring API returned an incompatible response');
  return {status:'ready',input,result:value,inputProvenance};
 }catch(error){return {status:'unavailable',input,error:controller.signal.aborted?'Scoring request timed out or was cancelled':error instanceof Error?error.message:'Scoring API unavailable',inputProvenance};}
 finally{window.clearTimeout(timeout);signal?.removeEventListener('abort',cancel)}
}
