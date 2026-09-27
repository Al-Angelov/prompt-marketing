import { useState } from 'react';
import { ArrowUpRight, Copy, MessageSquare } from 'lucide-react';
import { buildContactPlan } from './contactPlan';
import { safeUrl, type Opportunity } from './marketApi';
import { MnaAssessment } from './MnaAssessment';
import { companyKey } from './reportLibrary';
import './outreach.css';

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
    <section className="contact-goal" aria-labelledby="contact-goal-heading">
      <span className="micro-label">Your goal</span>
      <h3 id="contact-goal-heading">{plan.goal}</h3>
      <div className="contact-readiness" data-readiness={plan.readiness}><strong>{plan.readiness === 'hold' ? 'Hold outreach' : 'Review before outreach'}</strong><p>{plan.readinessReason}</p></div>
    </section>
    {plan.hasTiming ? <section className="contact-why-now" aria-labelledby="contact-why-now-heading">
      <div><span className="micro-label">The reason to start a conversation</span><h3 id="contact-why-now-heading">Why now</h3></div>
      <div><strong>{plan.whyNow}</strong><p>Suggested context: {plan.conversation}. {plan.whyNowSources.length ? 'Supported by the saved findings below; not evidence that the owner intends to sell.' : 'A research hypothesis still requiring company-specific evidence before outreach.'}</p>
        {plan.whyNowSources.length > 0 && <div className="contact-why-sources"><span>{plan.whyNowSources.length} supporting {plan.whyNowSources.length === 1 ? 'source' : 'sources'}</span>{plan.whyNowSources.map((source, i) => <ContactLink key={`${source.url}-${i}`} url={source.url}>{source.title || new URL(source.url).hostname}</ContactLink>)}</div>}
      </div>
    </section> : plan.context && <section className="contact-context"><span className="micro-label">What we know</span><p>{plan.context.summary}</p></section>}
    <section className="contact-steps" aria-labelledby="contact-steps-heading">
      <h3 id="contact-steps-heading">Your next steps</h3>
      <ol>{plan.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
    </section>
    <div className="contact-columns">
      <section><span className="micro-label">01 / Who</span><h3>{plan.recipient}</h3><p>{plan.recipientBasis}</p></section>
      <section><span className="micro-label">02 / Where</span><h3>{plan.channel}</h3><p>{plan.channelReason}</p>{plan.email && <div className="contact-email"><span>{plan.email}</span><button aria-label="Copy email address" onClick={() => copy(plan.email!, 'Email address')}><Copy size={14} /></button></div>}{plan.channelUrl && <ContactLink url={plan.channelUrl}>Open contact source</ContactLink>}{plan.website && plan.website !== plan.channelUrl && <ContactLink url={plan.website}>Company website</ContactLink>}</section>
      <section><span className="micro-label">03 / How</span><h3>Suggested approach</h3><p>{plan.approach}</p></section>
    </div>
    {plan.draft ? <div className="contact-draft"><div className="contact-section-heading"><h3>Suggested opening message</h3><button onClick={() => copy(plan.draft!, 'Draft')}><Copy size={14} />Copy message</button></div><p className="contact-draft-note">Built from the researched “why now.” Confirm the recipient and evidence before sending.</p><div className="contact-draft-text">{plan.draft}</div></div>
      : plan.introduction ? <div className="contact-draft"><div className="contact-section-heading"><h3>Introduction message</h3><button onClick={() => copy(plan.introduction!, 'Introduction')}><Copy size={14} />Copy introduction</button></div><p className="contact-draft-note">A general first message. It mentions nothing about their plans, so it is safe to send while evidence is still thin. Replace [Your name] before sending.</p><div className="contact-intro-text">{plan.introduction}</div></div>
      : <div className="contact-draft"><h3>No message while risks are unresolved</h3><p>Review the business and transaction assessment below first.</p></div>}
    {plan.followUp && <details className="contact-followup"><summary>Follow-up message (if no reply after a week)</summary><button onClick={() => copy(plan.followUp!, 'Follow-up')}><Copy size={14} />Copy follow-up</button><div className="contact-intro-text">{plan.followUp}</div></details>}
    <p className="contact-copy-status" role="status" aria-live="polite">{copyState}</p>
    <h4 className="contact-details-heading">Details and sources</h4>
    {plan.missing.length > 0 && <details className="contact-provenance"><summary>Still to confirm <span>{plan.missing.length}</span></summary><ul className="contact-missing-list">{plan.missing.map((item, i) => <li key={i}>{item}</li>)}</ul></details>}
    <details className="contact-provenance contact-assessment"><summary>Business and transaction assessment</summary><MnaAssessment company={company} /></details>
    <details className="contact-provenance"><summary>Sources behind this plan <span>{plan.sources.length}</span></summary>{plan.sources.length ? <ul className="audit-sources">{plan.sources.map((source, i) => <li key={`${source.url}-${i}`}><ContactLink url={source.url}>{source.title || source.url}</ContactLink><span className="audit-source-url">{source.url}</span>{source.published_at && <small>Published {source.published_at}</small>}{source.excerpt && <blockquote>{source.excerpt}</blockquote>}</li>)}</ul> : <p>No contact-specific source was saved. Suggested roles and channels still need confirmation.</p>}</details>
    {plan.verifiedFacts.length > 0 && <details className="contact-provenance"><summary>Verified facts to reference <span>{plan.verifiedFacts.length}</span></summary>{plan.verifiedFacts.map((fact, i) => <section className="contact-verified-fact" key={`${fact.signal}-${i}`}><h4>{fact.signal}</h4><p>{fact.fact}</p><ul className="audit-sources">{fact.sources.map((source, j) => <li key={`${source.url}-${j}`}><ContactLink url={source.url}>{source.title || source.url}</ContactLink>{source.excerpt && <blockquote>{source.excerpt}</blockquote>}</li>)}</ul></section>)}</details>}
  </div>;
}

export function ContactPlan({ companies }: { companies: Opportunity[] }) {
  const [selectedKey, setSelectedKey] = useState('');
  const sorted = [...companies].sort((a, b) => (b.priority ?? -1) - (a.priority ?? -1) || a.company.localeCompare(b.company));
  const company = sorted.find(item => companyKey(item) === selectedKey) || sorted[0];
  if (!company) return null;
  return <section className="contact-plan" aria-labelledby="contact-plan-heading"><div className="contact-plan-heading"><div><p className="eyebrow"><MessageSquare size={15} /> Your next conversation</p><h2 id="contact-plan-heading">Outreach plan</h2><p>Why to reach out, who to approach, where to contact them, and what to say—grounded in saved research.</p></div><label className="contact-company-selector"><span>Choose a seller</span><select aria-label="Choose a seller" value={companyKey(company)} onChange={event => setSelectedKey(event.target.value)}>{sorted.map(item => <option key={companyKey(item)} value={companyKey(item)}>{item.company}</option>)}</select></label></div><PlanDetails key={`${companyKey(company)}-${company.report.report_id}-${company.report.generated_at}`} company={company} /></section>;
}
