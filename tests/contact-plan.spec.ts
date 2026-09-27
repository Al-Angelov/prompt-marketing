import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

function seller(name = 'Zeta Machines', id = 'a') {
  const p = JSON.parse(readFileSync('tests/fixtures/market-result.json', 'utf8'));
  p.company = p.report.company.name = name;
  p.report.report_id = id.repeat(24);
  p.report.company.website = 'https://zeta.example';
  p.outreach = `Saved draft for ${name}. Review the evidence before contact.`;
  return p;
}

async function seed(page: Page, reports: ReturnType<typeof seller>[]) {
  await page.goto('http://localhost:5173');
  await page.getByRole('button', { name: 'Potential Sellers', exact: true }).click();
  await expect(page.locator('.library-status')).not.toContainText('Loading');
  await page.evaluate(async entries => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('mergero-research', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('companies', 'readwrite');
        const store = tx.objectStore('companies');
        store.clear();
        for (const report of entries) store.put({ key: JSON.stringify([report.company, report.country, report.industry].map(s => s.trim().toLocaleLowerCase())), report });
        tx.oncomplete = () => { db.close(); resolve() };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, reports);
  await page.reload();
  await page.getByRole('button', { name: 'Outreach', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Outreach plan', exact: true })).toBeVisible();
}

async function selectSeller(page: Page, name: string) {
  const select = page.getByRole('combobox', { name: 'Choose a seller', exact: true });
  await select.selectOption({ label: name });
}

test('contact plan does not invent a named contact, email or social profile when none is saved', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/**', route => { calls++; return route.abort() });
  await seed(page, [seller()]);
  const plan = page.locator('.contact-plan');
  await expect(plan.locator('a[href^="mailto:"]')).toHaveCount(0);
  await expect(plan.locator('a[href*="linkedin.com"]')).toHaveCount(0);
  await expect(plan.locator('a[href="https://zeta.example/"]').first()).toBeVisible();
  await expect(plan.locator('.contact-email')).toHaveCount(0);
  await expect(plan).toContainText(/Hold/i);
  await expect(plan).toContainText('Saved draft for Zeta Machines');
  await expect(plan.locator('.contact-why-now')).toContainText('an external CEO was appointed');
  await expect(plan.locator('.contact-why-now')).toContainText('not evidence that the owner intends to sell');
  await expect(plan.locator('.contact-why-sources a')).toHaveCount(2);
  expect(calls).toBe(0);
});

test('literal official-company business email includes its saved evidence provenance', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/**', route => { calls++; return route.abort() });
  const p = seller();
  p.evidence[0].sources.push({ url: 'https://zeta.example/contact', title: 'Zeta official contact page', published_at: '2026-01-15', excerpt: 'For business enquiries contact office@zeta.example.', independent: false });
  await seed(page, [p]);
  const plan = page.locator('.contact-plan');
  await expect(plan.locator('.contact-email')).toContainText('office@zeta.example');
  await expect(plan.getByRole('button', { name: 'Copy email address', exact: true })).toBeVisible();
  await plan.locator('.contact-provenance > summary').filter({ hasText: 'Sources behind this plan' }).click();
  await expect(plan.locator('a[href="https://zeta.example/contact"]').first()).toBeVisible();
  await expect(plan).toContainText('For business enquiries contact office@zeta.example.');
  await expect(plan).toContainText(/Hold/i);
  expect(calls).toBe(0);
});

test('unsupported contact routes and email header injection never produce contact links', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/**', route => { calls++; return route.abort() });
  const p = seller();
  p.report.contact_routes = [
    { name: 'Unsupported Person', role: 'Owner', channel: 'email', email: 'owner@zeta.example', source_url: 'https://unknown.example/list', source_excerpt: 'owner@zeta.example' },
    { name: 'Invented from annotation', channel: 'email', email: 'invented@zeta.example', source_url: p.evidence[0].sources[0].url, source_excerpt: 'invented@zeta.example' },
    { name: 'Unsafe route', role: 'Owner', channel: 'linkedin', url: 'javascript:alert(1)', source_url: 'https://zeta.example', source_excerpt: 'LinkedIn contact' },
    { role: 'Office', channel: 'email', email: 'office@zeta.example\r\nbcc:other@example.com', source_url: 'https://zeta.example', source_excerpt: 'office@zeta.example\r\nbcc:other@example.com' },
  ];
  await seed(page, [p]);
  const plan = page.locator('.contact-plan');
  await expect(plan.locator('a[href^="mailto:"]')).toHaveCount(0);
  await expect(plan.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(plan.locator('.contact-email')).toHaveCount(0);
  await expect(plan).not.toContainText('Unsupported Person');
  expect(calls).toBe(0);
});

test('switching sellers replaces the saved draft and clears copy feedback', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/**', route => { calls++; return route.abort() });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (value: string) => { (window as unknown as { copiedText: string }).copiedText = value } } });
  });
  const first = seller('First seller', 'a'), second = seller('Second seller', 'b');
  await seed(page, [first, second]);
  await selectSeller(page, 'First seller');
  const plan = page.locator('.contact-plan');
  await plan.getByRole('button', { name: 'Copy message', exact: true }).click();
  await expect(plan.locator('.contact-copy-status')).toContainText('Draft copied');
  expect(await page.evaluate(() => (window as unknown as { copiedText: string }).copiedText)).toBe(first.outreach);
  await selectSeller(page, 'Second seller');
  await expect(plan.locator('.contact-copy-status')).toBeEmpty();
  await expect(plan.locator('.contact-draft-text')).toHaveText(second.outreach);
  await expect(plan.locator('.contact-draft-text')).not.toContainText('First seller');
  await plan.getByRole('button', { name: 'Copy message', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { copiedText: string }).copiedText)).toBe(second.outreach);
  expect(calls).toBe(0);
});

test('named recipients and profile URLs require exact archived evidence rather than substring matches', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/**', route => { calls++; return route.abort() });
  const p = seller('Name substring', 'a');
  p.evidence[0].sources.push({ url: 'https://zeta.example/contact', title: 'Official contact page', published_at: '2026-01-15', excerpt: 'Planning enquiries: office@zeta.example. Profile: https://www.linkedin.com/in/alice-smith', independent: false });
  p.report.contact_routes = [
    { name: 'Ann', role: 'Owner', channel: 'email', email: 'office@zeta.example', source_url: 'https://zeta.example/contact' },
  ];
  const profile = seller('Profile substring', 'b');
  profile.evidence[0].sources.push({ url: 'https://zeta.example/team', title: 'Company team', published_at: '2026-01-15', excerpt: 'Profile: https://www.linkedin.com/in/alice-smith', independent: false });
  profile.report.contact_routes = [{ name: 'Alice', channel: 'linkedin', url: 'https://www.linkedin.com/in/alice', source_url: 'https://zeta.example/team' }];
  await seed(page, [p, profile]);
  await selectSeller(page, 'Name substring');
  const plan = page.locator('.contact-plan');
  await expect(plan.locator('.contact-columns > section').first().locator('h3')).not.toHaveText(/^Ann/);
  await expect(plan.locator('.contact-email')).toContainText('office@zeta.example');
  await selectSeller(page, 'Profile substring');
  await expect(plan.locator('a[href="https://www.linkedin.com/in/alice"]')).toHaveCount(0);
  await expect(plan.locator('.contact-columns > section').nth(1).locator('h3')).toHaveText('Official company website');
  expect(calls).toBe(0);
});

test('an explicitly recorded named contact keeps the exact name, address and source', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/**', route => { calls++; return route.abort() });
  const p = seller();
  p.evidence[0].sources.push({ url: 'https://zeta.example/team', title: 'Leadership contact', published_at: '2026-01-15', excerpt: 'Jane Smith, Managing Director. Business enquiries: jane.smith@zeta.example.', independent: false });
  p.report.contact_routes = [{ name: 'Jane Smith', role: 'Managing Director', channel: 'email', email: 'jane.smith@zeta.example', source_url: 'https://zeta.example/team' }];
  await seed(page, [p]);
  const plan = page.locator('.contact-plan');
  await expect(plan.locator('.contact-columns > section').first().locator('h3')).toContainText('Jane Smith');
  await expect(plan.locator('.contact-email')).toContainText('jane.smith@zeta.example');
  await plan.locator('.contact-provenance > summary').filter({ hasText: 'Sources behind this plan' }).click();
  await expect(plan.locator('a[href="https://zeta.example/team"]').first()).toBeVisible();
  expect(calls).toBe(0);
});

test('saved contact plans remain available without a regional checklist and survive reload', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/**', route => { calls++; return route.abort() });
  const p = seller();
  delete p.report.market_context;
  await seed(page, [p]);
  await expect(page.locator('.contact-plan')).toContainText(p.outreach);
  await expect(page.getByRole('heading', { name: 'Regional metrics aren’t available yet.', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Outreach', exact: true }).click();
  await expect(page.locator('.contact-plan')).toContainText(p.outreach);
  expect(calls).toBe(0);
});

test('exactly sourced LinkedIn profile stays clickable with provenance and without invented email', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/**', route => { calls++; return route.abort() });
  const p = seller();
  p.evidence[0].sources.push({ url: 'https://zeta.example/team', title: 'Official leadership page', published_at: '2026-01-15', excerpt: 'Jane Smith, Managing Director. Profile: https://www.linkedin.com/in/jane-smith.', independent: false });
  p.report.contact_routes = [{ name: 'Jane Smith', role: 'Managing Director', channel: 'linkedin', url: 'https://www.linkedin.com/in/jane-smith', source_url: 'https://zeta.example/team' }];
  await seed(page, [p]);
  const plan = page.locator('.contact-plan');
  await expect(plan.locator('a[href="https://www.linkedin.com/in/jane-smith"]')).toBeVisible();
  await expect(plan.locator('a[href="https://www.linkedin.com/in/jane-smith"]')).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(plan.locator('.contact-columns > section').first().locator('h3')).toContainText('Jane Smith');
  await expect(plan.locator('.contact-email')).toHaveCount(0);
  expect(calls).toBe(0);
});

test('malformed email tokens in archived excerpts are not promoted to business addresses', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/**', route => { calls++; return route.abort() });
  const p = seller();
  p.evidence[0].sources.push({ url: 'https://zeta.example/team', title: 'Archived directory', published_at: '2026-01-15', excerpt: 'Malformed entries: .office@zeta.example, office.@zeta.example, a..b@zeta.example, bad@office@zeta.example.', independent: false });
  await seed(page, [p]);
  await expect(page.locator('.contact-plan .contact-email')).toHaveCount(0);
  expect(calls).toBe(0);
});

test('backend hold, contradictory evidence and synthetic model each prevent a ready contact plan', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/**', route => { calls++; return route.abort() });
  const held = seller('Backend hold', 'a');
  held.evidence = held.evidence.filter((e: { status: string }) => e.status !== 'Conflicting');
  const conflicts = seller('Conflicting evidence', 'b');
  conflicts.contact = true;
  const synthetic = seller('Synthetic model', 'c');
  synthetic.contact = true;
  synthetic.evidence = synthetic.evidence.filter((e: { status: string }) => e.status !== 'Conflicting');
  synthetic.structured.synthetic = true;
  await seed(page, [held, conflicts, synthetic]);
  for (const name of ['Backend hold', 'Conflicting evidence', 'Synthetic model']) {
    await selectSeller(page, name);
    await expect(page.locator('.contact-plan')).toContainText(/Hold/i);
    await expect(page.locator('.contact-plan')).not.toContainText(/Ready to contact/i);
  }
  expect(calls).toBe(0);
});
