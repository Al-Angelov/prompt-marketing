import { safeUrl, type Opportunity } from './marketApi';

export const mnaDimensions = [
  ['owner_motivation', 'Owner motivation'], ['business_quality', 'Business quality'],
  ['strategic_attractiveness', 'Strategic attractiveness'], ['timing', 'Timing triggers'],
  ['dealability', 'Dealability'], ['economics', 'Valuation / economics'], ['risk', 'Negative evidence / risk'],
] as const;
type Dimension = typeof mnaDimensions[number][0];
export type MnaFinding = { fact: string; sources: string[]; status: string };
export type MnaAssessmentCard = { dimension: string; status: string; summary: string; findings: MnaFinding[]; gaps: string[] };
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const rows = (v: unknown) => Array.isArray(v) ? v.map(record) : [];
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
const strings = (v: unknown) => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && !!s.trim()) : [];
const urls = (v: unknown) => [...new Set(strings(v).filter(u => safeUrl(u)))];
const absence = /^(?:no\b.{0,180}\b(?:found|available|reported|identified|disclosed|listed)|not (?:found|available|disclosed|assessable)|(?:there (?:is|are) )?insufficient evidence|(?:public )?evidence (?:was |is )?not|the (?:claim|signal) is not supported|unknown\b)/i;
const gaps: Record<Dimension, string> = {
  owner_motivation: 'Confirm owner priorities directly; public events do not establish willingness to transact.',
  business_quality: 'Validate earnings quality, recurring revenue, customer concentration and management depth.',
  strategic_attractiveness: 'Validate market position and strategic fit against an actual buyer mandate.',
  timing: 'Establish a dated, company-specific reason to approach now.',
  dealability: 'Confirm ownership, required approvals and transaction restrictions.',
  economics: 'Valuation requires relevant earnings, comparables and owner expectations.',
  risk: 'Complete the risk review; missing negative evidence does not establish a clean diligence outcome.',
};

function savedAssessment(value: unknown): MnaAssessmentCard[] {
  return rows(value).filter(v => mnaDimensions.some(([key]) => v.dimension === key)).map(v => ({
    dimension: String(v.dimension), status: ['supported', 'limited', 'unknown', 'risk'].includes(text(v.status)) ? text(v.status) : 'unknown',
    summary: text(v.summary), gaps: strings(v.gaps),
    findings: rows(v.findings).filter(f => text(f.fact)).map(f => ({ fact: text(f.fact), sources: urls(f.sources), status: text(f.status) || 'Recorded finding' })),
  }));
}

