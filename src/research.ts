import { combineAssessment, type CombinedAssessment } from './assessment';
import type { Prospect } from './data';
import {nordicCountries} from './data';
import {liveInvestigation} from './liveResearch';

export type Verification = 'Verified' | 'Partially verified' | 'Conflicting' | 'Insufficient evidence';
export type Source = { id: string; title: string; publisher: string; date: string; excerpt: string; independent: boolean; url?:string; mode?:'live'; note?:string; stance?:string };
export type Evidence = { id: string; signal: string; interpretation: string; status: Verification; strength: 'Strong' | 'Limited' | 'Mixed'; impact: number; sources: Source[] };
export type ScoreFactor = { label: string; points: number; maximum: number; reason: string; evidenceIds: string[] };
export type Investigation = { combined?:CombinedAssessment; draftAllowed:boolean; model: string; regionalReason: string; evidence: Evidence[]; factors: ScoreFactor[]; score: number | null; confidence: Prospect['confidence']; contact: boolean; transaction: string; transactionReason: string; nextStep: string; outreachFact: string };

// Live reports use the evidence adapter; this retained branch is demo-only.
// Dates, excerpts and publishers below are fictional, never merged into live reports.
export function investigate(p: Prospect): Investigation {
 if(p.publicResearch?.status==='live')return combineAssessment(p,liveInvestigation(p,p.publicResearch.report));
 const nordic=nordicCountries.includes(p.country);
 const model=nordic?'Nordics · structured-data model':'Germany / Europe · public-signal model';
 const regionalReason=nordic?'Registry ownership and filed financials carry more weight. Public context shapes the introduction; it does not substitute for owner intent.':'Leadership disclosures and public business activity carry more weight. Independent cross-checks matter more where structured ownership and financial coverage is limited.';
 const source=(id:string,title:string,publisher:string,excerpt:string,independent=false,date='2026-09-12'):Source=>({id,title,publisher,excerpt,independent,date});
 const weak=p.id>=8;
 const moderate=[5,6,7].includes(p.id);
 const primary=source('s1',nordic?'Annual report · strategic review':'Company business announcement',`${p.name} · company website`,weak?'No current leadership or ownership disclosure was found in the fixture.':p.id===1?'An external CEO took office in March 2026. Thomas Schneider remains chairman.':p.signal,false,'2026-03-18');
 const independent=source('s2','Independent industry report','European Industry Review · demo publication',p.id===1?'The new CEO now leads day-to-day operations; Schneider has moved to a non-executive chair role.':p.signal,true,'2026-04-09');
 const context=source('s3',nordic?'Ownership register & annual financial statements':'Company background & operating update',nordic?'Registry & filed report fixture':`${p.name} · company report`,p.id===1?'Founded in 1998. Schneider is now non-executive chairman; operating performance remained stable through the handover.':`${p.second}. Reported revenue: ${p.revenue}.`,false,'2026-06-30');
 const contextCheck=source('s4','Business context cross-check',nordic?'Independent auditor fixture':'Manufacturing Journal · demo publication',p.id===1?'Independent coverage confirms a 1998 founding, stable operations and Schneider’s move to a non-executive chair role.':`${p.second}. Independent review corroborates the operating and ownership context and reported revenue of ${p.revenue}.`,true,'2026-07-14');
 const counter=source('s5','Owner interview','Business Owners Review · demo publication',p.id===1?'“We intend to remain independent. I remain committed to the company as chairman.”':p.id===2?'“Our expansion is funded for the coming year; we have not started a capital process.”':moderate?'“I remain actively involved in operations; no change in ownership is planned.”':'“We are investing for the long term; no sale process is underway.”',true,'2026-09-20');
 const evidence:Evidence[]=weak?[{id:'e1',signal:'No corroborated transition signal',interpretation:'A company name or website alone establishes neither a transition nor a reason to approach its owner.',status:'Insufficient evidence',strength:'Limited',impact:0,sources:[primary]}]:[
  {id:'e1',signal:p.signal,interpretation:p.id===1?'A leadership handover can create space for a succession conversation. It does not demonstrate sale intent.':nordic?'Structured records support a discussion of business development; ownership concentration alone is not a sale trigger.':'This operating change may create a relevant conversation, but requires independent corroboration.',status:moderate?'Partially verified':'Verified',strength:moderate?'Limited':'Strong',impact:moderate?6:p.id===1?22:18,sources:moderate?[primary]:[primary,independent]},
  {id:'e2',signal:p.second,interpretation:p.id===1?'Reduced operational involvement supports succession or partial liquidity, while continued chairmanship argues against assuming a full exit.':'The owner’s operating context helps shape a transaction hypothesis. It is not proof that capital or liquidity is wanted.',status:moderate?'Partially verified':'Verified',strength:moderate?'Limited':'Strong',impact:moderate?4:p.id===1?18:13,sources:moderate?[context]:[context,contextCheck]},
  {id:'e3',signal:p.id===1?'28-year founder tenure; stable operating context':nordic?'Ownership and financial context available':'Business continuity and investment context',interpretation:'Business maturity and capacity inform fit. They do not independently justify outreach or imply financial pressure.',status:moderate?'Partially verified':'Verified',strength:moderate?'Limited':'Strong',impact:moderate?3:8,sources:moderate?[context]:[context,contextCheck]},
  {id:'e4',signal:p.id===1?'A near-term full exit is not supported':p.id===2?'No immediate funding need disclosed':'A transition remains uncertain',interpretation:p.id===1?'The owner’s stated commitment to independence contradicts a full-exit assumption. Lower priority; lead with continuity and optionality.':p.id===2?'Existing funding weakens the urgency of a capital approach. A strategic partnership is more plausible than a financing pitch.':'The owner’s ongoing involvement conflicts with a near-term transaction hypothesis. Corroborate the situation before contact.',status:'Conflicting',strength:'Mixed',impact:moderate?-20:p.id===2?-6:-12,sources:[primary,counter]},
 ];
 const maxima=nordic?[15,12,8,20,20,12,13]:[10,22,18,10,10,15,15];
 const values=weak?[0,0,0,0,0,0,0,0]:moderate?[5,6,4,3,5,5,0,-20]:p.id===3?[6,0,0,9,10,12,14,-12]:p.id===4?[13,0,0,18,20,11,12,-6]:nordic?[15,0,0,20,20,12,13,-6]:[8,22,18,8,6,12,14,-12];
 const labels=['Ownership / founder tenure','Leadership transition','Operational step-back','Financial / company context','Growth or liquidity indicators','Evidence quality','Independent corroboration','Contradictory evidence / uncertainty'];
 const reasons=weak?labels.map(()=> 'No supporting evidence; no contribution.'):[
  'Ownership and tenure provide context, never an age-based assumption about selling.',
  values[1]===0?'No leadership transition observed; no contribution.':moderate?'Leadership disclosure has no independent confirmation.':'External CEO appointment confirmed by independent reporting.',
  p.id===1?'Operational handover corroborated; chairmanship continues.':'Limited support for an operational step-back; no automatic exit inference.',
  nordic?'Filed financial and ownership records provide structured context.':'Public operating reports provide limited company context.',
  'Business development supports optionality; owner liquidity needs are not confirmed.',
  moderate?'Single-origin, incomplete evidence lowers reliability.':'Dated, attributable records; mock quality assessment, not a calibrated probability.',
  moderate?'No independent confirmation of the principal transition claims.':'Independent publishers confirm the material observations; repeated company releases do not count.',
  evidence[evidence.length-1].interpretation,
 ];
 const legacyFactors=labels.map((label,i)=>({label,points:values[i],maximum:maxima[i]??0,reason:reasons[i],evidenceIds:weak?['e1']:i===7?['e4']:i>=5?['e1','e2','e3']:i===3?['e3']:i===0?[p.id===1?'e3':'e2']:i===2?['e2']:i===4?[p.id===1?'e2':'e1']:['e1']}));
 // Ownership/financial features belong to Java. Do not count them again as public points.
 const publicFactors=legacyFactors.filter((_,i)=>i!==0&&i!==3);
 const publicCap=publicFactors.reduce((sum,f)=>sum+f.maximum,0);
 const factors=publicFactors.map(f=>f.maximum?{...f,points:f.points*100/publicCap,maximum:f.maximum*100/publicCap}:f);
 evidence.forEach(e=>{e.impact=factors.filter(f=>f.evidenceIds.length===1&&f.evidenceIds[0]===e.id).reduce((sum,f)=>sum+f.points,0)});
 const score=weak?null:Math.max(0,Math.min(100,factors.reduce((sum,f)=>sum+f.points,0)));
 const confidence=weak?'Low':moderate?'Moderate':'High';
 const contact=score!==null&&score>=70&&confidence==='High'&&evidence.slice(0,2).every(e=>e.status==='Verified'&&e.sources.some(s=>s.independent));
 const transaction=weak?'Not established':p.id===1?'Succession / partial liquidity':p.type;
 const transactionReason=weak?'Insufficient evidence to propose a transaction conversation.':p.id===1?'Verified operational handover plus continued chairmanship supports succession or partial liquidity. The independence statement makes a full-exit approach inappropriate.':p.id===2?'Ownership continuity and expansion plans support a strategic-partner conversation. Existing funding reduces the case for immediate growth capital.':`${p.type} is a provisional conversation hypothesis based on the operating signals, not a statement of owner intent.${moderate?' The conflicting owner statement means outreach should wait.':''}`;
 return combineAssessment(p,{draftAllowed:contact,model,regionalReason,evidence,factors,score,confidence,contact,transaction,transactionReason,nextStep:contact?'Advisor review → a confidential, exploratory introduction.':confidence==='High'?'Do not contact yet. The operating activity is verified, but the transaction trigger is not strong enough. Monitor for a clearer ownership or capital event.':'Do not contact yet. Obtain independent confirmation of the transition and resolve the contradictory or missing evidence.',outreachFact:weak||moderate?'':p.id===1?'the appointment of an external CEO and your move to a non-executive chair role':p.signal.toLowerCase()});
}

