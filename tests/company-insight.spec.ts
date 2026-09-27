import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { companyInsight } from '../src/companyInsight';
import { buildContactPlan } from '../src/contactPlan';
const fixture = () => JSON.parse(readFileSync('tests/fixtures/market-result.json', 'utf8'));
// Recorded test inputs reproduce the reported shared-sector failure; these are not real company facts.
function screened(name: string, year: number, points: number) {
  const p = fixture();
  p.company = p.report.company.name = name;
  p.country = p.report.company.country = 'Finland';
  p.priority = p.report.priority_score = 56 + points;
  p.why_now = p.report.why_now = 'Sector owner ageing: 62% of self-employed in this sector are 50+ (1.22x the national average, Eurostat 2025).';
  p.evidence = []; p.report.signals = []; p.report.contradictions = [];
  p.report.score_breakdown.evidence_terms = [];
  p.report.score_breakdown.factors = [
    { label: 'Sector owner ageing', category: 'Sector', points: 6, detail: '62% of self-employed in this sector are 50+', source: 'https://stats.example/sector' },
    { label: 'Firm age', category: 'Company data', points, detail: `Founded ${year}`, source: 'Structured model' },
  ];
  p.structured.facts = p.report.structured_facts = [{field:'foundedYear',value:year,as_of:'2026-01-01',sources:['https://registry.example/company']}];
  p.report.mna_assessment = [];
  return p;
}

test('company-specific negative drivers replace shared sector text without changing archived ratings', () => {
  const companies = [screened('Saved company A', 1980, 3), screened('Saved company B', 1990, 1), screened('Saved company C', 2018, -15)];
  const summaries = companies.map(p => companyInsight(p).summary);
  expect(new Set(summaries).size).toBe(3);
  expect(summaries[2]).toContain('-15.0 screening points');
  expect(summaries.join(' ')).not.toContain('62%');
  expect(companies.map(p => p.priority)).toEqual([59, 57, 41]);
  for (const p of companies) {
    const plan = buildContactPlan(p);
    expect(plan.whyNow).toContain('No company-specific timing trigger');
    expect(plan.conversation).toBe('Not established');
    expect(plan.draft).toBeNull();
    expect(plan.readiness).toBe('hold');
  }
});

test('a dated verified operating event remains visible as why now', () => {
  const p = fixture();
  expect(companyInsight(p).label).toBe('Why now');
  expect(companyInsight(p).whyNow).toContain('external CEO');
  p.evidence.forEach((e: {sources: {published_at:string}[]}) => e.sources.forEach(s => s.published_at = '2099-01-01'));
  expect(companyInsight(p).hasTiming).toBe(false);
});

test('saved Finland-shaped results render distinct explanations and recovered assessment without network', async ({page}) => {
  let requests = 0;
  await page.route('**/api/**', route => { requests++; return route.abort() });
  const reports = [screened('Saved company A', 1980, 3), screened('Saved company B', 1990, 1), screened('Saved company C', 2018, -15)];
  await page.goto('http://localhost:5173');
  await page.getByRole('button', {name:'Potential Sellers',exact:true}).click();
  await expect(page.locator('.library-status')).not.toContainText('Loading');
  await page.getByLabel('Import library',{exact:true}).setInputFiles({name:'saved.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'mergero-research-library',version:1,reports}))});
  await expect(page.locator('.library-feedback')).toContainText('Imported');
  await expect(page.locator('.company > summary .overview')).toHaveCount(3);
  for (const [index, year] of [1980,1990,2018].entries()) await expect(page.locator('.company > summary .overview').nth(index)).toContainText(`Founded ${year}`);
  await expect(page.locator('.company > summary').first()).not.toContainText('62%');
  await expect(page.locator('.company > summary').first()).not.toContainText('typical odds');
  await page.locator('.company > summary').first().click();
  const assessment = page.locator('.mna-assessment').first();
  await expect(assessment).toContainText('Organized from your existing saved evidence');
  await expect(assessment).not.toContainText('Updated assessment available after new research');
  await assessment.locator('.mna-dimension > summary').filter({hasText:'Business quality'}).click();
  await expect(assessment).toContainText('1980');
  expect(requests).toBe(0);
});
