import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,Search} from 'lucide-react';
import {prospects as fixtures,type Prospect} from './data';
import {companyInput,scoreCompany,type CompanyInput} from './modelApi';
import {researchCompany,discoverCompanies,sourcedInputs,type Candidate} from './researchApi';
import {assessedProspect,investigate} from './research';
import {StructuredInputs} from './StructuredModel';

export function DiscoverResearch({prospects,onComplete}:{prospects:Prospect[];onComplete:(p:Prospect)=>void}){
 const [input,setInput]=useState(''),[country,setCountry]=useState('Germany'),[website,setWebsite]=useState('');
 const [criteria,setCriteria]=useState('Private industrial companies with a publicly reported leadership transition');
 const [candidates,setCandidates]=useState<Candidate[]>([]),[discoveryBusy,setDiscoveryBusy]=useState(false),[error,setError]=useState('');
 const [target,setTarget]=useState<Prospect|null>(null),[stage,setStage]=useState(-1),[mode,setMode]=useState('live');
 const [inputs,setInputs]=useState<CompanyInput>({id:'new',year:new Date().getFullYear()+1,sector:'Not established'});
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 useEffect(()=>{setInputs({id:'new',year:new Date().getFullYear()+1,sector:'Not established'})},[input]);
 const r=target?investigate(target):null;
 const sources=r?Array.from(new Map(r.evidence.flatMap(e=>e.sources).map(s=>[s.id,s])).values()):[];
 async function discover(){
  setDiscoveryBusy(true);setError('');setCandidates([]);controller.current?.abort();const abort=new AbortController();controller.current=abort;
  try{const found=await discoverCompanies(country,criteria,abort.signal);if(!abort.signal.aborted){setCandidates(found);if(!found.length)setError('No grounded candidates found. Refine the criteria or enter a company.')}}
  catch{if(!abort.signal.aborted)setError('Discovery backend unavailable. Enter a company or explicitly choose a demo example below.')}
  finally{if(!abort.signal.aborted)setDiscoveryBusy(false)}
 }
 async function start(){
  const query=input.trim();if(!query)return;
  const existing=prospects.find(p=>p.name.toLowerCase()===query.toLowerCase());
  const fixture=fixtures.find(p=>p.name.toLowerCase()===query.toLowerCase());
  const empty:Prospect={id:existing?.id??Date.now(),name:query,initials:query.slice(0,2).toUpperCase(),owner:'Not established',country,website:website||undefined,flag:'',sector:'Not established',employees:0,revenue:'—',score:null,type:'Not established',signal:'No corroborated transition signals',second:'More research needed',confidence:'Low',sources:0,color:'gray',angle:'Hold outreach until evidence improves'};
  setStage(0);setTarget(null);setError('');controller.current?.abort();const abort=new AbortController();controller.current=abort;
  const publicResearch=mode==='demo'?{status:'unavailable' as const,error:'Demo fixtures selected explicitly. No live research requested.'}:await researchCompany(query,country,website,abort.signal);
  if(abort.signal.aborted)return;
  let p:Prospect;
  let modelInput:CompanyInput;
  let provenance:'demo-fixture'|'public-sourced'|'user-supplied';
  if(publicResearch.status==='live'){
   p={...empty,publicResearch,website:publicResearch.report.website||undefined};
   modelInput={...sourcedInputs(p,publicResearch.report,inputs.year),...inputs,id:String(p.id)};
   provenance=Object.keys(inputs).some(k=>!['id','year','sector'].includes(k))?'user-supplied':'public-sourced';
   p.employees=modelInput.employees??0;p.revenue=modelInput.revenueK!=null?`€${(modelInput.revenueK/1000).toFixed(2)}m`:'—';
   p.signal=publicResearch.report.signal_evidence.find(e=>e.evidence_found)?.signal_name||'No supported public signals';
  }else if(existing?.publicResearch?.status==='live'&&mode==='live'){
   p={...existing,publicResearch:{status:'live',report:{...existing.publicResearch.report,warnings:[...existing.publicResearch.report.warnings,'Research backend unavailable; retaining the previous dated report.']}}};modelInput=companyInput(p);provenance=p.structured?.inputProvenance??'public-sourced';
  }else{
   p={...(fixture??empty),publicResearch};
   modelInput={...companyInput(p),...inputs,id:String(p.id)};provenance=fixture?'demo-fixture':'user-supplied';
  }
  setTarget(assessedProspect(p));setStage(1);
  const structured=await scoreCompany(modelInput,abort.signal,provenance);
  if(abort.signal.aborted)return;
  setTarget(assessedProspect({...p,structured}));setStage(2);
 }
 return <><div className="eyebrow">FROM PUBLIC SIGNAL TO PRIVATE CONVERSATION</div><h2 id="modal-title">Investigate a company.</h2><p className="muted-copy">Research public sources, cross-check claims, then score only available structured facts. Regional frameworks are cached; selecting a row does not trigger paid research.</p>
 {stage<0?<>
  <label className="form-field">Market<select value={country} onChange={e=>setCountry(e.target.value)}>{Array.from(new Set(['Germany','Sweden','Finland','Denmark','Norway','Iceland','France','Netherlands',country])).map(c=><option key={c}>{c}</option>)}</select></label>
  <details className="structured-editor"><summary>Discover a few companies by criteria</summary><label className="form-field">Discovery criteria<input value={criteria} maxLength={2000} onChange={e=>setCriteria(e.target.value)}/></label><button className="secondary" disabled={discoveryBusy||criteria.trim().length<3} onClick={discover}>{discoveryBusy?'Finding sourced candidates…':'Find candidate companies'}</button><div className="example-choices">{candidates.map(c=><button key={c.name} onClick={()=>{setInput(c.name);setWebsite(c.website||'');setMode('live');if(c.country)setCountry(c.country)}}><span>{c.name}</span><small>{c.country} · {new URL(c.source).hostname} · candidate, not a verified lead</small></button>)}</div></details>
  {error&&<p role="status" className="demo-evidence">{error}</p>}
  <label className="form-field">Company name<input autoFocus maxLength={200} value={input} onChange={e=>{setInput(e.target.value);setWebsite('');setMode('live')}} placeholder="Enter a company to investigate"/></label>
  <label className="form-field">Company website (optional)<input value={website} maxLength={500} onChange={e=>setWebsite(e.target.value)} placeholder="https://company.example"/></label>
  <label className="form-field">Research mode<select value={mode} onChange={e=>setMode(e.target.value)}><option value="live">Live public research (uses backend)</option><option value="demo">Demo fixtures (no public research call)</option></select></label>
  <div className="example-choices"><span>Or choose a prepared demo investigation</span>{[1,2,8].map(id=>{const p=fixtures.find(x=>x.id===id)!;return <button key={id} className={input===p.name?'selected':''} onClick={()=>{setInput(p.name);setCountry(p.country);setWebsite('');setMode('demo')}}><span>{p.name}</span><small>Demo fixture · {id===1?'Handover + contradictory intent':id===2?'Nordic expansion context':'Weak evidence · do not contact'}</small></button>})}</div>
  <details className="structured-editor"><summary>Optional known structured inputs</summary><p className="muted-copy">Live research supplies only sourced, dated values. Your explicit inputs override those values; blanks remain unknown. Demo facts are never merged into live research.</p><StructuredInputs value={inputs} onChange={setInputs}/></details>
  <button className="primary full-width" disabled={!input.trim()||discoveryBusy} onClick={start}><Search size={15}/> Research company</button>
 </>:<><div className="research-target"><strong>{target?.name||input}</strong><span>{r?.model||`${country} · ${mode==='demo'?'demo fixture':'public-source research'}`}</span></div>
  <ol className="research-stages" aria-live="polite">{['Research company using cached regional framework + cross-check public claims','Score available structured facts with Java','Combined investigation complete'].map((s,i)=><li key={s} className={stage===i?'current':stage>i?'complete':''}><span>{stage>i?<Check size={12}/>:i+1}</span>{s}</li>)}</ol>
  <div className="research-results" aria-live="polite"><h3>{target?'Evidence trail':'Researching sources — this may take a few minutes'}</h3>
   {target&&<p className="demo-evidence">{target.publicResearch?.status==='live'?`Live public evidence · ${target.publicResearch.report.cache_hit?'cached report':'new research'} · ${target.publicResearch.report.verification_method}`:`Public API unavailable / demo fixture. ${target.publicResearch?.status==='unavailable'?target.publicResearch.error:''}`}</p>}
   {sources.map(s=><div className="research-source" key={s.id}><Search size={13}/><div><strong>{s.publisher}</strong><small>{s.title} · {s.date}</small></div></div>)}
   {target&&<div className="research-findings">{r?.evidence.map(e=><p key={e.id}><span className={`evidence-status status-${e.status.split(' ')[0].toLowerCase()}`}>{e.status}</span>{e.signal}</p>)}</div>}
   {stage===2&&<><p className="model-status">{target?.structured?.status==='ready'?`Java: ${target.structured.result.metadata.modelUsed} · ${target.structured.result.suppliedFields.length}/11 observed fields · ${target.structured.result.metadata.syntheticTraining?'synthetic training':'CSV training'}`:'Java API unavailable · no structured score substituted'}</p><div className="research-outcome"><strong>{r?.draftAllowed?`${r.score}/100 · Review-only draft`:'Do not contact yet'}</strong><p>{r?.nextStep}</p></div></>}
  </div>{stage===2?<button className="primary full-width" onClick={()=>target&&onComplete(target)}>Open investigation <ArrowRight size={15}/></button>:<p className="research-wait" role="status">Research in progress…</p>}
 </>}</>;
}