export function assessedProspect(p: Prospect): Prospect {
 const r=investigate(p);
 return {...p,score:r.score,confidence:r.confidence,type:r.transaction,sources:new Set(r.evidence.flatMap(e=>e.sources.map(s=>s.id))).size};
}

export function researchedMessage(p:Prospect,tone='Considered') {
 const r=investigate(p);
 if(!r.draftAllowed)return 'Do not contact yet. Independent evidence is needed before preparing an introduction.';
 if(p.publicResearch?.status==='live')return `Hello,\n\nI read the public reporting that ${r.outreachFact}\n\nAt Mergero, we work with owners considering ${r.transaction.toLowerCase()}. That may or may not be relevant to your plans. We would start by understanding your priorities for ${p.name} and the role you would like to retain.\n\nIf useful, would you be open to a brief, confidential conversation? There is no assumption that you are looking to sell or seeking investment.\n\nBest regards,\nAlexander Keller\nMergero`;
 return `Dear ${p.owner.split(' ')[0]},\n\nI noticed ${r.outreachFact}. ${p.id===1?'The continuity of your involvement as chairman stood out.':`It looks like an important chapter for ${p.name}.`}\n\nAt Mergero, we work with owners exploring ${r.transaction.toLowerCase()}, while preserving the business they have built. ${p.id===1?'Given your commitment to independence, any discussion would start with your priorities and the role you want to retain.':p.id===2?'With your expansion already funded, the conversation would focus on what a strategic partner could add beyond capital.':'Any conversation would start with your priorities and long-term plans.'}\n\n${tone==='Concise'?'Would a brief, confidential conversation be useful?':'If exploring these options is relevant, now or further down the line, I would welcome a brief, confidential conversation. There is no assumption that you are looking to sell.'}\n\nBest regards,\nAlexander Keller\nMergero`;
}
