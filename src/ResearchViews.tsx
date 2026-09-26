import { useState } from 'react';
import { ArrowUpRight, Building2, Globe2 } from 'lucide-react';
import { safeUrl, type Opportunity, type RegionalSignal } from './marketApi';

export function EmptyResearch({ sellers = false, onResearch }: { sellers?: boolean; onResearch: () => void }) {
  return <section className="context-card empty-state">{sellers ? <Building2 size={25} /> : <Globe2 size={25} />}<h2>{sellers ? 'Your next opportunity starts here.' : 'A clearer view of your market.'}</h2><p>{sellers ? 'Completed research will appear here automatically. No companies saved yet.' : 'Research a country and industry to see the regional signals, their significance, and the evidence behind them.'}</p><button onClick={onResearch}>Open deal engine <ArrowUpRight size={16} /></button></section>;
}

function usableSignals(value: unknown): RegionalSignal[] {
  if (!Array.isArray(value)) return [];
  return value.filter((s): s is RegionalSignal => !!s && ['id', 'name', 'category', 'why_it_matters_in_region', 'how_to_detect'].every(k => typeof s[k] === 'string') && ['strong', 'medium', 'weak'].includes(s.signal_strength) && Array.isArray(s.evidence_urls) && s.evidence_urls.every((url: unknown) => typeof url === 'string'));
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const textValue = (value: unknown) => typeof value === 'string' ? value : '';
const dateLabel = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Date not recorded';
function SourceLink({ url, title }: { url: string; title?: string }) {
  const href = safeUrl(url);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{title || href}<ArrowUpRight size={13} /></a> : null;
}

function AcademicReferences({ reports, signal }: { reports: Opportunity[]; signal: RegionalSignal }) {
  // Only explicit saved classifications count as academic references. A domain
  // or a citation in ordinary trade coverage does not establish publication type.
  const references = [record(signal), ...reports.flatMap(p => [record(p.report), record(p.report.market_context)])].flatMap(container =>
    ['academic_references', 'academic_sources', 'research_papers'].flatMap(key => Array.isArray(container[key]) ? container[key] as unknown[] : [])
  ).map(value => typeof value === 'string' ? { url: value, title: value } as Record<string, unknown> : record(value))
    .filter(value => typeof value.url === 'string' && safeUrl(value.url) && (!value.signal_id || value.signal_id === signal.id));
  const unique = [...new Map(references.map(value => [textValue(value.url), value])).values()];
  return <section className="audit-literature"><h3>Saved academic references</h3>{unique.length ? <><p className="muted">Explicitly identified academic references from these saved reports. Report-level references are not necessarily evidence for the selected metric.</p><ul className="audit-sources">{unique.map(value => <li key={textValue(value.url)}><SourceLink url={textValue(value.url)} title={textValue(value.title) || undefined} />{textValue(value.authors) && <p>{textValue(value.authors)}</p>}{textValue(value.published_at) && <small>{dateLabel(value.published_at)}</small>}{textValue(value.excerpt) && <blockquote>{textValue(value.excerpt)}</blockquote>}</li>)}</ul></> : <p className="muted">Academic research is not separately identified in this saved report. The linked sources below are the references recorded with this metric; their publication type has not been classified.</p>}</section>;
}

function ContextDetails({ value }: { value: unknown }) {
  const context = record(value);
  const sections = [['recommended_registries', 'Recommended registries'], ['trade_press', 'Trade publications'], ['common_evidence_gaps', 'Common evidence gaps'], ['reducing_factors', 'Factors that weaken the case'], ['not_sale_intent', 'Limits of these indicators'], ['retrieved_source_urls', 'Saved regional research sources']];
  return <details className="audit-context"><summary>Saved market context</summary>{['summary', 'industry_summary', 'data_availability'].map(key => textValue(context[key]) && <p key={key}>{textValue(context[key])}</p>)}{sections.map(([key, label]) => {
    const values = Array.isArray(context[key]) ? (context[key] as unknown[]).filter((item): item is string => typeof item === 'string' && !!item.trim()) : [];
    return values.length ? <details className="audit-context-list" key={key}><summary>{label}</summary><ul>{values.map((item, i) => <li key={i}>{safeUrl(item) ? <SourceLink url={item} /> : item}</li>)}</ul></details> : null;
  })}</details>;
}

function CompanyAudit({ company, signal }: { company: Opportunity; signal: RegionalSignal }) {
  const identity = record(company.report.company);
  const discovery = textValue(identity.discovery_source);
  const evidence = company.evidence.filter(e => e.id === signal.id || (e.id.startsWith(signal.id + '-') && /^\d+$/.test(e.id.slice(signal.id.length + 1))));
  const verification = textValue(record(company.report).verification_method);
  return <details className="audit-company"><summary><span>{company.company}<small>Saved {dateLabel(company.report.generated_at)}</small></span><span>{evidence.length} {evidence.length === 1 ? 'finding' : 'findings'}</span></summary><div className="audit-company-body">
    <h4>How this company was identified</h4><p>{company.country} / {company.industry}. {discovery && safeUrl(discovery) ? 'The saved discovery source is linked below.' : 'A specific discovery source was not recorded in this saved report.'}</p>{discovery && safeUrl(discovery) && <div className="audit-discovery"><SourceLink url={discovery} /></div>}
    {company.why_now && <><h4>Why it was shortlisted</h4><p>{company.why_now}</p></>}
    {verification && <><h4>Recorded verification method</h4><p>{verification}</p></>}
    {!evidence.length && <p className="muted">No company-level finding was saved for this metric.</p>}
    {evidence.map((e, index) => <section className="audit-finding" key={`${e.id}-${index}`}><div className="audit-finding-heading"><h4>{e.signal}</h4><span>{e.status}</span></div><p>{e.fact || 'No public fact was recorded for this indicator.'}</p>{e.explanation && <p className="muted">{e.explanation}</p>}{e.sources.filter(s => safeUrl(s.url)).length ? <ul className="audit-sources">{e.sources.filter(s => safeUrl(s.url)).map((s, i) => <li key={`${s.url}-${i}`}><SourceLink url={s.url} title={s.title} /><span className="audit-source-url">{s.url}</span><small>{s.published_at ? `Published ${dateLabel(s.published_at)}` : 'Publication date not recorded'}{s.independent ? ' / Independent source as recorded' : ''}</small>{s.excerpt && <blockquote>{s.excerpt}</blockquote>}</li>)}</ul> : <p className="muted">No source links were saved for this finding.</p>}</section>)}
    {company.structured.facts.length > 0 && <details className="audit-metrics"><summary>Recorded company metrics <span>{company.structured.facts.length}</span></summary><p className="muted">These are report-wide facts; they are not all evidence for the selected regional signal.</p><dl>{company.structured.facts.map((fact, index) => <div key={`${fact.field}-${index}`}><dt>{fact.field.replace(/([A-Z])/g, ' $1')}</dt><dd>{typeof fact.value === 'boolean' ? fact.value ? 'Yes' : 'No' : fact.value}<small>As of {dateLabel(fact.as_of)}</small>{fact.sources.filter(url => safeUrl(url)).map(url => <SourceLink key={url} url={url} />)}</dd></div>)}</dl></details>}
    {company.data_gaps.length > 0 && <details className="audit-gaps"><summary>Recorded evidence gaps</summary><ul>{company.data_gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></details>}
  </div></details>;
}

export function SignalsPage({ reports, onResearch }: { reports: Opportunity[]; onResearch: () => void }) {
  const [market, setMarket] = useState(''), [signalId, setSignalId] = useState('');
  const markets = [...new Map(reports.map(p => [JSON.stringify([p.country, p.industry]), { key: JSON.stringify([p.country, p.industry]), country: p.country, industry: p.industry }])).values()];
  const selectedMarket = markets.find(m => m.key === market) || markets[0];
  const companies = reports.filter(p => p.country === selectedMarket?.country && p.industry === selectedMarket?.industry);
  const context = companies.find(p => usableSignals(p.report.market_context?.signals).length)?.report.market_context;
  const signals = usableSignals(context?.signals);
  const selected = signals.find(s => s.id === signalId) || signals[0];
  // Slugs are local to a generated checklist. Older reports may reuse the same
  // slug for another metric; compare definitions before combining findings.
  const definition = (s: RegionalSignal) => JSON.stringify([s.id, s.name, s.category, s.why_it_matters_in_region, s.how_to_detect]);
  const comparable = selected ? companies.filter(p => usableSignals(p.report.market_context?.signals).some(s => definition(s) === definition(selected))) : [];
  const findings = comparable.flatMap(p => p.evidence.filter(e => e.id === selected?.id || (e.id.startsWith((selected?.id || '') + '-') && /^\d+$/.test(e.id.slice((selected?.id.length || 0) + 1)))));
  const verified = findings.filter(e => e.status === 'Verified').length;
  const conflicting = findings.filter(e => e.status === 'Conflicting').length;
  const unverified = findings.filter(e => e.fact && !['Verified', 'Conflicting'].includes(e.status)).length;
  const strength = selected ? ({ strong: 3, medium: 2, weak: 1 }[selected.signal_strength]) : 0;
  const urls = [...new Set(selected?.evidence_urls.filter(url => safeUrl(url)) || [])];
  return <div className="context-page signals-page"><p className="eyebrow"><span /> Market perspective</p><h1>Regional intent signals.</h1><p className="intro">What we look for, why it matters, and what the evidence says.</p>
    {!markets.length ? <EmptyResearch onResearch={onResearch} /> : <>
      <div className="market-tabs" role="group" aria-label="Researched markets">{markets.map(m => <button key={m.key} aria-pressed={m.key === selectedMarket.key} onClick={() => { setMarket(m.key); setSignalId('') }}>{m.country}<small>{m.industry}</small></button>)}</div>
      {!selected ? <section className="context-card empty-state"><h2>Regional metrics aren’t available yet.</h2><p>The saved reports for this market do not include a regional checklist. A new investigation can refresh the evidence.</p><button onClick={onResearch}>Open deal engine <ArrowUpRight size={16} /></button></section> : <>
        <p className="library-status">{companies.length} researched {companies.length === 1 ? 'company' : 'companies'} · {signals.length} regional signals</p>
        <div className="signal-layout"><div className="signal-menu" role="group" aria-label="Regional metrics">{signals.map(s => <button key={s.id} aria-pressed={s.id === selected.id} aria-controls="signal-detail" onClick={() => setSignalId(s.id)}>{s.name}<span>{s.signal_strength}</span></button>)}</div>
          <section className="signal-detail" id="signal-detail" aria-label={selected.name} aria-live="polite"><p className="micro-label">{selected.category.replaceAll('_', ' ')}</p><h2>{selected.name}</h2><div className="signal-strength" aria-label={`Regional signal strength: ${selected.signal_strength}`}><span aria-hidden="true">{[1, 2, 3].map(n => <i key={n} data-active={n <= strength} />)}</span><span>{selected.signal_strength} regional signal</span></div>
            <h3>Why it matters here</h3><p>{selected.why_it_matters_in_region}</p><h3>What we compare</h3><p>{selected.how_to_detect}</p>
            <dl className="metric-summary"><div><dt>Verified findings</dt><dd>{verified}</dd></div><div><dt>Contradictions</dt><dd>{conflicting}</dd></div><div><dt>Still to verify</dt><dd>{unverified}</dd></div></dl>
            <p className="muted">Counts cover {comparable.length} saved {comparable.length === 1 ? 'company' : 'companies'} researched with this signal definition. Regional significance is not a company’s willingness to sell.</p>
            <ContextDetails value={context} />
            <section className="outreach-audit"><h3>Outreach evidence</h3><p>A traceable view of the saved research behind this metric.</p><details className="audit-process"><summary>How to read this evidence</summary><ol><li>Review the saved country, industry, regional rationale, and detection criteria above.</li><li>Open a company to see its discovery source and the findings matched to this exact signal definition.</li><li>Follow each citation to check the recorded fact, publication date, and excerpt against the original source.</li><li>Compare verification status and evidence gaps before using the finding in outreach.</li></ol><p className="muted">This is a saved evidence trail, not a new investigation. Sources can change after the report date.</p></details>
              {comparable.length ? <div className="audit-companies">{comparable.map(company => <CompanyAudit key={company.report.report_id} company={company} signal={selected} />)}</div> : <p>No saved company reports match this metric definition.</p>}
              <AcademicReferences reports={comparable} signal={selected} />
            </section>
            <div className="signal-sources"><h3>Regional sources</h3>{urls.length ? <ul>{urls.map(url => <li key={url}><SourceLink url={url} /></li>)}</ul> : <p>No regional source links were saved for this metric.</p>}</div>
          </section></div>
      </>}
    </>}
  </div>;
}
