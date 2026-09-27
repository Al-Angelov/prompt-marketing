import { companyWebsite, safeUrl, type Opportunity, type Source } from './marketApi';

export type ContactPlanData = {
  recipient: string; recipientBasis: string; channel: string; channelReason: string;
  email?: string; channelUrl?: string; website?: string; sources: Source[];
  approach: string; readiness: 'review' | 'hold'; readinessReason: string;
  draft: string | null; verifiedFacts: { signal: string; fact: string; sources: Source[] }[]; missing: string[];
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
    const source = sourceUrl ? byUrl.get(sourceUrl) : undefined;
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
  usable.sort((a, b) => Number(!!b.email) - Number(!!a.email));
  const route = usable[0];
  const topic = company.conversation.toLowerCase();
  const suggestedRole = /succession|ownership|exit/.test(topic) ? 'Owner or managing director' : /growth|capital|liquidity|finance/.test(topic) ? 'Managing director or finance lead' : 'Managing director or company leadership';
  const verifiedFacts = company.evidence.filter(e => e.status === 'Verified' && e.fact && e.sources.length).map(e => ({ signal: e.signal, fact: e.fact!, sources: e.sources }));
  const conflict = company.evidence.some(e => e.status === 'Conflicting');
  const hold = !company.contact || company.structured.synthetic || conflict || !verifiedFacts.length;
  const missing = [];
  if (!route?.recipient) missing.push('A named decision-maker has not been established by the saved contact evidence.');
  if (!route?.email) missing.push('No supported business email is available in this saved report.');
  if (!route && !website) missing.push('No supported contact channel or official company website is available.');
  return {
    recipient: route?.recipient || suggestedRole,
    recipientBasis: route?.recipient ? 'Name recorded in the linked source excerpt. Confirm the person still holds this role.' : `Suggested role for the saved ${company.conversation || 'business'} conversation; no individual has been identified.`,
    channel: route?.channel || (website ? 'Official company website' : 'Contact channel not established'),
    channelReason: route ? 'This route is explicitly present in the saved source. Confirm it is current and appropriate for this conversation; response rates have not been measured.' : website ? 'Start with the recorded company website to locate its current business contact page. No specific contact form or email has been established.' : 'Research a public business contact before preparing an approach.',
    email: route?.email, channelUrl: route?.url, website, sources: route ? [route.source] : [],
    approach: company.angle || 'Keep the introduction concise and specific to the sourced business context. Ask whether a conversation would be relevant.',
    readiness: hold ? 'hold' : 'review',
    readinessReason: hold ? (conflict ? 'Resolve the contradictory evidence before contacting this company.' : company.structured.synthetic ? 'The saved assessment uses a provisional model. Validate the evidence before contacting this company.' : 'The saved assessment does not establish a contact-ready opportunity. Review the missing evidence first.') : 'The saved assessment supports reviewing an approach. Confirm the recipient, current evidence and draft before use.',
    draft: company.outreach, verifiedFacts, missing,
  };
}
