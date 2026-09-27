import { ArrowUpRight } from 'lucide-react';
import { safeUrl, type Opportunity } from './marketApi';

const dimensions = [
  ['owner_motivation', 'Owner motivation'], ['business_quality', 'Business quality'],
  ['strategic_attractiveness', 'Strategic attractiveness'], ['timing', 'Timing triggers'],
  ['dealability', 'Dealability'], ['economics', 'Valuation / economics'], ['risk', 'Negative evidence / risk'],
] as const;
type Finding = { fact: string; sources: string[]; status: string };
type Assessment = { dimension: string; status: string; summary: string; findings: Finding[]; gaps: string[] };
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const strings = (v: unknown) => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && !!s.trim()) : [];
function assessments(value: unknown): Assessment[] {
  if (!Array.isArray(value)) return [];
  return value.map(record).filter(v => dimensions.some(([key]) => v.dimension === key)).map(v => ({
    dimension: String(v.dimension), status: ['supported', 'limited', 'unknown', 'risk'].includes(String(v.status)) ? String(v.status) : 'unknown',
    summary: typeof v.summary === 'string' ? v.summary : '', gaps: strings(v.gaps),
    findings: (Array.isArray(v.findings) ? v.findings : []).map(record).filter(f => typeof f.fact === 'string' && !!f.fact.trim()).map(f => ({ fact: String(f.fact), sources: strings(f.sources).filter(url => safeUrl(url)), status: typeof f.status === 'string' ? f.status : 'Recorded finding' })),
  }));
}
const labels: Record<string, string> = { supported: 'Evidence recorded', limited: 'Partial coverage', unknown: 'Not established', risk: 'Risk to review' };

export function MnaAssessment({ company }: { company: Opportunity }) {
  const saved = assessments(record(company.report).mna_assessment);
  const covered = new Set(saved.filter(a => a.findings.some(f => f.sources.length)).map(a => a.dimension)).size;
  return <section className="mna-assessment" aria-label="M&A assessment">
    <div className="mna-heading"><div><h3>M&amp;A assessment</h3><p>Company quality, buyer fit and transaction readiness, considered together.</p></div><span>{saved.length ? `${covered} / 7 dimensions with sourced findings` : 'Updated assessment available after new research'}</span></div>
    {!saved.length && <p className="mna-legacy-note">This saved report predates the seven-part assessment. Its existing evidence and company facts are preserved below; these dimensions have not yet been assessed.</p>}
    <div className="mna-dimensions">{dimensions.map(([key, label]) => {
      const a = saved.find(item => item.dimension === key);
      const status = a?.status || 'unknown';
      const hasDetail = !!(a?.findings.length || a?.gaps.length);
      const heading = <><span>{label}</span><small data-status={status}>{a ? labels[status] : 'Not assessed'}</small></>;
      return hasDetail ? <details className="mna-dimension" key={key}><summary>{heading}</summary><div className="mna-dimension-body">{a.summary && <p>{a.summary}</p>}{a.findings.map((finding, i) => <article className="mna-finding" key={i}><span>{finding.status.replaceAll('_', ' ')}</span><p>{finding.fact}</p><div>{finding.sources.map((url, j) => <a href={safeUrl(url)} target="_blank" rel="noopener noreferrer" key={url}>{new URL(url).hostname.replace(/^www\./, '')} <ArrowUpRight size={12} /><span className="sr-only"> source {j + 1}</span></a>)}</div>{!finding.sources.length && <small>Source link not recorded; verify before relying on this finding.</small>}</article>)}{a.gaps.length > 0 && <div className="mna-open-questions"><h4>Open questions</h4><ul>{a.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></div>}</div></details>
        : <div className="mna-dimension mna-dimension-empty" key={key}><div>{heading}</div>{a?.summary && <p>{a.summary}</p>}</div>;
    })}</div>
    <p className="mna-note">Missing information is an open question, not evidence against the company. A strong business alone does not establish an owner’s willingness to transact.</p>
  </section>;
}

/** Empty checklist rows are research gaps, never negative company evidence. */
export function hasRecordedFinding(evidence: Opportunity['evidence'][number]) {
  return ['Verified', 'Conflicting'].includes(evidence.status) || !!evidence.sources.length || !!evidence.fact?.trim() && !/^(?:no (?:supporting |public |relevant |company[- ]specific )?evidence(?: (?:was )?found)?|none established|not found|not available|unknown)[.!\s]*$/i.test(evidence.fact.trim());
}
