import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { getMnaAssessment } from '../src/legacyAssessment';
const fixture = () => JSON.parse(readFileSync('tests/fixtures/market-result.json', 'utf8'));

test('archived facts and evaluated evidence form seven dimensions without changing the report', () => {
  const company = fixture();
  const before = JSON.stringify(company);
  const { cards, reconstructed } = getMnaAssessment(company);
  expect(reconstructed).toBe(true);
  expect(cards).toHaveLength(7);
  expect(cards.find(c => c.dimension === 'business_quality')?.findings).toEqual(expect.arrayContaining([
    expect.objectContaining({ fact: expect.stringContaining('Reported revenue (EUR thousands): 24000'), status: 'Saved reported fact', sources: ['https://company.example/leadership'] }),
  ]));
  expect(cards.find(c => c.dimension === 'owner_motivation')?.findings).toEqual(expect.arrayContaining([
    expect.objectContaining({ fact: 'an external CEO was appointed', status: 'Verified' }),
  ]));
  expect(cards.find(c => c.dimension === 'timing')?.status).toBe('supported');
  expect(cards.find(c => c.dimension === 'risk')?.status).toBe('risk');
  expect(cards.find(c => c.dimension === 'economics')?.status).toBe('unknown');
  expect(JSON.stringify(company)).toBe(before);
});

test('raw self-verification, sector context, absent claims and missing sources never create verified coverage', () => {
  const company = fixture();
  company.evidence = [];
  company.report.score_breakdown.evidence_terms = [];
  company.structured.facts = [];
  company.report.structured_facts = [
    { field: 'ownerAge', value: 67, as_of: '2026-01-01', sources: ['https://company.example/people'] },
    { field: 'employees', value: 50, as_of: '', sources: ['https://company.example/people'] },
    { field: 'revenueK', value: 4000, as_of: '2026-01-01', sources: ['javascript:alert(1)'] },
  ];
  company.report.contradictions = [];
  company.report.signals = [
    { signal_id: 'raw', kind: 'leadership', verification_status: 'verified', evidence_found: 'Jane was appointed CEO.', citations: [{ url: 'https://company.example/people', excerpt: 'Jane was appointed CEO.', published_at: '2026-01-01' }] },
    { signal_id: 'absent', kind: 'leadership', direction: 'negative', evidence_found: 'No public succession evidence was found.', citations: [{ url: 'https://company.example/people', excerpt: 'No public succession evidence was found.' }] },
    { signal_id: 'sector', kind: 'context', evidence_found: '62% of sector owners are aged 50+.', citations: [{ url: 'https://stats.example/sector', excerpt: '62% of sector owners are aged 50+.' }] },
  ];
  const { cards } = getMnaAssessment(company);
  expect(cards.find(c => c.dimension === 'owner_motivation')?.status).toBe('limited');
  expect(cards.find(c => c.dimension === 'owner_motivation')?.findings[0].status).toBe('Saved source-backed finding');
  expect(cards.find(c => c.dimension === 'timing')?.findings).toEqual([]);
  expect(cards.find(c => c.dimension === 'risk')?.status).toBe('unknown');
  expect(cards.find(c => c.dimension === 'business_quality')?.findings).toEqual([]);
  expect(JSON.stringify(cards)).not.toContain('62%');
});

test('saved ownership facts retain provenance and business extraction retains source-backed status', () => {
  const company = fixture();
  company.report.structured_facts = [
    { field: 'familyOwned', value: true, as_of: '2025-12-31', provenance: 'Reported family ownership.', sources: ['https://company.example/about'] },
    { field: 'shareholders', value: 3, as_of: '2025-12-31', provenance: 'Register count.', sources: ['https://register.example/company'] },
  ];
  company.report.business_findings = [{ dimension: 'strategic_attractiveness', fact: 'Patented industrial process.', citations: [{ url: 'https://company.example/patent', excerpt: 'Patented industrial process.' }] }];
  const { cards } = getMnaAssessment(company);
  expect(cards.find(c => c.dimension === 'dealability')?.findings).toHaveLength(2);
  expect(cards.find(c => c.dimension === 'dealability')?.status).toBe('limited');
  expect(cards.find(c => c.dimension === 'dealability')?.findings[0].fact).toContain('Reported family ownership.');
  expect(cards.find(c => c.dimension === 'strategic_attractiveness')?.findings[0].status).toBe('Saved source-backed finding');
});
