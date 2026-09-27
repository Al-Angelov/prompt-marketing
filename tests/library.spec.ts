import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

function company(name: string, priority: number | null, country: string, industry: string, date: string, id: string) {
  const report = JSON.parse(readFileSync('tests/fixtures/market-result.json', 'utf8'));
  Object.assign(report, { company: name, priority, country, industry });
  Object.assign(report.report, { priority_score: priority, generated_at: date, report_id: id.repeat(24) });
  Object.assign(report.report.company, { name, country, industry });
  return report;
}

const reports = () => [
  company('Zeta Machines', 82, 'Germany', 'Industrial manufacturing', '2025-01-01T00:00:00Z', 'a'),
  company('Alpha Software', 30, 'Sweden', 'Software', '2025-03-01T00:00:00Z', 'b'),
  company('Beta Energy', 0, 'Finland', 'Energy', '2025-02-01T00:00:00Z', 'c'),
  company('Delta Health', null, 'Denmark', 'Healthcare', '2025-04-01T00:00:00Z', 'd'),
];

test('a newer registry screen cannot overwrite saved deep research', async ({ page }) => {
  await page.route('**/api/**', route => route.abort());
  const deep = reports()[0];
  await openLibrary(page, [deep]);
  const screen = structuredClone(deep);
  screen.provenance = 'Official registry screen';
  screen.report.generated_at = '2026-09-27T00:00:00Z';
  screen.evidence = []; screen.outreach = null;
  const backup = { format: 'mergero-research-library', version: 1, reports: [screen] };
  await page.getByLabel('Import library', { exact: true }).setInputFiles({ name: 'screen.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.locator('.library-feedback')).toContainText('Imported 1 company');
  await page.reload();
  await page.getByRole('button', { name: 'Outreach', exact: true }).click();
  await expect(page.locator('.contact-plan')).toBeVisible();
  await expect(page.locator('.contact-draft-text')).toHaveText(deep.outreach);
});

async function openLibrary(page: Page, seeded = reports()) {
  await page.goto('http://localhost:5173');
  await page.getByRole('button', { name: 'Potential Sellers', exact: true }).click();
  await expect(page.locator('.library-status')).not.toContainText('Loading');
  await page.evaluate(async entries => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('mergero-research', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('companies', 'readwrite');
        const store = transaction.objectStore('companies');
        store.clear();
        for (const report of entries) store.put({ key: JSON.stringify([report.company, report.country, report.industry].map(s => s.trim().toLocaleLowerCase())), report });
        transaction.oncomplete = () => { db.close(); resolve() };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, seeded);
  await page.reload();
  await page.getByRole('button', { name: 'Potential Sellers', exact: true }).click();
  await expect(page.locator('.library-page .company')).toHaveCount(seeded.length);
}

test('saved sellers rank by backend priority and search locally across company and market', async ({ page }) => {
  let apiCalls = 0;
  await page.route('**/api/**', route => { apiCalls++; return route.abort() });
  await openLibrary(page);
  const names = page.locator('.library-page .company-name h2');
  await expect(names).toHaveText(['Zeta Machines', 'Alpha Software', 'Beta Energy', 'Delta Health']);
  const search = page.getByLabel('Search saved companies', { exact: true });
  for (const [query, result] of [['zEtA', 'Zeta Machines'], [' Sweden ', 'Alpha Software'], ['Healthcare', 'Delta Health']]) {
    await search.fill(query);
    await expect(names).toHaveText([result]);
  }
  await search.fill('no matching company');
  await expect(names).toHaveCount(0);
  await search.fill('');
  await page.getByLabel('Sort saved companies', { exact: true }).selectOption('newest');
  await expect(names).toHaveText(['Delta Health', 'Alpha Software', 'Beta Energy', 'Zeta Machines']);
  await page.getByLabel('Sort saved companies', { exact: true }).selectOption('name');
  await expect(names).toHaveText(['Alpha Software', 'Beta Energy', 'Delta Health', 'Zeta Machines']);
  await page.getByLabel('Sort saved companies', { exact: true }).selectOption('priority');
  await expect(names).toHaveText(['Zeta Machines', 'Alpha Software', 'Beta Energy', 'Delta Health']);
  await page.reload();
  await page.getByRole('button', { name: 'Potential Sellers', exact: true }).click();
  await expect(names).toHaveText(['Zeta Machines', 'Alpha Software', 'Beta Energy', 'Delta Health']);
  expect(apiCalls).toBe(0);
});

test('entire library backup exports beyond filters and imports without losing report evidence', async ({ page }) => {
  let apiCalls = 0;
  await page.route('**/api/**', route => { apiCalls++; return route.abort() });
  await openLibrary(page);
  await page.getByLabel('Search saved companies', { exact: true }).fill('Zeta');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export library', exact: true }).click();
  const download = await downloading;
  const buffer = readFileSync((await download.path())!);
  const backup = JSON.parse(buffer.toString('utf8'));
  expect(backup).toMatchObject({ format: 'mergero-research-library', version: 1 });
  expect(Number.isFinite(Date.parse(backup.exported_at))).toBe(true);
  expect(backup.reports).toHaveLength(4);
  expect([...backup.reports].sort((a, b) => a.company.localeCompare(b.company))).toEqual(reports().sort((a, b) => a.company.localeCompare(b.company)));
  await openLibrary(page, []);
  await page.getByLabel('Import library', { exact: true }).setInputFiles({ name: 'research-backup.json', mimeType: 'application/json', buffer });
  await expect(page.locator('.library-page .company')).toHaveCount(4);
  await expect(page.locator('.library-feedback')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Potential Sellers', exact: true }).click();
  await expect(page.locator('.library-page .company')).toHaveCount(4);
  await page.locator('.library-page .company > summary').first().click();
  await expect(page.locator('.library-page .investigation').first()).toContainText('Contradictory evidence');
  const reportDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).first().click();
  expect(JSON.parse(readFileSync((await (await reportDownload).path())!, 'utf8'))).toEqual(reports()[0].report);
  expect(apiCalls).toBe(0);
});

test('invalid backup rejects the whole import and preserves existing reports after reload', async ({ page }) => {
  let apiCalls = 0;
  await page.route('**/api/**', route => { apiCalls++; return route.abort() });
  await openLibrary(page, [reports()[0]]);
  const invalid = reports()[2];
  invalid.report.priority_score = invalid.priority = 101;
  const backup = { format: 'mergero-research-library', version: 1, exported_at: new Date().toISOString(), reports: [reports()[1], invalid] };
  await page.getByLabel('Import library', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.locator('.library-feedback')).toBeVisible();
  await expect(page.locator('.library-page .company-name h2')).toHaveText(['Zeta Machines']);
  await page.reload();
  await page.getByRole('button', { name: 'Potential Sellers', exact: true }).click();
  await expect(page.locator('.library-page .company-name h2')).toHaveText(['Zeta Machines']);
  expect(apiCalls).toBe(0);
});

test('regional outreach audit exposes saved discovery, citations, metrics and contradictions without research', async ({ page }) => {
  let apiCalls = 0;
  await page.route('**/api/**', route => { apiCalls++; return route.abort() });
  const saved = reports()[0];
  saved.report.company.discovery_source = 'https://registry.example/company/zeta';
  saved.report.verification_method = 'Recorded independent source corroboration';
  await openLibrary(page, [saved]);
  await page.getByRole('button', { name: 'Outreach', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Outreach evidence', exact: true })).toBeVisible();
  await page.locator('.audit-company > summary').click();
  const audit = page.locator('.audit-company-body');
  await expect(audit).toContainText('Recorded independent source corroboration');
  await expect(audit.locator('.audit-discovery a')).toHaveAttribute('href', 'https://registry.example/company/zeta');
  await expect(audit).toContainText('an external CEO was appointed');
  await expect(audit).toContainText('Recorded test evidence for integration checks.');
  await expect(audit).toContainText('2026');
  await expect(audit.locator('.audit-sources a').first()).toHaveAttribute('href', 'https://company.example/leadership');
  await expect(audit.locator('.audit-sources a').first()).toHaveAttribute('rel', 'noopener noreferrer');
  await page.locator('.audit-metrics > summary').click();
  await expect(page.locator('.audit-metrics')).toContainText('120');
  await expect(page.locator('.audit-metrics')).toContainText('report-wide facts');
  await expect(page.locator('.audit-literature')).toContainText('Academic research is not separately identified');
  await page.locator('.signal-menu button').filter({ hasText: 'Independence statement' }).click();
  await expect(page.locator('.audit-company-body')).toContainText('Conflicting');
  await expect(page.locator('.metric-summary')).toContainText('Contradictions');
  expect(apiCalls).toBe(0);
});

test('untrusted optional market context never crashes saved evidence rendering', async ({ page }) => {
  let apiCalls = 0;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => { apiCalls++; return route.abort() });
  const saved = reports()[0];
  saved.report.market_context.summary = { invalid: 'not display text' };
  saved.report.market_context.industry_summary = ['not display text'];
  saved.report.market_context.data_availability = 42;
  await openLibrary(page, [saved]);
  await page.getByRole('button', { name: 'Outreach', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Outreach evidence', exact: true })).toBeVisible();
  await page.locator('.audit-context > summary').click();
  await expect(page.locator('.audit-context')).toBeVisible();
  await expect(page.locator('.audit-context')).not.toContainText('not display text');
  expect(errors).toEqual([]);
  expect(apiCalls).toBe(0);
});

test('duplicate imports retain the newest report regardless of backup order', async ({ page }) => {
  let apiCalls = 0;
  await page.route('**/api/**', route => { apiCalls++; return route.abort() });
  await openLibrary(page, [reports()[0]]);
  const fresh = company('Zeta Machines', 12, 'Germany', 'Industrial manufacturing', '2026-04-01T00:00:00Z', 'a');
  const stale = company('Zeta Machines', 99, 'Germany', 'Industrial manufacturing', '2024-01-01T00:00:00Z', 'a');
  const backup = { format: 'mergero-research-library', version: 1, exported_at: new Date().toISOString(), reports: [fresh, stale] };
  await page.getByLabel('Import library', { exact: true }).setInputFiles({ name: 'duplicates.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.locator('.library-feedback')).toContainText('Imported 1 company');
  await expect(page.locator('.library-page .company')).toHaveCount(1);
  await expect(page.locator('.library-page .priority strong')).toHaveText('12 / 100');
  await page.reload();
  await page.getByRole('button', { name: 'Potential Sellers', exact: true }).click();
  await expect(page.locator('.library-page .company')).toHaveCount(1);
  await expect(page.locator('.library-page .priority strong')).toHaveText('12 / 100');
  expect(apiCalls).toBe(0);
});
