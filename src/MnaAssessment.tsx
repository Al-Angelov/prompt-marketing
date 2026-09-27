import { ArrowUpRight } from 'lucide-react';
import { safeUrl, type Opportunity } from './marketApi';

import { getMnaAssessment, mnaDimensions as dimensions } from './legacyAssessment';

const labels: Record<string, string> = { supported: 'Evidence recorded', limited: 'Partial coverage', unknown: 'Not established', risk: 'Risk to review' };

export function MnaAssessment({ company }: { company: Opportunity }) {
  const { cards: saved, reconstructed } = getMnaAssessment(company);
  const covered = new Set(saved.filter(a => a.findings.some(f => f.sources.length)).map(a => a.dimension)).size;
  return <section className="mna-assessment" aria-label="M&A assessment">
    <div className="mna-heading"><div><h3>M&amp;A assessment</h3><p>Company quality, buyer fit and transaction readiness, considered together.</p></div><span>{`${covered} / 7 dimensions with sourced findings`}</span></div>
    {reconstructed && <p className="mna-legacy-note">Organized from your existing saved evidence. Original sources and verification status are preserved; open questions still need research.</p>}
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
