export type Source = { url: string; title: string; published_at: string | null; excerpt: string; independent: boolean };
export type Opportunity = {
  company: string; country: string; industry: string; priority: number | null; confidence: string;
  why_now: string; conversation: string; angle: string; explanation: string; outreach: string | null;
  contact: boolean; warnings: string[]; data_gaps: string[];
  evidence: { id: string; signal: string; fact: string | null; status: string; explanation: string; sources: Source[] }[];
  structured: { available: boolean; synthetic: boolean; insight: string; facts: { field: string; value: number | boolean; as_of: string; sources: string[] }[] };
};
export type MarketJob = { id: string; country: string; industry: string; status: 'running' | 'complete' | 'error'; stages: ('pending' | 'running' | 'complete')[]; results: Opportunity[]; warnings: string[]; error: string | null };
export function safeUrl(url: string) { try { const u = new URL(url); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : undefined } catch { return undefined } }
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const sources = (v: unknown) => Array.isArray(v) && v.every(s => object(s) && typeof s.url === 'string' && safeUrl(s.url) && typeof s.title === 'string' && typeof s.excerpt === 'string' && (s.published_at === null || typeof s.published_at === 'string'));
function validOpportunity(v: unknown): v is Opportunity {
  if (!object(v) || !['company', 'country', 'industry', 'confidence', 'why_now', 'conversation', 'angle', 'explanation'].every(k => typeof v[k] === 'string')) return false;
  return (v.priority === null || typeof v.priority === 'number' && Number.isFinite(v.priority) && v.priority >= 0 && v.priority <= 100)
    && (v.outreach === null || typeof v.outreach === 'string') && typeof v.contact === 'boolean' && strings(v.warnings) && strings(v.data_gaps)
    && Array.isArray(v.evidence) && v.evidence.every(e => object(e) && ['id', 'signal', 'status', 'explanation'].every(k => typeof e[k] === 'string') && (e.fact === null || typeof e.fact === 'string') && sources(e.sources))
    && object(v.structured) && typeof v.structured.insight === 'string' && typeof v.structured.available === 'boolean' && typeof v.structured.synthetic === 'boolean'
    && Array.isArray(v.structured.facts) && v.structured.facts.every(f => object(f) && typeof f.field === 'string' && ['number', 'boolean'].includes(typeof f.value) && typeof f.as_of === 'string' && strings(f.sources) && f.sources.every(s => safeUrl(s)));
}
export async function marketRequest(input: { country: string; industry: string } | string, signal: AbortSignal): Promise<MarketJob> {
  const polling = typeof input === 'string';
  const response = await fetch('/api/investigate-market' + (polling ? `?job=${encodeURIComponent(input)}` : ''), {
    method: polling ? 'GET' : 'POST', headers: polling ? undefined : { 'Content-Type': 'application/json' },
    body: polling ? undefined : JSON.stringify(input), signal: AbortSignal.any([signal, AbortSignal.timeout(75000)]),
  });
  if (!response.ok) throw new Error(response.status === 404 ? 'This research session has expired. Please start again.' : 'Research is temporarily unavailable. Please try again later.');
  const v: unknown = await response.json();
  if (!object(v) || typeof v.id !== 'string' || !/^[a-f0-9]{32}$/.test(v.id) || typeof v.country !== 'string' || typeof v.industry !== 'string'
    || !['running', 'complete', 'error'].includes(String(v.status)) || !Array.isArray(v.stages) || v.stages.length !== 6 || !v.stages.every(s => ['pending', 'running', 'complete'].includes(s))
    || !Array.isArray(v.results) || !v.results.every(validOpportunity) || !strings(v.warnings) || !(v.error === null || typeof v.error === 'string')) throw new Error('We couldn’t read the research results. Please try again.');
  return v as MarketJob;
}
