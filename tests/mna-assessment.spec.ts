import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const result = () => JSON.parse(readFileSync('tests/fixtures/market-result.json', 'utf8'));
async function openReport(page: Page, company: ReturnType<typeof result>) {
  await page.route('**/api/**', route => route.fulfill(route.request().url().includes('quick-search') ? { status: 404, json: {} } : { json: { id: 'a'.repeat(32), country: 'Germany', industry: 'Industrial manufacturing', status: 'complete', stages: Array(6).fill('complete'), results: [company], warnings: [], error: null } }));
  await page.goto('http://localhost:5173');
  await page.getByRole('combobox', { name: 'Country', exact: true }).fill('Germany');
  await page.getByRole('option', { name: 'Germany', exact: true }).click();
  await page.getByRole('combobox', { name: 'Industry', exact: true }).fill('Industrial');
  await page.getByRole('option', { name: 'Industrial manufacturing', exact: true }).click();
  await page.getByRole('button', { name: 'Search companies', exact: true }).click();
  await page.locator('.company > summary').click();
}
test('saved assessment exposes seven dimensions, sources and risk without inventing unknowns', async ({ page }) => {
  const company = result();
  company.report.mna_assessment = [
    { dimension: 'business_quality', label: 'Business quality', status: 'supported', summary: 'Recorded profitable growth.', findings: [{ fact: 'Revenue grew 8% in the reported year.', sources: ['https://company.example/accounts'], status: 'verified' }], gaps: ['Customer concentration not disclosed.'] },
    { dimension: 'risk', label: 'Negative evidence / risk', status: 'risk', summary: 'Owner made an independence statement.', findings: [{ fact: 'Owner intends to remain independent.', sources: ['https://company.example/statement'], status: 'conflicting' }], gaps: [] },
  ];
  await openReport(page, company);
  await expect(page.locator('.mna-dimension')).toHaveCount(7);
  await expect(page.locator('.mna-heading')).toContainText('2 / 7 dimensions with sourced findings');
  await page.locator('.mna-dimension > summary').filter({ hasText: 'Business quality' }).click();
  await expect(page.getByText('Revenue grew 8% in the reported year.', { exact: true })).toBeVisible();
  await expect(page.locator('.mna-finding a').first()).toHaveAttribute('href', 'https://company.example/accounts');
  await page.locator('.mna-dimension > summary').filter({ hasText: 'Negative evidence / risk' }).click();
  await expect(page.getByText('Owner intends to remain independent.', { exact: true })).toBeVisible();
  await expect(page.locator('.mna-dimension-empty').filter({ hasText: 'Owner motivation' })).toContainText('Not assessed');
  await page.locator('.mna-assessment').screenshot({ path: 'test-results/mna-assessment-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.mna-assessment').screenshot({ path: 'test-results/mna-assessment-mobile.png' });
  await page.getByRole('button', { name: 'Outreach', exact: true }).click();
  await page.getByText('Business and transaction assessment', { exact: true }).click();
  await expect(page.locator('.contact-assessment .mna-dimension')).toHaveCount(7);
});
test('legacy reports preserve sourced findings and collapse truly empty checklist rows', async ({ page }) => {
  const company = result();
  company.evidence.push({ id: 'empty', signal: 'Succession plans not established', fact: null, explanation: 'Independent corroboration not yet performed.', status: 'Insufficient evidence', sources: [] });
  company.evidence.push({ id: 'empty-text', signal: 'Ownership details not established', fact: 'No supporting evidence found.', explanation: 'Not checked.', status: 'Insufficient evidence', sources: [] });
  await openReport(page, company);
  await expect(page.locator('.mna-legacy-note')).toBeVisible();
  await expect(page.locator('.mna-legacy-note')).toContainText('Organized from your existing saved evidence');
  await expect(page.locator('.mna-assessment')).not.toContainText('Not assessed');
  await page.locator('.mna-dimension > summary').filter({ hasText: 'Business quality' }).click();
  await expect(page.locator('.mna-assessment')).toContainText('Reported revenue (EUR thousands): 24000');
  await expect(page.locator('.investigation')).not.toContainText('No supporting evidence found.');
  await expect(page.getByText('Succession plans not established', { exact: true })).not.toBeVisible();
  await expect(page.locator('.company-facts')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Contradictory evidence' })).toBeVisible();
  await page.locator('.research-gaps > summary').click();
  await expect(page.getByText('Succession plans not established', { exact: true })).toBeVisible();
  await expect(page.locator('.research-gaps')).toContainText('They are not negative findings');
});
