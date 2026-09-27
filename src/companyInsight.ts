import { safeUrl, type Opportunity } from './marketApi';

const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const normalize = (s: string) => s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const absent = (s: string) => /^(?:no\b.{0,180}\b(?:found|available|reported|identified|disclosed)|not (?:found|available|assessable)|insufficient evidence)/i.test(s.trim());
const sectorText = (s: string) => /sector (?:owner|workforce) ageing|self-employed in this sector|national average,? Eurostat/i.test(s);

/** Present archived company evidence without turning demographics into sale intent. */
export function companyInsight(company: Opportunity) {
  const report = record(company.report);
  const rawSignals = Array.isArray(report.signals) ? report.signals.map(record) : [];
  const matching = company.evidence.filter(e => {
    if (!e.fact || absent(e.fact) || sectorText(e.fact) || e.status !== 'Verified') return false;
    const raw = rawSignals.find(s => s.signal_id === e.id);
    if (!raw || !['leadership', 'explicit_exit', 'liquidity', 'operational', 'growth', 'partnership'].includes(String(raw.kind))
        || raw.direction !== 'positive' || Array.isArray(raw.structured_fields) && raw.structured_fields.length) return false;
    return e.sources.some(s => safeUrl(s.url) && s.published_at && Number.isFinite(Date.parse(s.published_at)) && Date.parse(s.published_at) <= Date.now());
  });
  const original = normalize(company.why_now);
  const timing = matching.find(e => original.includes(normalize(e.fact!)) || normalize(e.fact!).includes(original)) || matching[0];
  const whyNow = timing?.fact || 'No company-specific timing trigger has been established.';
  if (timing) return { label: 'Why now', summary: timing.fact!, whyNow, hasTiming: true };

  const findings = Array.isArray(report.business_findings) ? report.business_findings.map(record) : [];
  const grounded = findings.filter(f => typeof f.fact === 'string' && !absent(f.fact) && !sectorText(f.fact)
    && Array.isArray(f.citations) && f.citations.some(c => typeof record(c).url === 'string' && safeUrl(String(record(c).url)) && typeof record(c).excerpt === 'string' && String(record(c).excerpt).trim()));
  const finding = grounded.find(f => f.direction === 'negative' || f.dimension === 'risk') || grounded[0];
  if (finding) return { label: 'Company evidence', summary: String(finding.fact), whyNow, hasTiming: false };

  const factors = company.report.score_breakdown.factors.filter(f =>
    f.category !== 'Sector' && !/^Sector /i.test(f.label) && !!f.detail?.trim() && Math.abs(f.points) > .05);
  const strongest = [...factors].sort((a, b) => Math.abs(b.points) - Math.abs(a.points))[0];
  if (strongest) return { label: 'Screening basis', summary: `${strongest.label}: ${strongest.detail}. ${strongest.points > 0 ? '+' : ''}${strongest.points.toFixed(1)} screening points.`, whyNow, hasTiming: false };

  const labels: Record<string, string> = { revenueK: 'Revenue (EUR thousands)', employees: 'Employees', foundedYear: 'Founded', familyOwned: 'Family ownership', shareholders: 'Shareholders', ebitdaMargin: 'EBITDA margin', revenueGrowth3y: 'Revenue growth', leverage: 'Leverage' };
  const facts = company.structured.facts.filter(f => labels[f.field] && f.sources.some(s => safeUrl(s)) && Number.isFinite(Date.parse(f.as_of)) && Date.parse(f.as_of) <= Date.now());
  if (facts.length) return { label: 'Recorded company facts', summary: facts.slice(0, 2).map(f => `${labels[f.field]}: ${typeof f.value === 'boolean' ? f.value ? 'yes' : 'no' : f.value.toLocaleString()} (as of ${f.as_of})`).join('; '), whyNow, hasTiming: false };
  return { label: 'Evidence gap', summary: `The saved research for ${company.company} does not establish a company-specific reason to prioritise outreach.`, whyNow, hasTiming: false };
}

export function priorityExplanation(company: Opportunity) {
  const factors = company.report.score_breakdown.factors;
  const companyFactors = factors.filter(f => f.category !== 'Sector' && !/^Sector /i.test(f.label));
  const drivers = [...companyFactors].sort((a,b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 3)
    .map(f => `${f.label} ${f.points >= 0 ? '+' : ''}${f.points.toFixed(1)}`).join('; ');
  return `Provisional screening score based on saved inputs. ${drivers ? `Company drivers: ${drivers}.` : 'No differentiating company factors were recorded.'} Sector factors are shared market context. This score is not a measured sale probability; missing data reduces confidence.`;
}
