import { useState } from 'react';
import { ArrowUpRight, Copy, MessageSquare } from 'lucide-react';
import { buildContactPlan } from './contactPlan';
import { safeUrl, type Opportunity } from './marketApi';
import { companyKey } from './reportLibrary';

function ContactLink({ url, children }: { url?: string; children: React.ReactNode }) {
  const href = url && safeUrl(url);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}<ArrowUpRight size={14} /></a> : null;
}

function PlanDetails({ company }: { company: Opportunity }) {
  const plan = buildContactPlan(company);
  const [copyState, setCopyState] = useState('');
  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); setCopyState(`${label} copied.`) }
    catch { setCopyState('Copy is unavailable. Select and copy the text below.') }
  }
  return <div className="contact-plan-body">
    <p className="contact-selected-company">{company.company}<small>Research saved {new Date(company.report.generated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</small></p>
    <div className="contact-readiness" data-readiness={plan.readiness}><strong>{plan.readiness === 'hold' ? 'Hold outreach' : 'Review before outreach'}</strong><p>{plan.readinessReason}</p></div>
    <div className="contact-columns">
      <section><span className="micro-label">01 / Who</span><h3>{plan.recipient}</h3><p>{plan.recipientBasis}</p></section>
      <section><span className="micro-label">02 / Where</span><h3>{plan.channel}</h3><p>{plan.channelReason}</p>{plan.email && <div className="contact-email"><span>{plan.email}</span><button aria-label="Copy email address" onClick={() => copy(plan.email!, 'Email address')}><Copy size={14} /></button></div>}{plan.channelUrl && <ContactLink url={plan.channelUrl}>Open contact source</ContactLink>}{plan.website && plan.website !== plan.channelUrl && <ContactLink url={plan.website}>Company website</ContactLink>}</section>
      <section><span className="micro-label">03 / How</span><h3>Suggested approach</h3><p>{plan.approach}</p></section>
    </div>
    {plan.missing.length > 0 && <div className="contact-missing"><h4>Before you reach out</h4><ul>{plan.missing.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
    <div className="contact-draft"><div className="contact-section-heading"><h3>Saved outreach draft</h3>{plan.draft && <button onClick={() => copy(plan.draft!, 'Draft')}><Copy size={14} />Copy draft</button>}</div>{plan.draft ? <><p className="contact-draft-note">Review the wording, recipient, and supporting evidence before using this saved draft.</p><div className="contact-draft-text">{plan.draft}</div></> : <p>No outreach draft was saved for this company.</p>}</div>
    <p className="contact-copy-status" role="status" aria-live="polite">{copyState}</p>
    <details className="contact-provenance"><summary>Sources behind this plan <span>{plan.sources.length}</span></summary>{plan.sources.length ? <ul className="audit-sources">{plan.sources.map((source, i) => <li key={`${source.url}-${i}`}><ContactLink url={source.url}>{source.title || source.url}</ContactLink><span className="audit-source-url">{source.url}</span>{source.published_at && <small>Published {source.published_at}</small>}{source.excerpt && <blockquote>{source.excerpt}</blockquote>}</li>)}</ul> : <p>No contact-specific source was saved. Suggested roles and channels still need confirmation.</p>}</details>
    {plan.verifiedFacts.length > 0 && <details className="contact-provenance"><summary>Verified facts to reference <span>{plan.verifiedFacts.length}</span></summary>{plan.verifiedFacts.map((fact, i) => <section className="contact-verified-fact" key={`${fact.signal}-${i}`}><h4>{fact.signal}</h4><p>{fact.fact}</p><ul className="audit-sources">{fact.sources.map((source, j) => <li key={`${source.url}-${j}`}><ContactLink url={source.url}>{source.title || source.url}</ContactLink>{source.excerpt && <blockquote>{source.excerpt}</blockquote>}</li>)}</ul></section>)}</details>}
  </div>;
}

export function ContactPlan({ companies }: { companies: Opportunity[] }) {
  const [selectedKey, setSelectedKey] = useState('');
  const sorted = [...companies].sort((a, b) => (b.priority ?? -1) - (a.priority ?? -1) || a.company.localeCompare(b.company));
  const company = sorted.find(item => companyKey(item) === selectedKey) || sorted[0];
  if (!company) return null;
  return <section className="contact-plan" aria-labelledby="contact-plan-heading"><div className="contact-plan-heading"><div><p className="eyebrow"><MessageSquare size={15} /> Your next conversation</p><h2 id="contact-plan-heading">Seller contact plan</h2><p>A practical starting point from saved research, with the evidence to review.</p></div><label className="contact-company-selector"><span>Choose a seller</span><select aria-label="Choose a seller" value={companyKey(company)} onChange={event => setSelectedKey(event.target.value)}>{sorted.map(item => <option key={companyKey(item)} value={companyKey(item)}>{item.company}</option>)}</select></label></div><PlanDetails key={`${companyKey(company)}-${company.report.report_id}-${company.report.generated_at}`} company={company} /></section>;
}
