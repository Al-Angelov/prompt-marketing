import type {Prospect} from './data';
import {structuredFields, type CompanyInput} from './modelApi';

export type Citation={url:string;title:string;published_at:string|null;excerpt:string;stance:'supports'|'contradicts'|'context';origin_group:string;independent:boolean;independence_basis:string};
export type PublicClaim={signal_id:string;signal_name:string;evidence_found:string|null;sources:string[];confidence:'high'|'medium'|'low';notes:string|null;verification_status:'verified'|'partially_verified'|'conflicting'|'unverified'|'insufficient_evidence';kind:'leadership'|'operational'|'growth'|'liquidity'|'partnership'|'explicit_exit'|'structured_context'|'context';direction:'positive'|'negative'|'neutral';citations:Citation[];verification_note:string};
export type ResearchReport={schema_version:2;research_mode:'web_search';cache_hit:boolean;company_name:string;region:string;website:string|null;researched_at:string;retrieved_source_urls:string[];summary:string;signal_evidence:PublicClaim[];data_gaps:string[];structured_facts:{field:string;value:number|boolean|null;as_of:string|null;sources:string[]}[];verification_complete:boolean;verification_method:string;warnings:string[]};
export type PublicResearch={status:'live';report:ResearchReport}|{status:'unavailable';error:string};
export type Candidate={name:string;website:string|null;country:string|null;source:string;registry_id?:string|null};
export const safeUrl=(url:unknown):url is string=>{try{const u=new URL(String(url));return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password}catch{return false}};
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string');

async function post(path:string,body:unknown,signal?:AbortSignal):Promise<any>{
 const controller=new AbortController();const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
 const timer=window.setTimeout(cancel,240000);
 try{
  if(signal?.aborted)throw new Error('Research cancelled');
  const response=await fetch('/api/research/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
  if(!response.ok)throw new Error('Research backend unavailable ('+response.status+').');
  return await response.json();
 }finally{window.clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
}

function validateReport(v:ResearchReport,name:string,region:string):boolean{
 return v?.schema_version===2&&v.research_mode==='web_search'&&v.company_name?.trim().toLowerCase()===name.trim().toLowerCase()&&v.region?.trim().toLowerCase()===region.trim().toLowerCase()
  &&typeof v.cache_hit==='boolean'&&typeof v.summary==='string'&&typeof v.researched_at==='string'&&Number.isFinite(Date.parse(v.researched_at))&&typeof v.verification_complete==='boolean'&&typeof v.verification_method==='string'
  &&strings(v.retrieved_source_urls)&&v.retrieved_source_urls.every(safeUrl)&&strings(v.data_gaps)&&strings(v.warnings)
  &&Array.isArray(v.signal_evidence)&&new Set(v.signal_evidence.map(e=>e.signal_id)).size===v.signal_evidence.length&&v.signal_evidence.every(e=>
   typeof e.signal_id==='string'&&typeof e.signal_name==='string'&&(e.evidence_found===null||typeof e.evidence_found==='string')&&typeof e.verification_note==='string'
   &&['verified','partially_verified','conflicting','unverified','insufficient_evidence'].includes(e.verification_status)&&['positive','negative','neutral'].includes(e.direction)
   &&['leadership','operational','growth','liquidity','partnership','explicit_exit','structured_context','context'].includes(e.kind)&&strings(e.sources)&&e.sources.every(s=>safeUrl(s)&&v.retrieved_source_urls.includes(s))
   &&Array.isArray(e.citations)&&e.citations.every(c=>safeUrl(c.url)&&v.retrieved_source_urls.includes(c.url)&&typeof c.title==='string'&&typeof c.excerpt==='string'&&typeof c.independent==='boolean'&&typeof c.independence_basis==='string'&&typeof c.origin_group==='string'&&['supports','contradicts','context'].includes(c.stance)&&(c.published_at===null||typeof c.published_at==='string')))
  &&Array.isArray(v.structured_facts)&&v.structured_facts.every(f=>typeof f.field==='string'&&(f.value===null||typeof f.value==='boolean'||typeof f.value==='number'&&Number.isFinite(f.value))&&(f.as_of===null||typeof f.as_of==='string')&&strings(f.sources)&&f.sources.every(s=>safeUrl(s)&&v.retrieved_source_urls.includes(s)));
}

export async function researchCompany(name:string,region:string,website?:string,signal?:AbortSignal):Promise<PublicResearch>{
 try{const report=await post('company',{company_name:name,region,company_website:website||null},signal);if(!validateReport(report,name,region))throw new Error('Research returned an incompatible or ungrounded report.');return {status:'live',report}}
 catch(error){return {status:'unavailable',error:error instanceof Error?error.message:'Public research unavailable'}}
}

export async function discoverCompanies(region:string,criteria:string,signal?:AbortSignal):Promise<Candidate[]>{
 const result=await post('universe',{region,criteria,max_companies:5},signal);
 if(result?.schema_version!==2||result.research_mode!=='web_search'||result.region?.trim().toLowerCase()!==region.trim().toLowerCase()||!strings(result.retrieved_source_urls)||!Array.isArray(result.companies))throw new Error('Discovery returned an incompatible response.');
 return result.companies.filter((c:Candidate)=>typeof c.name==='string'&&c.name.trim()&&safeUrl(c.source)&&result.retrieved_source_urls.includes(c.source)&&(c.website===null||safeUrl(c.website))&&(c.country===null||typeof c.country==='string')).slice(0,5);
}

// Only cited, dated, explicitly reported values enter Java. Never merge fixture facts.
export function sourcedInputs(p:Prospect,report:ResearchReport,year:number):CompanyInput{
 const input:CompanyInput={id:String(p.id),year,sector:p.sector};
 const blocked=new Set<string>();const seen=new Map<string,number|boolean>();
 for(const fact of report.structured_facts){
  if(!structuredFields.some(([key])=>key===fact.field)||fact.value===null||!fact.as_of||!Number.isFinite(Date.parse(fact.as_of))||fact.as_of>=`${year}-01-01`||Date.parse(fact.as_of)>Date.now()||!fact.sources.length)continue;
  if(seen.has(fact.field)&&seen.get(fact.field)!==fact.value)blocked.add(fact.field);seen.set(fact.field,fact.value);
 }
 for(const [key,value] of seen){if(!blocked.has(key))Object.assign(input,{[key]:value})}
 return input;
}
