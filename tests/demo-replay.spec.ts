import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const fixture = () => JSON.parse(readFileSync('tests/fixtures/market-result.json', 'utf8'));
const market = { country: 'Germany', industry: 'Industrial manufacturing' };
const complete = (report = fixture()) => ({ id: 'a'.repeat(32), ...market, status: 'complete', stages: Array(6).fill('complete'), results: [report], warnings: [], error: null });
async function seed(page: Page, reports = [fixture()]) {
  await page.goto('http://localhost:5173');
  await page.getByRole('button', { name: 'Potential Sellers', exact: true }).click();
  await expect(page.locator('.library-status')).not.toContainText('Loading');
  await page.getByLabel('Import library', { exact: true }).setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'mergero-research-library', version: 1, reports })) });
  await expect(page.locator('.library-feedback')).toContainText('Imported');
  await page.reload();
}
async function select(page: Page, country = market.country, industry = market.industry) {
  await page.getByRole('combobox', { name: 'Country', exact: true }).fill(country);
  await page.getByRole('option', { name: country, exact: true }).click();
  await page.getByRole('combobox', { name: 'Industry', exact: true }).fill(industry);
  await page.getByRole('option', { name: industry, exact: true }).click();
}

test('saved market opens immediately offline with dates and no research requests', async ({ page, context }) => {
  let requests = 0;
  await page.route('**/api/**', route => { requests++; return route.abort() });
  await seed(page);
  await context.setOffline(true);
  await select(page);
  await expect(page.locator('.search-actions .hint')).toContainText('ready to open instantly');
  await expect(page.locator('.results')).toHaveCount(0);
  await page.getByRole('button', { name: 'Search companies', exact: true }).click();
  await expect(page.locator('.results .company-name h2')).toHaveText('Integration Test Works');
  await expect(page.getByRole('region', { name: 'Saved research' })).toContainText('Research dates:');
  await expect(page.getByRole('region', { name: 'Saved research' })).toContainText('no new research has run');
  await page.locator('.company > summary').click();
  await expect(page.locator('.investigation')).toContainText('Contradictory evidence');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.sidebar')).toHaveClass(/collapsed/);
  await expect.poll(async () => Math.round((await page.locator('.sidebar').boundingBox())!.width)).toBe(64);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/saved-replay-mobile.png' });
  expect(requests).toBe(0);
});

test('only explicit refresh starts fresh research after a saved replay', async ({ page }) => {
  let quick = 0, deep = 0;
  await page.route('**/api/quick-search', route => { quick++; return route.fulfill({ status: 404, json: {} }) });
  await page.route('**/api/investigate-market*', route => { deep++; return route.fulfill({ json: complete() }) });
  await seed(page); await select(page);
  await page.getByRole('button', { name: 'Search companies', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Saved research' })).toBeVisible();
  expect(quick).toBe(0); expect(deep).toBe(0);
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(page.locator('.results .company-name h2')).toHaveText('Integration Test Works');
  await expect(page.getByRole('region', { name: 'Saved research' })).toHaveCount(0);
  expect(quick).toBe(1); expect(deep).toBe(1);
});

test('registry-only saved reports do not substitute for completed research', async ({ page }) => {
  const screen = fixture(); screen.provenance = 'Official registry screen';
  let deep = 0;
  await page.route('**/api/quick-search', route => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/investigate-market*', route => { deep++; return route.fulfill({ json: complete() }) });
  await seed(page, [screen]); await select(page);
  await page.getByRole('button', { name: 'Search companies', exact: true }).click();
  await expect(page.locator('.results .company-name h2')).toHaveText('Integration Test Works');
  expect(deep).toBe(1);
  await expect(page.getByRole('region', { name: 'Saved research' })).toHaveCount(0);
});

test('matching requires both country and industry', async ({ page }) => {
  let deep = 0;
  await page.route('**/api/quick-search', route => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/investigate-market*', route => { deep++; return route.fulfill({ status: 503, json: {} }) });
  await seed(page); await select(page, 'Germany', 'Software');
  await page.getByRole('button', { name: 'Search companies', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(deep).toBe(1);
  await expect(page.getByRole('region', { name: 'Saved research' })).toHaveCount(0);
});

test('search waits for saved library hydration to prevent an accidental paid refresh', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/**', route => { calls++; return route.abort() });
  await seed(page);
  await page.addInitScript(() => {
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args: Parameters<IDBFactory['open']>) {
      const request = original.apply(this, args);
      Object.defineProperty(request, 'onsuccess', { set(callback) {
        request.addEventListener('success', event => {
          (window as unknown as { releaseLibrary: () => void }).releaseLibrary = () => callback.call(request, event);
        });
      } });
      return request;
    };
  });
  await page.reload(); await select(page);
  await expect(page.getByRole('button', { name: 'Search companies', exact: true })).toBeDisabled();
  await expect(page.locator('.search-actions .hint')).toContainText('Checking your saved research');
  expect(calls).toBe(0);
  await page.evaluate(() => (window as unknown as { releaseLibrary: () => void }).releaseLibrary());
  await expect(page.getByRole('button', { name: 'Search companies', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Search companies', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Saved research' })).toBeVisible();
  expect(calls).toBe(0);
});

test('a slow registry does not delay research or overwrite completed reports', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve });
  const screened = fixture(); screened.company = screened.report.company.name = 'Registry-only fallback'; screened.provenance = 'Official registry screen';
  await page.route('**/api/quick-search', async route => { await gate; await route.fulfill({ json: { ...complete(screened), mode: 'quick' } }) });
  await page.route('**/api/investigate-market*', route => route.fulfill({ json: complete() }));
  await page.goto('http://localhost:5173'); await select(page);
  await page.getByRole('button', { name: 'Search companies', exact: true }).click();
  await expect(page.locator('.results .company-name h2')).toHaveText('Integration Test Works');
  release();
  await expect(page.locator('.results .company-name h2')).toHaveText('Integration Test Works');
  await expect(page.getByRole('button', { name: 'Change market', exact: true })).toBeEnabled();
});

test('registry results remain available when research fails before the screen arrives', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve });
  const screened = fixture(); screened.provenance = 'Official registry screen';
  await page.route('**/api/quick-search', async route => { await gate; await route.fulfill({ json: { ...complete(screened), mode: 'quick' } }) });
  await page.route('**/api/investigate-market*', route => route.fulfill({ status: 503, json: {} }));
  await page.goto('http://localhost:5173'); await select(page);
  const deepResponse = page.waitForResponse('**/api/investigate-market');
  await page.getByRole('button', { name: 'Search companies', exact: true }).click();
  await deepResponse; release();
  await expect(page.locator('.results .company-name h2')).toHaveText('Integration Test Works');
  await expect(page.locator('.deep-status')).toContainText('Deep research is unavailable');
  await expect(page.getByRole('button', { name: 'Change market', exact: true })).toBeEnabled();
});

test('failed updates preserve the saved shortlist and disclose the failure', async ({ page }) => {
  await page.route('**/api/quick-search', route => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/investigate-market*', route => route.fulfill({ status: 503, json: {} }));
  await seed(page); await select(page);
  await page.getByRole('button', { name: 'Search companies', exact: true }).click();
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Saved research' })).toContainText('Update unavailable');
  await expect(page.locator('.results .company-name h2')).toHaveText('Integration Test Works');
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
