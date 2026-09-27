export type Source = { url: string; title: string; published_at: string | null; excerpt: string; independent: boolean };
export type Factor = { label: string; points: number; category?: string; detail?: string; source?: string | null };
export type RegionalSignal = { id: string; name: string; category: string; why_it_matters_in_region: string; how_to_detect: string; signal_strength: 'strong' | 'medium' | 'weak'; evidence_urls: string[]; not_sale_intent?: string };
export type MarketContext = { summary?: string; industry_summary?: string; data_availability?: string; signals?: RegionalSignal[] };
export type CompanyReport = {
  schema_version: 1; report_id: string; company: { name: string; country: string; industry: string; website?: string | null; company_website?: string | null };
  website?: string | null; company_website?: string | null;
  market_context?: MarketContext;
  priority_score: number; confidence: string; generated_at: string;
  score_breakdown: { public_contribution: number; model_contribution: number; contradiction_penalty: number; model_weight: number; policy_version: string; factors: Factor[];
    sector_contribution?: number; registry_contribution?: number; baseline?: number; likelihood?: number; relative_likelihood?: number; market_base_rate?: number };
  structured_model: {label: string; percentile: number | null};
};
export type Opportunity = {
  report: CompanyReport;
  website?: string | null; company_website?: string | null;
  company: string; country: string; industry: string; priority: number | null; confidence: string;
  why_now: string; conversation: string; angle: string; explanation: string; outreach: string | null;
  contact: boolean; warnings: string[]; data_gaps: string[]; provenance?: string; likelihood?: number; relative_likelihood?: number;
  evidence: { id: string; signal: string; fact: string | null; status: string; explanation: string; sources: Source[] }[];
  structured: { available: boolean; synthetic: boolean; insight: string; facts: { field: string; value: number | boolean; as_of: string; sources: string[] }[] };
};
export type MarketJob = { id: string; country: string; industry: string; status: 'running' | 'complete' | 'error'; stages: ('pending' | 'running' | 'complete')[]; results: Opportunity[]; warnings: string[]; error: string | null;
  mode?: 'quick'; screened?: number; cache_hit?: boolean; duration_s?: number };
export function safeUrl(url: string) { try { const u = new URL(url); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : undefined } catch { return undefined } }
export function companyWebsite(company: Opportunity): string | undefined {
  const values = [company.report.company.website, company.report.company.company_website, company.website, company.company_website, company.report.website, company.report.company_website];
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      const url = safeUrl(value.trim());
      if (url) return url;
    }
  }
}
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const sources = (v: unknown) => Array.isArray(v) && v.every(s => object(s) && typeof s.url === 'string' && safeUrl(s.url) && typeof s.title === 'string' && typeof s.excerpt === 'string' && (s.published_at === null || typeof s.published_at === 'string'));
function validReport(r: unknown, v: Record<string, unknown>): r is CompanyReport {
  if (!object(r) || r.schema_version !== 1 || typeof r.report_id !== 'string' || !/^[a-f0-9]{24}$/.test(r.report_id)
      || !object(r.company) || r.company.name !== v.company || r.company.country !== v.country || r.company.industry !== v.industry
      || r.priority_score !== v.priority || r.confidence !== v.confidence || typeof r.generated_at !== 'string' || !Number.isFinite(Date.parse(r.generated_at))) return false;
  const b = r.score_breakdown;
  return object(b) && ['public_contribution', 'model_contribution', 'contradiction_penalty', 'model_weight'].every(k => typeof b[k] === 'number' && Number.isFinite(b[k]))
    && typeof b.policy_version === 'string' && Array.isArray(b.factors) && b.factors.every(f => object(f) && typeof f.label === 'string' && typeof f.points === 'number' && Number.isFinite(f.points))
    && object(r.structured_model) && typeof r.structured_model.label === 'string' && (r.structured_model.percentile === null || typeof r.structured_model.percentile === 'number' && Number.isFinite(r.structured_model.percentile));
}
export function validOpportunity(v: unknown): v is Opportunity {
  if (!object(v) || !['company', 'country', 'industry', 'confidence', 'why_now', 'conversation', 'angle', 'explanation'].every(k => typeof v[k] === 'string')) return false;
  return validReport(v.report, v) && (v.priority === null || typeof v.priority === 'number' && Number.isFinite(v.priority) && v.priority >= 0 && v.priority <= 100)
    && (v.outreach === null || typeof v.outreach === 'string') && typeof v.contact === 'boolean' && strings(v.warnings) && strings(v.data_gaps)
    && Array.isArray(v.evidence) && v.evidence.every(e => object(e) && ['id', 'signal', 'status', 'explanation'].every(k => typeof e[k] === 'string') && (e.fact === null || typeof e.fact === 'string') && sources(e.sources))
    && object(v.structured) && typeof v.structured.insight === 'string' && typeof v.structured.available === 'boolean' && typeof v.structured.synthetic === 'boolean'
    && Array.isArray(v.structured.facts) && v.structured.facts.every(f => object(f) && typeof f.field === 'string' && ['number', 'boolean'].includes(typeof f.value) && typeof f.as_of === 'string' && strings(f.sources) && f.sources.every(s => safeUrl(s)));
}
function parseJob(v: unknown): MarketJob {
  if (!object(v) || typeof v.id !== 'string' || !/^[a-f0-9]{32}$/.test(v.id) || typeof v.country !== 'string' || typeof v.industry !== 'string'
    || !['running', 'complete', 'error'].includes(String(v.status)) || !Array.isArray(v.stages) || v.stages.length !== 6 || !v.stages.every(s => ['pending', 'running', 'complete'].includes(s))
    || !Array.isArray(v.results) || !v.results.every(validOpportunity) || !strings(v.warnings) || !(v.error === null || typeof v.error === 'string')) throw new Error('We couldn’t read the research results. Please try again.');
  return v as MarketJob;
}
export async function marketRequest(input: { country: string; industry: string } | string, signal: AbortSignal): Promise<MarketJob> {
  const polling = typeof input === 'string';
  const response = await fetch('/api/investigate-market' + (polling ? `?job=${encodeURIComponent(input)}` : ''), {
    method: polling ? 'GET' : 'POST', headers: polling ? undefined : { 'Content-Type': 'application/json' },
    body: polling ? undefined : JSON.stringify(input), signal: AbortSignal.any([signal, AbortSignal.timeout(75000)]),
  });
  if (!response.ok) throw new Error(response.status === 404 ? 'This research session has expired. Please start again.' : 'Research is temporarily unavailable. Please try again later.');
  return parseJob(await response.json());
}
/** Registry-first screen. Resolves to null when no open registry covers the country (deep research only). */
export async function quickSearchRequest(input: { country: string; industry: string }, signal: AbortSignal): Promise<MarketJob | null> {
  const response = await fetch('/api/quick-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('The official register is temporarily unavailable.');
  return parseJob(await response.json());
}