/** Organize archived evidence for display only. Never changes scores, stored reports or verification. */
export function getMnaAssessment(company: Opportunity): { cards: MnaAssessmentCard[]; reconstructed: boolean } {
  const report = record(company.report);
  const saved = savedAssessment(report.mna_assessment);
  if (saved.length) return { cards: saved, reconstructed: false };
  const cards: MnaAssessmentCard[] = mnaDimensions.map(([dimension]) => ({ dimension, status: 'unknown', summary: '', findings: [], gaps: [gaps[dimension]] }));
  function add(dimension: string, fact: string, sources: string[], status = 'Saved source-backed finding', risk = false) {
    const card = cards.find(c => c.dimension === dimension);
    if (!card || !fact || absence.test(fact) || !sources.length || card.findings.some(f => f.fact.toLowerCase() === fact.toLowerCase())) return;
    card.findings.push({ fact, sources, status });
    if (risk) card.status = 'risk';
    else if (card.status !== 'risk') card.status = status === 'Verified' || card.status === 'supported' ? 'supported' : 'limited';
  }
  const factMap: Record<string, [Dimension, string]> = {
    foundedYear: ['business_quality', 'Reported founding year (business history)'],
    revenueK: ['business_quality', 'Reported revenue (EUR thousands)'], employees: ['business_quality', 'Reported employees'],
    ebitdaMargin: ['business_quality', 'Reported EBITDA margin (ratio)'], revenueGrowth3y: ['business_quality', 'Reported three-year revenue CAGR (ratio)'],
    shareholders: ['dealability', 'Reported shareholder count'], familyOwned: ['dealability', 'Family ownership indicator'],
    leverage: ['economics', 'Reported leverage measure'],
  };
  const seenFacts = new Set<string>();
  for (const fact of [...rows(report.structured_facts), ...rows(company.structured.facts)]) {
    const mapping = factMap[text(fact.field)];
    if (!mapping || !['boolean', 'number'].includes(typeof fact.value) || typeof fact.value === 'number' && !Number.isFinite(fact.value)) continue;
    const value = typeof fact.value === 'boolean' ? (fact.value ? 'Yes' : 'No') : String(fact.value);
    const date = text(fact.as_of);
    if (!date || !Number.isFinite(Date.parse(date)) || Date.parse(date) > Date.now()) continue;
    const factKey = JSON.stringify([fact.field, fact.value, date, urls(fact.sources).sort()]);
    if (seenFacts.has(factKey)) continue;
    seenFacts.add(factKey);
    const provenance = text(fact.provenance);
    add(mapping[0], `${mapping[1]}: ${value} (as of ${date}).${provenance ? ` ${provenance}` : ''}`, urls(fact.sources), 'Saved reported fact');
  }
  for (const finding of rows(report.business_findings)) {
    const citations = rows(finding.citations).filter(c => text(c.excerpt));
    const risk = finding.direction === 'negative' || finding.dimension === 'risk' && finding.direction !== 'positive' || citations.some(c => c.stance === 'contradicts');
    add(text(finding.dimension), text(finding.fact), urls(citations.map(c => c.url)), 'Saved source-backed finding', risk);
  }
  for (const gap of rows(report.business_gaps)) {
    const card = cards.find(c => c.dimension === gap.dimension);
    const reason = text(gap.reason);
    if (card && reason && !card.gaps.includes(reason)) card.gaps.push(reason);
  }
  for (const fact of rows(report.conflicting_structured_facts)) {
    add('risk', `Conflicting public values for ${text(fact.field)}; resolve before relying on this metric.`, urls(fact.sources), 'Conflicting', true);
  }
  const rawSignals = [...rows(report.signals), ...rows(report.signal_evidence), ...rows(report.contradictions)];
  const evaluated = [...rows(company.evidence), ...rows(record(report.score_breakdown).evidence_terms)];
  const kindMap: Record<string, Dimension> = { leadership: 'owner_motivation', explicit_exit: 'owner_motivation', liquidity: 'economics', operational: 'business_quality', growth: 'business_quality', partnership: 'strategic_attractiveness' };
  const ids = new Set<string>();
  for (const signal of rawSignals) {
    const id = text(signal.signal_id);
    if (id && ids.has(id)) continue;
    if (id) ids.add(id);
    const evaluation = evaluated.find(e => text(e.id) === id && id);
    // Raw extraction's verification_status is deliberately never promoted to verification.
    const status = evaluation ? text(evaluation.status) : 'Saved source-backed finding';
    const fact = evaluation ? text(evaluation.fact) : text(signal.evidence_found);
    const citations = evaluation ? rows(evaluation.sources) : rows(signal.citations).filter(c => text(c.excerpt));
    const sources = urls(citations.map(c => c.url));
    const risk = signal.direction === 'negative' || status === 'Conflicting' || citations.some(c => c.stance === 'contradicts');
    const dimension = risk ? 'risk' : kindMap[text(signal.kind)];
    if (dimension) add(dimension, fact, sources, status, risk);
    if (!risk && dimension && ['Verified', 'Partially verified'].includes(status) && !(Array.isArray(signal.structured_fields) && signal.structured_fields.length) && citations.some(c => text(c.published_at) && Number.isFinite(Date.parse(text(c.published_at))) && Date.parse(text(c.published_at)) <= Date.now())) add('timing', fact, sources, status);
  }
  for (const card of cards) card.summary = card.findings.length ? `${card.findings.length} saved sourced finding${card.findings.length === 1 ? '' : 's'}; review their original status and remaining gaps.` : 'Not established in the saved evidence.';
  return { cards, reconstructed: true };
}
