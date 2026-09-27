import { companyWebsite, safeUrl, type Opportunity, type Source } from './marketApi';
import { companyInsight } from './companyInsight';
import { getMnaAssessment } from './legacyAssessment';

export type ContactPlanData = {
  whyNow: string; conversation: string; whyNowSources: Source[];
  recipient: string; recipientBasis: string; channel: string; channelReason: string;
  email?: string; channelUrl?: string; website?: string; sources: Source[];
  approach: string; readiness: 'review' | 'hold'; readinessReason: string;
  draft: string | null; verifiedFacts: { signal: string; fact: string; sources: Source[] }[]; missing: string[];
  /** One sentence: what this outreach is trying to achieve. */
  goal: string;
  /** Ordered, actionable steps toward that goal. */
  steps: string[];
  /** Best company-specific context when no timing trigger exists (instead of "not established"). */
  context: { label: string; summary: string } | null;
  /** Neutral first message making no claims about the company; only when no evidence-backed draft exists. */
  introduction: string | null;
  followUp: string | null;
  hasTiming: boolean;
};
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
const emailAddress = (v: string) => v.length <= 254 && !v.startsWith('.') && !v.includes('..') && !v.includes('.@') && /^[a-zA-Z0-9.!#$%&'*+/=^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(v);
const host = (url: string) => new URL(url).hostname.toLowerCase().replace(/^www\./, '');
const sameDomain = (domain: string, website: string) => domain === host(website) || domain.endsWith('.' + host(website));
const includesText = (excerpt: string, value: string) => {
  const words = (s: string) => s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return !!value && !!words(value) && ` ${words(excerpt)} `.includes(` ${words(value)} `);
};
const comparableText = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const emailsIn = (excerpt: string) => (excerpt.match(/\S*@\S*/g) || []).map(token => {
  while (token && '<(["'.includes(token[0])) token = token.slice(1);
  while (token && '>)]",;!'.includes(token[token.length - 1])) token = token.slice(0, -1);
  return token.endsWith('.') ? token.slice(0, -1) : token;
}).filter(emailAddress);
const urlsIn = (excerpt: string) => (excerpt.match(/https?:\/\/[^\s<>"'()[\]{}]+/g) || []).map(url => safeUrl(url.replace(/[.,;:!]+$/, '')));

/** Derives a review plan from archived evidence; never enriches or sends data. */
export function buildContactPlan(company: Opportunity): ContactPlanData {
  const website = companyWebsite(company);
  const citations = company.evidence.flatMap(e => e.sources).filter(s => safeUrl(s.url));
  const byUrl = new Map(citations.map(s => [safeUrl(s.url)!, s]));
  const report = record(company.report);
  const routes = Array.isArray(report.contact_routes) ? report.contact_routes.map(record) : [];
  type Route = { channel: string; email?: string; url?: string; recipient?: string; source: Source };
  const usable: Route[] = [];
  for (const route of routes) {
    const sourceUrl = safeUrl(text(route.source_url));
    // A source link alone is not evidence of an address or named recipient.
    const archived = Array.isArray(route.citations) ? route.citations.map(record).find(s =>
      typeof s.url === 'string' && safeUrl(s.url) === sourceUrl && typeof s.excerpt === 'string' && s.excerpt.trim()) : undefined;
    const source: Source | undefined = sourceUrl ? (archived ? {
      url: sourceUrl, title: text(archived.title) || 'Saved contact source', excerpt: text(archived.excerpt),
      published_at: text(archived.published_at) || null, independent: archived.independent === true,
    } : byUrl.get(sourceUrl)) : undefined;
    if (!source) continue;
    const email = text(route.email), url = safeUrl(text(route.url));
    const name = text(route.name), role = text(route.role);
    const recipient = includesText(source.excerpt, name) ? name + (includesText(source.excerpt, role) ? ` · ${role}` : '') : undefined;
    if (route.channel === 'email' && emailAddress(email) && !/^(no-?reply|do-?not-?reply)@/i.test(email) && emailsIn(source.excerpt).some(found => found.toLowerCase() === email.toLowerCase())) {
      usable.push({ channel: 'Published business email', email, recipient, source });
    } else if (url && (safeUrl(source.url) === url || urlsIn(source.excerpt).includes(url))) {
      if (route.channel === 'linkedin' && ['linkedin.com', 'www.linkedin.com'].includes(new URL(url).hostname) && /^\/(in|company)\//.test(new URL(url).pathname)) {
        usable.push({ channel: 'Recorded LinkedIn profile', url, recipient, source });
      } else if (route.channel === 'contact_form' && website && sameDomain(host(url), website)) {
        usable.push({ channel: 'Recorded company contact page', url, recipient, source });
      }
    }
  }
  // Older reports have no contact_routes. Only extract literal business-domain
  // addresses from archived citations on the company's own recorded website.
  if (website) for (const source of citations) {
    if (!sameDomain(host(source.url), website)) continue;
    for (const email of emailsIn(source.excerpt)) {
      if (sameDomain(email.split('@')[1].toLowerCase(), website) && !/^(no-?reply|do-?not-?reply)@/i.test(email)) {
        usable.push({ channel: 'Published business email', email, source });
      }
    }
    if (/(^|\/)(contact(?:-us)?|kontakt|yhteystiedot)(\/|$)/i.test(new URL(source.url).pathname)) {
      usable.push({ channel: 'Recorded company contact page', url: safeUrl(source.url), source });
    }
  }
  usable.sort((a, b) => Number(!!b.recipient) - Number(!!a.recipient) || Number(!!b.email) - Number(!!a.email));
  const route = usable[0];
  const insight = companyInsight(company);
  const conversation = insight.hasTiming ? company.conversation : 'Not established';
  const topic = conversation.toLowerCase();
  const suggestedRole = /succession|ownership|exit/.test(topic) ? 'Owner or managing director' : /growth|capital|liquidity|finance/.test(topic) ? 'Managing director or finance lead' : 'Managing director or company leadership';
  const verifiedFacts = company.evidence.filter(e => e.status === 'Verified' && e.fact && e.sources.length).map(e => ({ signal: e.signal, fact: e.fact!, sources: e.sources }));
  const whyNow = insight.whyNow;
  const normalizedWhy = comparableText(whyNow);
  const whyNowSources = [...new Map(verifiedFacts
    .filter(item => {
      const fact = comparableText(item.fact);
      return !!fact && (normalizedWhy.includes(fact) || fact.includes(normalizedWhy));
    })
    .flatMap(item => item.sources)
    .filter(source => safeUrl(source.url))
    .map(source => [safeUrl(source.url)!, source])).values()];
  const conflict = company.evidence.some(e => e.status === 'Conflicting');
  const commercialRisk = getMnaAssessment(company).cards.some(item => item.status === 'risk');
  const hold = !company.contact || company.structured.synthetic || conflict || commercialRisk || !insight.hasTiming || !verifiedFacts.length;
  const missing = [];
  if (!route?.recipient) missing.push('A named decision-maker has not been established by the saved contact evidence.');
  if (!route?.email) missing.push('No supported business email is available in this saved report.');
  if (!route && !website) missing.push('No supported contact channel or official company website is available.');

  const draft = commercialRisk || !insight.hasTiming ? null : company.outreach;
  const who = route?.recipient ? route.recipient.split(' · ')[0] : `the ${suggestedRole.toLowerCase()}`;
  const market = /^all industries$/i.test(company.industry.trim()) || !company.industry.trim() ? `companies in ${company.country}` : `${company.industry.trim().toLowerCase()} companies in ${company.country}`;
  const goal = commercialRisk
    ? `Pause: review the flagged risks for ${company.company} before deciding on an approach.`
    : insight.hasTiming
      ? `Book a 20-minute introductory call with ${who} to explore ${conversation.toLowerCase()}, without assuming a sale.`
      : `Open a first conversation with ${who} to learn ${company.company}'s plans for the next few years.`;
  const steps = commercialRisk
    ? ['Open "Details and sources" below and read the business and transaction assessment.', 'Decide whether an approach is still appropriate; no message is prepared while risks are unresolved.']
    : [
        route?.recipient ? `Confirm ${who} still holds this role (company site or LinkedIn).` : `Find the name of ${who} on the company website or LinkedIn.`,
        route?.email ? `Email ${route.email}.` : route?.url ? 'Use the contact route linked under "Where".' : website ? 'Find the business contact on the company website linked under "Where".' : `Find a public business contact for ${company.company}.`,
        draft ? (hold ? 'Verify the facts the message below mentions (see "Details and sources"), then send it.' : 'Check the facts in the message below, then send it.')
          : 'Send the introduction below. It makes no claims about their plans, so it does not depend on the missing evidence.',
        'No reply after a week? Send the follow-up.',
      ];
  const introduction = commercialRisk || draft ? null
    : `Hello,\n\nI'm reaching out from Mergero. We work with owners of ${market} on what comes next for their business, whether that is growth, bringing in a partner or planning for the long term.\n\nI would value a short conversation to understand your priorities for ${company.company}. There is no assumption that you are looking to sell or seeking investment.\n\nWould a 20-minute call in the coming weeks suit you?\n\nBest regards,\n[Your name]\nMergero`;
  const followUp = commercialRisk ? null
    : `Hello,\n\nI'm following up on my note last week about ${company.company}. If a short conversation about your plans would be useful, I'm happy to work around your schedule. If the timing isn't right, just let me know.\n\nBest regards,\n[Your name]\nMergero`;
  const context = insight.hasTiming || insight.label === 'Evidence gap' ? null : { label: insight.label, summary: insight.summary };

  return {
    whyNow,
    conversation,
    whyNowSources,
    recipient: route?.recipient || suggestedRole,
    recipientBasis: route?.recipient ? 'Named in the saved source. Confirm they still hold this role.' : 'No name found yet. Step 1 above covers how to find one.',
    channel: route?.channel || (website ? 'Official company website' : 'Find a public contact'),
    channelReason: route ? 'Found in the saved research. Check it is still current.' : website ? 'No direct email found yet. The company website is the best place to start.' : 'No public contact was found in the saved research yet.',
    email: route?.email, channelUrl: route?.url, website, sources: route ? [route.source] : [],
    approach: insight.hasTiming ? company.angle : 'Open with genuine interest in their plans for the business. Do not raise selling or succession unless they do.',
    readiness: hold ? 'hold' : 'review',
    readinessReason: hold ? (commercialRisk ? 'Review the sourced risks in the M&A assessment before contacting this company.' : conflict ? 'Resolve the contradictory evidence before contacting this company.' : company.structured.synthetic ? 'The saved assessment uses a provisional model. Validate the evidence before contacting this company.' : 'The saved assessment does not establish a contact-ready opportunity. Review the missing evidence first.') : 'The saved assessment supports reviewing an approach. Confirm the recipient, current evidence and draft before use.',
    draft, verifiedFacts, missing,
    goal, steps, context, introduction, followUp, hasTiming: insight.hasTiming,
  };
}
