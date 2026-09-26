import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Globe2, Layers3, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { companyWebsite, marketRequest, safeUrl, type MarketJob, type Opportunity, type Source } from './marketApi';
import { ContextPage, Sidebar, WorkspaceHeader, type WorkspaceView } from './WorkspaceChrome';

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
  const groups = [['Strongest verified signals', 'Verified'], ['Contradictory evidence', 'Conflicting'], ['Evidence still to verify', 'other']];
  return <details className="company"><summary><div className="company-top"><span className="ordinal">{String(index + 1).padStart(2, '0')}</span><div className="company-name"><h2>{p.company}</h2></div><div className="priority"><small>Priority Score</small><strong>{p.priority ?? '—'}{p.priority !== null && <span> / 100</span>}</strong></div><ChevronDown className="expand-icon" size={18} /></div>
    <dl className="overview"><div><dt>Why now</dt><dd>{p.why_now}</dd></div><div><dt>Confidence</dt><dd><span className={`confidence confidence-${p.confidence.toLowerCase()}`}>{p.confidence}</span></dd></div></dl><span className="report-label">Company report <ArrowRight size={14} /></span></summary>
    <div className="company-website-row">{website ? <a className="company-website" href={website} target="_blank" rel="noopener noreferrer"><Globe2 size={16} /><span>Visit company website<small>{new URL(website).hostname.replace(/^www\./, '')}</small></span><ArrowUpRight size={18} /></a> : <span className="website-unavailable"><Globe2 size={15} /> Company website not available</span>}</div>
    <div className="investigation"><div className="section-heading"><h3>Company report</h3><button onClick={() => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(p.report, null, 2)], {type: 'application/json'}));
      const link = document.createElement('a'); link.href = url; link.download = `${p.report.report_id}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>Download JSON</button></div><p className="recommendation">{p.contact ? 'Suitable for a considered approach.' : 'Do not contact yet. Review the evidence and resolve the gaps first.'}</p>
      {groups.map(([title, status]) => { const items = p.evidence.filter(e => status === 'other' ? !['Verified', 'Conflicting'].includes(e.status) : e.status === status); return <section key={title}><h3>{title}</h3>{items.length ? items.map(e => <article className="evidence" key={e.id}><div className="evidence-title"><h4>{e.signal}</h4><small>{e.status}</small></div><p>{e.fact || 'No supporting evidence found.'}</p><p className="muted">{e.explanation}</p><Sources sources={e.sources} /></article>) : <p className="muted">{status === 'Conflicting' ? 'No contradictory evidence was identified in the sources checked. This is not confirmation of an interest in selling.' : 'None established.'}</p>}</section> })}
      {p.data_gaps.length > 0 && <section><h3>What we still need to know</h3><ul className="gaps">{p.data_gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></section>}
      <section><h3>Company-data insight</h3><p>{p.structured.insight}</p>{p.structured.synthetic && <p className="muted">The current model uses synthetic training data. Its contribution is provisional and cannot support a contact recommendation.</p>}{p.structured.facts.map((f, i) => <article className="evidence" key={i}><p>{f.field.replace(/([a-z])([A-Z])/g, '$1 $2')}: {f.value.toLocaleString()} <span className="muted">· as of {f.as_of}</span></p><ul className="sources">{f.sources.map(url => <li key={url}><a href={safeUrl(url)} target="_blank" rel="noreferrer">Source <ArrowUpRight size={12} /></a></li>)}</ul></article>)}</section>
      <section><h3>Why this priority?</h3><p>{p.explanation}</p><dl className="score-breakdown">
        <div><dt>Public evidence contribution</dt><dd>{p.report.score_breakdown.public_contribution.toFixed(2)}</dd></div>
        <div><dt>Structured contribution</dt><dd>{p.report.score_breakdown.model_contribution.toFixed(2)}</dd></div>
        <div><dt>Contradictions</dt><dd>{p.report.score_breakdown.contradiction_penalty.toFixed(2)}</dd></div>
      </dl><ul className="gaps">{p.report.score_breakdown.factors.map((f, i) => <li key={i}>{f.label}: {f.points.toFixed(2)} points before weighting</li>)}</ul>
      <p className="muted">{p.report.structured_model.label}{p.report.structured_model.percentile !== null ? ` · Reference percentile: ${p.report.structured_model.percentile.toFixed(1)} / 100` : ''}</p><p className="muted">A research priority is not a probability that the owner wants to sell. Missing information reduces confidence.</p></section>
      <section><h3>Recommended conversation</h3><p>{p.angle}</p></section>
      <section><div className="section-heading"><h3>Suggested outreach</h3>{p.outreach && <button onClick={async () => { try { await navigator.clipboard.writeText(p.outreach!); setCopied(true); setCopyError(false) } catch { setCopyError(true) } }}>{copied ? 'Copied' : 'Copy draft'}</button>}</div>{p.outreach ? <><p className="muted">Review draft · {p.contact ? 'Confirm the context before sending.' : 'Hold until the outstanding evidence has been reviewed.'}</p><p className="outreach">{p.outreach}</p>{copyError && <p role="status">Select the message to copy it manually.</p>}</> : <p className="muted">There is not enough verified evidence for a responsible approach yet.</p>}</section>
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
  const [country, setCountry] = useState(''), [industry, setIndustry] = useState('');
  const [phase, setPhase] = useState<'select' | 'research' | 'results' | 'error'>('select'), [job, setJob] = useState<MarketJob | null>(null), [error, setError] = useState('');
  const running = useRef(false), abort = useRef<AbortController | null>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { abort.current?.abort(); clearTimeout(timer.current) }, []);
  function begin(c: string, i: string) {
    if (running.current) return;
    running.current = true; setPhase('research'); setJob(null); setError('');
    const controller = new AbortController(); abort.current = controller; const deadline = Date.now() + 45 * 60 * 1000;
    async function receive(id?: string) {
      try {
        if (Date.now() > deadline) throw new Error('This research is taking longer than expected. Please try again shortly.');
        const result = await marketRequest(id || { country: c, industry: i }, controller.signal);
        if (controller.signal.aborted) return;
        if (result.country.toLowerCase() !== c.toLowerCase() || result.industry.toLowerCase() !== i.toLowerCase() || id && result.id !== id) throw new Error('We couldn’t match these results to your market. Please try again.');
        setJob(result);
        if (result.status === 'error') throw new Error('We couldn’t complete this research. Please try again later.');
        if (result.status === 'complete') { running.current = false; setPhase('results') }
        else timer.current = setTimeout(() => receive(result.id), 1500);
      } catch (e) { if (!controller.signal.aborted) { running.current = false; setError(e instanceof Error && !['TypeError', 'TimeoutError'].includes(e.name) ? e.message : 'Research is temporarily unavailable. Please try again later.'); setPhase('error') } }
    }
    void receive();
  }
  function confirm(which: 'country' | 'industry', value: string) { const c = which === 'country' ? value : country, i = which === 'industry' ? value : industry; if (which === 'country') setCountry(value); else setIndustry(value); if (c && i) begin(c, i) }
  function reset() { abort.current?.abort(); clearTimeout(timer.current); running.current = false; setCountry(''); setIndustry(''); setJob(null); setPhase('select') }
  function focusSearch() { setView('engine'); if (phase !== 'select') reset(); requestAnimationFrame(() => document.getElementById(phase === 'select' && country ? 'industry' : 'country')?.focus()) }
  function navigate(next: WorkspaceView) { setView(next); if (window.innerWidth < 1000) setCollapsed(true) }
  const context = job?.results[0]?.report.market_context;
  return <div className={`app-shell ${collapsed ? 'sidebar-is-collapsed' : ''}`}><Sidebar collapsed={collapsed} onToggle={() => setCollapsed(v => !v)} view={view} onNavigate={navigate} country={country} industry={industry} />{!collapsed && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setCollapsed(true)} />}<div className="workspace"><WorkspaceHeader view={view} onSearch={focusSearch} researching={phase === 'research'} /><main>
    {view !== 'engine' && <ContextPage view={view} summary={context?.summary} industrySummary={context?.industry_summary} dataAvailability={context?.data_availability} onResearch={() => navigate('engine')} />}
    <div hidden={view !== 'engine'}>
    {phase === 'select' && <div className="landing"><div className="hero-art" aria-hidden="true"><div className="orbital orbital-one" /><div className="orbital orbital-two" /><div className="orbital orbital-three" /><span className="orbital-core" /></div><div className="hero-content"><p className="eyebrow"><span /> MERGERO INTELLIGENCE <span className="eyebrow-divider">/</span> MGX</p><h1>See the signal.<br /><span>Find the opportunity.</span></h1><p className="intro">The right company. The right moment.<br />Evidence-led origination for your next meaningful conversation.</p><div className="search-panel"><div className="search-panel-heading"><div><Search size={17} /><span>Where will you look next?</span></div><button className="icon-button search-focus" onClick={focusSearch} aria-label="Search your market" title="Search country or industry"><Search size={17} /></button></div><div className="selections"><Selection label="Country" options={countries} value={country} onConfirm={v => confirm('country', v)} /><Selection label="Industry" options={industries} value={industry} onConfirm={v => confirm('industry', v)} /></div><p className="hint"><span className="status-dot" /> Research starts when both selections are confirmed.<span className="hint-arrow"><ArrowRight size={16} /></span></p></div><div className="hero-proof"><span><Globe2 size={14} /> Local market context</span><span><ShieldCheck size={14} /> Evidence, cross-checked</span><span><Layers3 size={14} /> One focused report</span></div></div><div className="landing-bottom"><span>INDEPENDENT THINKING. INFORMED CONVERSATIONS.</span><span>Built for the long view <ArrowUpRight size={13} /></span></div></div>}
    {phase === 'research' && <div className="research" aria-live="polite" aria-busy="true"><div className="research-emblem"><Sparkles size={25} /></div><p className="eyebrow"><span /> A focused investigation</p><h1 tabIndex={-1}>Researching {country}</h1><p className="intro">{industry}</p><p className="muted">Careful research takes a few minutes. We’ll bring the strongest opportunities together here.</p><div className="progress-track" role="progressbar" aria-label="Research progress" aria-valuemin={0} aria-valuemax={6} aria-valuenow={job?.stages.filter(s => s === 'complete').length || 0}><span style={{ width: `${(job?.stages.filter(s => s === 'complete').length || 0) / 6 * 100}%` }} /></div><ol className="progress">{stages.map((s, i) => <li key={s} data-state={job?.stages[i] || (i === 0 ? 'running' : 'pending')}><span>{job?.stages[i] === 'complete' ? <Check size={14} /> : String(i + 1).padStart(2, '0')}</span>{s}<small>{job?.stages[i] === 'complete' ? 'Complete' : job?.stages[i] === 'running' ? 'In progress' : ''}</small></li>)}</ol></div>}
    {phase === 'error' && <div className="research" role="alert"><p className="eyebrow">{country} · {industry}</p><h1>Research is on hold.</h1><p className="intro">{error}</p><div className="error-actions"><button onClick={() => begin(country, industry)}>Try again</button><button onClick={reset}>Change market</button></div></div>}
    {phase === 'results' && job && <div className="results"><div className="results-heading"><div><p className="eyebrow"><span /> Your opportunities</p><h1 tabIndex={-1}>{country}</h1><p className="intro">{industry}</p></div><button onClick={reset}>Change market <ArrowUpRight size={14} /></button></div><div className="results-meta"><span>{String(job.results.length).padStart(2, '0')} COMPANIES RESEARCHED</span><span>RANKED BY PRIORITY</span></div><p className="results-note">{job.results.length ? 'A focused selection, ranked by the strength of the evidence. Select a company to see the reasoning.' : 'No sufficiently researched companies were found. Try another market or industry.'}</p>{job.warnings.length > 0 && <p className="result-warning muted">{job.warnings.join(' ')}</p>}{job.results.map((p, i) => <Company key={`${p.company}-${i}`} company={p} index={i} />)}</div>}
    </div></main><footer><span>© {new Date().getFullYear()} Mergero</span><span>Considered intelligence. Meaningful conversations.</span></footer></div></div>;
}
