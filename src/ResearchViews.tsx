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
            {urls.length > 0 && <div className="signal-sources"><h3>Regional sources</h3><ul>{urls.map(url => <li key={url}><a href={safeUrl(url)} target="_blank" rel="noopener noreferrer">{new URL(url).hostname.replace(/^www\./, '')}<ArrowUpRight size={13} /></a></li>)}</ul></div>}
          </section></div>
      </>}
    </>}
  </div>;
}
