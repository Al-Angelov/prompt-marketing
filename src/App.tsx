import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Globe2, Layers3, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { companyWebsite, marketRequest, quickSearchRequest, safeUrl, type MarketJob, type Opportunity, type Source } from './marketApi';
import { SignalsPage } from './ResearchViews';
import { buildContactPlan } from './contactPlan';
import { MnaAssessment, hasRecordedFinding } from './MnaAssessment';
import { LibraryPage } from './LibraryPage';
import { companyKey, loadReports, mergeReports, saveReports } from './reportLibrary';
import { Sidebar, WorkspaceHeader, type WorkspaceView } from './WorkspaceChrome';

const countries = ['Finland', 'Sweden', 'Germany', 'Denmark', 'Norway', 'Iceland', 'France', 'Netherlands', 'Austria', 'Belgium', 'United Kingdom', 'Switzerland', 'Spain', 'Italy'];
const industries = ['Industrial manufacturing', 'Software', 'Healthcare', 'Business services', 'Energy', 'Electronics'];
const stages = ['Understanding the market', 'Finding relevant companies', 'Checking public signals', 'Cross-checking evidence', 'Running structured analysis', 'Ranking opportunities'];

function Selection({ label, options, value, onConfirm }: { label: string; options: string[]; value: string; onConfirm: (v: string) => void }) {
  const [query, setQuery] = useState(value), [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const matches = options.filter(o => o.toLowerCase().includes(query.toLowerCase()));
  if (query.trim().length >= 2 && !options.some(o => o.toLowerCase() === query.trim().toLowerCase())) matches.push(query.trim());
  const choose = (v: string) => { setQuery(v); setOpen(false); onConfirm(v) };
  const id = label.toLowerCase();
  return <div className="selection"><label htmlFor={id}>{label}</label><div className="input-wrap">
    <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={open && matches[active] ? `${id}-${active}` : undefined}
      value={query} placeholder={`Select ${label}`} autoComplete="off" maxLength={label === 'Country' ? 100 : 200}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0); if (value) onConfirm('') }}
      onKeyDown={e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive(i => Math.max(0, Math.min(matches.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))) }
        if (e.key === 'Enter' && open && matches[active]) { e.preventDefault(); choose(matches[active]) }
        if (e.key === 'Escape') setOpen(false);
      }} /><ChevronDown size={18} /></div>
    {open && <ul id={`${id}-options`} role="listbox" aria-label={label}>{matches.map((option, i) => <li key={option} id={`${id}-${i}`} role="option" aria-selected={active === i} onMouseDown={e => e.preventDefault()} onClick={() => choose(option)}>{option}{value === option && <Check size={15} />}</li>)}</ul>}
  </div>;
}
function Sources({ sources }: { sources: Source[] }) {
  return <ul className="sources">{sources.map((s, i) => <li key={`${s.url}-${i}`}><a href={safeUrl(s.url)} target="_blank" rel="noreferrer">{s.title || 'Public source'} <ArrowUpRight size={12} /></a><span>{s.published_at || 'Date unavailable'}{s.independent ? ' · Independent source' : ''}</span>{s.excerpt && <q>{s.excerpt}</q>}</li>)}</ul>;
}
function Company({ company: p, index }: { company: Opportunity; index: number }) {
  const [copied, setCopied] = useState(false), [copyError, setCopyError] = useState(false);
  const website = companyWebsite(p);
  const contactPlan = buildContactPlan(p);
  const outreachDraft = contactPlan.draft;
  const groups = [['Strongest verified signals', 'Verified'], ['Contradictory evidence', 'Conflicting'], ['Evidence still to verify', 'other']];
  const recordedEvidence = p.evidence.filter(hasRecordedFinding);
  const missingEvidence = p.evidence.filter(e => !hasRecordedFinding(e));
  const registryOnly = p.provenance === 'Official registry screen';
  const b = p.report.score_breakdown;
  const parts: [string, number | undefined][] = [['Company data', b.model_contribution], ['Sector context', b.sector_contribution], ['Official records', b.registry_contribution], ['Public evidence', b.public_contribution], ['Contradictions', b.contradiction_penalty]];
  return <details className="company"><summary><div className="company-top"><span className="ordinal">{String(index + 1).padStart(2, '0')}</span><div className="company-name"><h2>{p.company}</h2><span className={`provenance ${registryOnly ? 'provenance-registry' : 'provenance-deep'}`}>{registryOnly ? 'Registry screen' : 'Deep research'}</span></div><div className="priority"><small>Priority Score</small><strong>{p.priority ?? '—'}{p.priority !== null && <span> / 100</span>}</strong>{typeof p.relative_likelihood === 'number' && <small className="relative-likelihood">{p.relative_likelihood.toFixed(1)}× typical odds</small>}</div><ChevronDown className="expand-icon" size={18} /></div>
    <dl className="overview"><div><dt>Why now</dt><dd>{p.why_now}</dd></div><div><dt>Confidence</dt><dd><span className={`confidence confidence-${p.confidence.toLowerCase()}`}>{p.confidence}</span></dd></div></dl><span className="report-label">Company report <ArrowRight size={14} /></span></summary>
    <div className="company-website-row">{website ? <a className="company-website" href={website} target="_blank" rel="noopener noreferrer"><Globe2 size={16} /><span>Visit company website<small>{new URL(website).hostname.replace(/^www\./, '')}</small></span><ArrowUpRight size={18} /></a> : <span className="website-unavailable"><Globe2 size={15} /> Company website not available</span>}</div>
    <div className="investigation"><div className="section-heading"><h3>Company report</h3><button onClick={() => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(p.report, null, 2)], {type: 'application/json'}));
      const link = document.createElement('a'); link.href = url; link.download = `${p.report.report_id}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>Download JSON</button></div><p className="recommendation">{contactPlan.readiness === 'review' ? 'Suitable for a considered approach.' : registryOnly ? 'Registry screen only: news and leadership events have not been researched yet. Do not contact on this basis.' : 'Do not contact yet. Review the evidence and resolve the gaps first.'}</p>
      <MnaAssessment company={p} />
      {p.structured.facts.length > 0 && <section className="company-facts"><h3>Recorded company facts</h3><p className="muted">Observed company data. These facts provide business context; they do not establish sale intent.</p><dl>{p.structured.facts.map((f, i) => <div key={i}><dt>{f.field.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ')}</dt><dd>{typeof f.value === 'boolean' ? f.value ? 'Yes' : 'No' : f.value.toLocaleString()}<small>As of {f.as_of}</small><span>{f.sources.filter(url => safeUrl(url)).map((url, j) => <a key={url} href={safeUrl(url)} target="_blank" rel="noopener noreferrer">Source {j + 1} <ArrowUpRight size={12} /></a>)}</span></dd></div>)}</dl></section>}
      {groups.map(([title, status]) => { const items = recordedEvidence.filter(e => status === 'other' ? !['Verified', 'Conflicting'].includes(e.status) : e.status === status); return <section key={title}><h3>{title}</h3>{items.length ? items.map(e => <article className="evidence" key={e.id}><div className="evidence-title"><h4>{e.signal}</h4><small>{e.status}</small></div>{e.fact && <p>{e.fact}</p>}<p className="muted">{e.explanation}</p><Sources sources={e.sources} /></article>) : <p className="muted">{status === 'Conflicting' ? 'No contradictory evidence was identified in the sources checked. This is not confirmation of an interest in selling.' : status === 'Verified' ? 'Verified transaction signals have not yet been established. Review the recorded company facts and open research questions.' : 'No additional sourced findings awaiting verification.'}</p>}</section> })}
      {(p.data_gaps.length > 0 || missingEvidence.length > 0) && <details className="research-gaps"><summary>Open research questions <span>{new Set([...missingEvidence.map(e => e.signal), ...p.data_gaps]).size}</span></summary><p>These points were not established by the research. They are not negative findings about the company.</p><ul className="gaps">{[...new Set([...missingEvidence.map(e => e.signal), ...p.data_gaps])].map((gap, i) => <li key={i}>{gap}</li>)}</ul></details>}
      <section><h3>Company-data insight</h3><p>{p.structured.insight}</p>{p.structured.synthetic && <p className="muted">The current model uses synthetic training data. Its contribution is provisional and cannot support a contact recommendation.</p>}</section>
      <section><h3>Why this priority?</h3><p>{p.explanation}</p><dl className="score-breakdown">
        {typeof b.baseline === 'number' && <div><dt>Typical company</dt><dd>{b.baseline}</dd></div>}
        {parts.filter(([, v]) => typeof v === 'number' && Math.abs(v) >= 0.05).map(([label, v]) => <div key={label}><dt>{label}</dt><dd>{v! > 0 ? '+' : ''}{v!.toFixed(1)}</dd></div>)}
        <div><dt>Priority</dt><dd>{p.priority ?? '—'}</dd></div>
      </dl><ul className="factors">{[...b.factors].sort((x, y) => Math.abs(y.points) - Math.abs(x.points)).map((f, i) => <li key={i}><span className={f.points >= 0 ? 'factor-up' : 'factor-down'}>{f.points >= 0 ? '+' : ''}{f.points.toFixed(1)}</span> <strong>{f.label}</strong>{f.detail ? ` · ${f.detail}` : ''}{f.source && safeUrl(f.source) && <> <a href={safeUrl(f.source)} target="_blank" rel="noreferrer">source <ArrowUpRight size={11} /></a></>}</li>)}</ul>
      {typeof b.likelihood === 'number' && typeof b.market_base_rate === 'number' && <p className="muted">Indicative 12-month sale likelihood {(b.likelihood * 100).toFixed(1)}% vs. {(b.market_base_rate * 100).toFixed(1)}% for a typical company. Provisional, literature-informed weights; not a calibrated probability.</p>}
      <p className="muted">{p.report.structured_model.label}{p.report.structured_model.percentile !== null ? ` · Reference percentile: ${p.report.structured_model.percentile.toFixed(1)} / 100` : ''}</p><p className="muted">A research priority is not a probability that the owner wants to sell. Missing information counts as average and reduces confidence.</p></section>
      <section><h3>Recommended conversation</h3><p>{p.angle}</p></section>
      <section><div className="section-heading"><h3>Suggested outreach</h3>{outreachDraft && <button onClick={async () => { try { await navigator.clipboard.writeText(outreachDraft!); setCopied(true); setCopyError(false) } catch { setCopyError(true) } }}>{copied ? 'Copied' : 'Copy message'}</button>}</div>{outreachDraft ? <><p className="muted">Review draft · {p.contact ? 'Confirm the context before sending.' : 'Hold until the outstanding evidence has been reviewed.'}</p><p className="outreach">{outreachDraft}</p>{copyError && <p role="status">Select the message to copy it manually.</p>}</> : <p className="muted">There is not enough verified evidence for a responsible approach yet.</p>}</section>
      {p.warnings.length > 0 && <p className="muted">{p.warnings.join(' ')}</p>}
    </div></details>;
}
export default function App() {
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 1000), [view, setView] = useState<WorkspaceView>('engine');
  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 999px)');
    const adapt = () => { if (narrow.matches) setCollapsed(true) };
    narrow.addEventListener('change', adapt);
    return () => narrow.removeEventListener('change', adapt);
  }, []);
  const [library, setLibrary] = useState<Opportunity[]>([]), [libraryReady, setLibraryReady] = useState(false), [storageError, setStorageError] = useState(false);
  const [pendingSaves, setPendingSaves] = useState(0);
  useEffect(() => {
    let active = true;
    loadReports().then(saved => { if (active) setLibrary(current => mergeReports(current, saved)) }).catch(() => { if (active) setStorageError(true) }).finally(() => { if (active) setLibraryReady(true) });
    return () => { active = false };
  }, []);
  function remember(reports: Opportunity[]) {
    if (!reports.length) return;
    setLibrary(current => mergeReports(current, reports));
    void navigator.storage?.persist?.().catch(() => false);
    setPendingSaves(count => count + 1);
    void saveReports(reports).then(() => setStorageError(false)).catch(() => setStorageError(true)).finally(() => setPendingSaves(count => count - 1));
  }
  const [country, setCountry] = useState(''), [industry, setIndustry] = useState('');
  const [phase, setPhase] = useState<'select' | 'research' | 'results' | 'error'>('select'), [job, setJob] = useState<MarketJob | null>(null), [error, setError] = useState('');
  const [quick, setQuick] = useState<MarketJob | null>(null), [deepError, setDeepError] = useState('');
  const [savedReplay, setSavedReplay] = useState<Opportunity[] | null>(null);
  const savedForMarket = (c: string, i: string) => library.filter(p => p.provenance !== 'Official registry screen'
    && p.country.trim().toLocaleLowerCase() === c.trim().toLocaleLowerCase()
    && p.industry.trim().toLocaleLowerCase() === i.trim().toLocaleLowerCase());
  const matchingSaved = savedForMarket(country, industry);
  const running = useRef(false), abort = useRef<AbortController | null>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { abort.current?.abort(); clearTimeout(timer.current) }, []);
  function begin(c: string, i: string, refresh = false) {
    if (running.current || !libraryReady || !c.trim() || !i.trim()) return;
    abort.current?.abort(); clearTimeout(timer.current);
    const saved = savedForMarket(c, i);
    if (!refresh && saved.length) {
      setSavedReplay(saved); setJob(null); setQuick(null); setError(''); setDeepError(''); setPhase('results');
      return;
    }
    const fallback = refresh ? savedReplay : null;
    if (!fallback) setSavedReplay(null);
    running.current = true; setPhase(fallback ? 'results' : 'research'); setJob(null); setQuick(null); setError(''); setDeepError('');
    const controller = new AbortController(); abort.current = controller; const deadline = Date.now() + 45 * 60 * 1000;
    const sameMarket = (r: MarketJob) => r.country.toLowerCase() === c.toLowerCase() && r.industry.toLowerCase() === i.toLowerCase();
    let screened = false, screenPending = true, deepFinished = false, deepFailure = '';
    function settleFailure(message: string) {
      running.current = false;
      if (screened || fallback?.length) { setDeepError(message); setPhase('results') }
      else { setError(message); setPhase('error') }
    }
    async function receive(id?: string) {
      try {
        if (Date.now() > deadline) throw new Error('This research is taking longer than expected. Please try again shortly.');
        const result = await marketRequest(id || { country: c, industry: i }, controller.signal);
        if (controller.signal.aborted) return;
        if (!sameMarket(result) || id && result.id !== id) throw new Error('We couldn’t match these results to your market. Please try again.');
        setJob(result);
        if (result.status === 'error') throw new Error('We couldn’t complete this research. Please try again later.');
        if (result.status === 'complete') { deepFinished = true; running.current = false; setSavedReplay(null); remember(result.results); setPhase('results') }
        else timer.current = setTimeout(() => receive(result.id), 1500);
      } catch (e) {
        if (controller.signal.aborted) return;
        deepFinished = true;
        deepFailure = e instanceof Error && !['TypeError', 'TimeoutError'].includes(e.name) ? e.message : 'Research is temporarily unavailable. Please try again later.';
        // Keep saved reports or a registry screen usable if deep research fails.
        if (screened || fallback?.length || !screenPending) settleFailure(deepFailure);
      }
    }
    // Neither path waits for the other: a slow registry must not delay research.
    void receive();
    void (async () => {
      try {
        const screen = await quickSearchRequest({ country: c, industry: i }, controller.signal);
        if (controller.signal.aborted || deepFinished && !deepFailure) return;
        if (screen && sameMarket(screen)) { screened = true; setQuick(screen); remember(screen.results); setPhase('results') }
      } catch { /* the registry screen is best effort */ }
      finally {
        screenPending = false;
        if (!controller.signal.aborted && deepFailure) settleFailure(deepFailure);
      }
    })();
  }
  function confirm(which: 'country' | 'industry', value: string) { if (which === 'country') setCountry(value); else setIndustry(value) }
  function reset() { abort.current?.abort(); clearTimeout(timer.current); running.current = false; setCountry(''); setIndustry(''); setJob(null); setQuick(null); setSavedReplay(null); setDeepError(''); setPhase('select') }
  // Deep-research reports replace the registry-screen entry for the same company.
  const deepResults = savedReplay || (job?.status === 'complete' ? job.results : []);
  const shown = (() => {
    const byCompany = new Map((quick?.results || []).map(p => [companyKey(p), p]));
    for (const p of deepResults) byCompany.set(companyKey(p), p);
    return [...byCompany.values()].sort((a, b) => (b.priority ?? -1) - (a.priority ?? -1) || a.company.localeCompare(b.company));
  })();
  const deepStage = job?.stages.findIndex(s => s !== 'complete') ?? 0;
  const researchInProgress = running.current && !deepError;
  const savedDates = savedReplay?.map(p => p.report.generated_at).sort((a, b) => Date.parse(a) - Date.parse(b)) || [];
  const savedDateLabel = savedDates.length ? [...new Set([savedDates[0], savedDates[savedDates.length - 1]].map(d => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })))].join(' – ') : '';
  function focusSearch() { setView('engine'); if (phase !== 'select') reset(); requestAnimationFrame(() => document.getElementById(phase === 'select' && country ? 'industry' : 'country')?.focus()) }
  function navigate(next: WorkspaceView) { setView(next); if (window.innerWidth < 1000) setCollapsed(true) }
  return <div className={`app-shell ${collapsed ? 'sidebar-is-collapsed' : ''}`}><Sidebar collapsed={collapsed} onToggle={() => setCollapsed(v => !v)} view={view} onNavigate={navigate} country={country} industry={industry} />{!collapsed && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setCollapsed(true)} />}<div className="workspace"><WorkspaceHeader view={view} onSearch={focusSearch} researching={researchInProgress} /><main>
    {view === 'signals' && <SignalsPage reports={library} onResearch={() => navigate('engine')} />}
    {view === 'buyers' && <LibraryPage reports={library} ready={libraryReady} saving={pendingSaves > 0} storageError={storageError} onResearch={() => navigate('engine')} renderCompany={(p, rank) => <Company company={p} index={rank} />} onImport={async reports => {
      try { await saveReports(reports) } catch { setStorageError(true); throw new Error('The backup could not be saved on this device. Your existing library is unchanged. Keep the backup and try again.') }
      setLibrary(current => mergeReports(current, reports)); setStorageError(false);
      void navigator.storage?.persist?.().catch(() => false);
    }} />}
    <div hidden={view !== 'engine'}>
    {phase === 'select' && <div className="landing"><div className="hero-art" aria-hidden="true"><div className="orbital orbital-one" /><div className="orbital orbital-two" /><div className="orbital orbital-three" /><span className="orbital-core" /></div><div className="hero-content"><p className="eyebrow"><span /> MERGERO INTELLIGENCE <span className="eyebrow-divider">/</span> MGX</p><h1>See the signal.<br /><span>Find the opportunity.</span></h1><p className="intro">The right company. The right moment.<br />Evidence-led origination for your next meaningful conversation.</p><div className="search-panel"><div className="search-panel-heading"><div><Search size={17} /><span>Where will you look next?</span></div><button className="icon-button search-focus" onClick={focusSearch} aria-label="Search your market" title="Search country or industry"><Search size={17} /></button></div><div className="selections"><Selection label="Country" options={countries} value={country} onConfirm={v => confirm('country', v)} /><Selection label="Industry" options={industries} value={industry} onConfirm={v => confirm('industry', v)} /></div><div className="search-actions"><p className="hint" aria-live="polite">{!libraryReady ? "Checking your saved research..." : matchingSaved.length ? `${matchingSaved.length} saved ${matchingSaved.length === 1 ? "company is" : "companies are"} ready to open instantly. Check for updates only when needed.` : "Choose a country and industry, then start your search."}</p><button className="search-submit" disabled={!libraryReady || !country || !industry} onClick={() => begin(country, industry)}>Search companies <ArrowRight size={16} /></button></div></div><div className="hero-proof"><span><Globe2 size={14} /> Local market context</span><span><ShieldCheck size={14} /> Evidence, cross-checked</span><span><Layers3 size={14} /> One focused report</span></div></div><div className="landing-bottom"><span>INDEPENDENT THINKING. INFORMED CONVERSATIONS.</span><span>Built for the long view <ArrowUpRight size={13} /></span></div></div>}
    {phase === 'research' && <div className="research" aria-live="polite" aria-busy="true"><div className="research-emblem"><Sparkles size={25} /></div><p className="eyebrow"><span /> A focused investigation</p><h1 tabIndex={-1}>Researching {country}</h1><p className="intro">{industry}</p><p className="muted">Careful research takes a few minutes. We’ll bring the strongest opportunities together here.</p><div className="progress-track" role="progressbar" aria-label="Research progress" aria-valuemin={0} aria-valuemax={6} aria-valuenow={job?.stages.filter(s => s === 'complete').length || 0}><span style={{ width: `${(job?.stages.filter(s => s === 'complete').length || 0) / 6 * 100}%` }} /></div><ol className="progress">{stages.map((s, i) => <li key={s} data-state={job?.stages[i] || (i === 0 ? 'running' : 'pending')}><span>{job?.stages[i] === 'complete' ? <Check size={14} /> : String(i + 1).padStart(2, '0')}</span>{s}<small>{job?.stages[i] === 'complete' ? 'Complete' : job?.stages[i] === 'running' ? 'In progress' : ''}</small></li>)}</ol></div>}
    {phase === 'error' && <div className="research" role="alert"><p className="eyebrow">{country} · {industry}</p><h1>Research is on hold.</h1><p className="intro">{error}</p><div className="error-actions"><button onClick={() => begin(country, industry)}>Try again</button><button onClick={reset}>Change market</button></div></div>}
    {phase === 'results' && (job || quick || savedReplay) && <div className="results"><div className="results-heading"><div><p className="eyebrow"><span /> Your opportunities</p><h1 tabIndex={-1}>{country}</h1><p className="intro">{industry}</p></div><button onClick={reset} disabled={researchInProgress} title={researchInProgress ? 'Deep research is still in progress' : undefined}>Change market <ArrowUpRight size={14} /></button></div>
      {savedReplay && <section className="saved-replay" aria-label="Saved research"><div><h2><Check size={16} /> Saved research</h2><p>Research dates: {savedDateLabel}. {researchInProgress ? 'Showing saved reports while checking for updates.' : deepError ? 'Your saved research remains available.' : 'Loaded from this device; no new research has run.'}</p><p className="muted">{deepError ? `Update unavailable: ${deepError}` : 'Review source dates before outreach. Checking for updates may reuse recent research.'}</p></div><button disabled={researchInProgress} onClick={() => begin(country, industry, true)}>{researchInProgress ? 'Checking for updates...' : 'Check for updates'} <ArrowRight size={14} /></button></section>}
      <div className="results-meta"><span>{quick ? `${String(quick.screened ?? quick.results.length).padStart(2, '0')} COMPANIES SCREENED FROM THE OFFICIAL REGISTER` : `${String(shown.length).padStart(2, '0')} COMPANIES RESEARCHED`}</span><span>RANKED BY PRIORITY</span></div>
      {quick && <div className="deep-status" aria-live="polite">{deepError ? <p className="muted">Deep research is unavailable right now ({deepError}) Registry scores remain valid; news and leadership events are not yet included.</p>
        : job?.status === 'complete' ? <p><Check size={14} /> Deep research complete for {deepResults.length} {deepResults.length === 1 ? 'company' : 'companies'}. Open their reports to review the findings and remaining gaps.</p>
        : <p><Sparkles size={14} /> Deep research is running on the top candidates: {stages[Math.max(0, deepStage)]} ({Math.max(0, deepStage) + 1}/6). Results update here automatically.</p>}</div>}
      <p className="results-note">{shown.length ? quick ? 'Every company is scored from official registry data, sector statistics and the structured model. 50 is a typical company. Select a company to see exactly which factors moved its score.' : 'A focused selection, ranked by the strength of the evidence. Select a company to see the reasoning.' : 'No sufficiently researched companies were found. Try another market or industry.'}</p>
      {[...(quick?.warnings || []), ...(job?.status === 'complete' ? job.warnings : [])].length > 0 && <p className="result-warning muted">{[...(quick?.warnings || []), ...(job?.status === 'complete' ? job.warnings : [])].join(' ')}</p>}
      {shown.map((p, i) => <Company key={companyKey(p)} company={p} index={i} />)}</div>}
    </div></main><footer><span>© {new Date().getFullYear()} Mergero</span><span>Considered intelligence. Meaningful conversations.</span></footer></div></div>;
}
