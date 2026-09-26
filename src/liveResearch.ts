import type {Prospect} from './data';
import {nordicCountries} from './data';
import type {Evidence,Investigation,ScoreFactor,Source,Verification} from './research';
import type {ResearchReport} from './researchApi';

/** Evidence-only adapter. The existing fusion policy remains the only final scorer. */
export function liveInvestigation(p:Prospect,report:ResearchReport):Investigation{
 const evidence:Evidence[]=report.signal_evidence.map(claim=>{
  const citations=claim.citations;
  const supporters=citations.filter(c=>c.stance==='supports'&&c.published_at&&c.origin_group!=='unknown');
  const independent=new Set(supporters.map(c=>c.origin_group.toLowerCase())).size>=2&&new Set(supporters.map(c=>new URL(c.url).hostname.replace(/^www\./,''))).size>=2&&supporters.some(c=>c.independent&&c.independence_basis);
  const status:Verification=!claim.evidence_found?'Insufficient evidence':claim.verification_status==='conflicting'||claim.direction==='negative'?'Conflicting':claim.verification_status==='verified'&&report.verification_complete&&independent?'Verified':'Partially verified';
  const sources:Source[]=citations.map(c=>({id:c.url+'#'+c.stance,url:c.url,title:c.title,publisher:new URL(c.url).hostname,date:c.published_at||'Date unknown',excerpt:c.excerpt,independent:c.independent,mode:'live',note:c.independence_basis,stance:c.stance}));
  for(const url of claim.sources)if(!sources.some(s=>s.url===url))sources.push({id:url,url,title:'Retrieved public source',publisher:new URL(url).hostname,date:'Date unknown',excerpt:'Claim citation; no source excerpt available.',independent:false,mode:'live'});
  return {id:claim.signal_id,signal:claim.signal_name,interpretation:[claim.evidence_found,claim.verification_note,'An operating signal does not establish willingness to transact.'].filter(Boolean).join(' '),status,strength:status==='Verified'?'Strong':status==='Conflicting'?'Mixed':'Limited',impact:0,sources};
 });
 const eligible=(kinds:string[])=>evidence.filter((e,i)=>kinds.includes(report.signal_evidence[i].kind)&&report.signal_evidence[i].direction==='positive'&&e.status!=='Conflicting'&&e.status!=='Insufficient evidence');
 const factor=(label:string,kinds:string[]):ScoreFactor=>{
  const matches=eligible(kinds);const strongest=matches.find(e=>e.status==='Verified')??matches[0];
  const points=strongest?(strongest.status==='Verified'?20:5):0;
  if(strongest)strongest.impact+=points;
  return {label,points,maximum:20,reason:strongest?strongest.interpretation:'No supported public timing signal in this category.',evidenceIds:strongest?[strongest.id]:[]};
 };
 const factors=[factor('Leadership transition',['leadership']),factor('Operational step-back',['operational']),factor('Transaction / capital timing',['growth','liquidity','partnership','explicit_exit'])];
 const material=eligible(['leadership','operational','growth','liquidity','partnership','explicit_exit']);
 const verified=material.filter(e=>e.status==='Verified');
 const quality=material.length?20*verified.length/material.length:0;
 factors.push({label:'Evidence quality',points:quality,maximum:20,reason:'Dated claims confirmed in a separate search, divided by supported material claims. Structured numeric context adds no public points.',evidenceIds:material.map(e=>e.id)});
 factors.push({label:'Independent corroboration',points:Math.min(20,verified.length*10),maximum:20,reason:'10 points per independently corroborated material claim, capped at 20. Shared press-release origins count once.',evidenceIds:verified.map(e=>e.id)});
 const conflicts=evidence.filter(e=>e.status==='Conflicting');
 conflicts.forEach((e,i)=>e.impact=i<2?-20:0);
 factors.push({label:'Contradictory evidence / uncertainty',points:-Math.min(40,conflicts.length*20),maximum:0,reason:conflicts.length?'Counter-evidence reduces priority after blending; resolve the conflict before contact.':'No retrieved contradiction. Absence of a contradiction is not proof of intent.',evidenceIds:conflicts.map(e=>e.id)});
 const best=report.signal_evidence.find(c=>verified.some(e=>e.id===c.signal_id)&&c.kind!=='explicit_exit')??report.signal_evidence.find(c=>verified.some(e=>e.id===c.signal_id));
 const conversations:Record<string,string>={leadership:'Succession',operational:'Succession / partial liquidity',growth:'Growth capital',liquidity:'Partial liquidity / minority investment',partnership:'Strategic partner',explicit_exit:'Full exit'};
 const transaction=best?conversations[best.kind]||'Not established':'Not established';
 const nordic=nordicCountries.includes(p.country);
 return {draftAllowed:false,contact:false,model:nordic?'Nordics · structured-data model':'Germany / Europe · public-signal model',regionalReason:nordic?'Structured registry and financial data receive more weight; public evidence validates timing.':'Public professional evidence receives more weight; sparse structured fields reduce the Java contribution.',evidence,factors,score:material.length?Math.max(0,factors.reduce((n,f)=>n+f.points,0)):null,confidence:verified.length>=2&&report.verification_complete?'High':material.length?'Moderate':'Low',transaction,transactionReason:best?`Conversation hypothesis: ${best.evidence_found}. ${conflicts.length?'Counter-evidence limits urgency and must be resolved. ':''}This establishes a possible topic, not owner intent.`:'No independently corroborated timing signal supports a transaction conversation.',outreachFact:best?.evidence_found||'',nextStep:'Do not contact yet. Review source evidence and missing information.'};
}
