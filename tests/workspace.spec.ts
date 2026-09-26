import { test, expect } from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.route('**/api/research/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
 await page.route('**/api/score',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Test: API unavailable'})}));
});

test('prospect research, shortlist, outreach and export workflow', async ({ page }) => {
 const errors: string[]=[]; page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://localhost:5173');
 await expect(page.locator('.company-row')).toHaveCount(8);
 await page.getByRole('button',{name:'Nordics',exact:true}).click();
 await expect(page.locator('.company-row')).toHaveCount(3);
 await expect(page.locator('.detail-company h2')).toContainText('Nordvik');
 await page.getByRole('button',{name:'All Europe',exact:true}).click();
 await page.getByRole('textbox',{name:'Search prospects'}).fill('Hoffmann');
 await expect(page.locator('.company-row')).toHaveCount(1);
 await expect(page.getByRole('button',{name:'Prepare outreach'})).toBeDisabled();
 await expect(page.locator('.detail-content')).toContainText('Insufficient evidence');
 await page.getByRole('textbox',{name:'Search prospects'}).fill('Schneider');
 await page.getByRole('button',{name:'Add to shortlist',exact:true}).click();
 await expect(page.getByRole('button',{name:'Remove from shortlist',exact:true})).toBeVisible();
 await page.locator('.detail-tabs').getByRole('button',{name:/Signals/}).click();
 await expect(page.locator('.detail-content')).toContainText('No live sources connected');
 await page.getByRole('button',{name:'Prepare outreach'}).click();
 await page.getByRole('textbox',{name:'Outreach message'}).fill('Dear Thomas,\nA confidential conversation about your next chapter.');
 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await page.locator('.sidebar nav').getByRole('button',{name:'Outreach',exact:true}).click();
 await expect(page.locator('.draft-row')).toContainText('Schneider');
 await page.reload();
 await page.locator('.sidebar nav').getByRole('button',{name:'Outreach',exact:true}).click();
 await page.getByRole('button',{name:'Review draft'}).click();
 await expect(page.getByRole('textbox',{name:'Outreach message'})).toHaveValue('Dear Thomas,\nA confidential conversation about your next chapter.');
 await page.keyboard.press('Escape');
 await page.locator('.sidebar nav').getByRole('button',{name:/Prospects/}).click();
 const downloadPromise=page.waitForEvent('download');
 await page.getByRole('button',{name:'Export visible prospects'}).click();
 expect((await downloadPromise).suggestedFilename()).toBe('mergero-prospects.csv');
 await page.getByRole('textbox',{name:'Search prospects'}).fill('no-matches');
 await expect(page.getByText('No prospects in this view')).toBeVisible();
 expect(errors).toEqual([]);
});

test('mobile layout fits and navigation works',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('http://localhost:5173');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.getByRole('button',{name:'Open navigation'}).click();
 await page.locator('.sidebar nav').getByRole('button',{name:'Outreach',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Outreach drafts'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('research explains corroboration, penalties and verified outreach',async({page})=>{
 await page.goto('http://localhost:5173');
 await page.getByRole('button',{name:'Discover prospects'}).click();
 await page.getByRole('dialog').getByRole('button',{name:/Schneider Präzisionstechnik/}).click();
 await page.getByRole('button',{name:'Research company',exact:true}).click();
 // Explicit fixtures complete without pretending to perform a timed web search.
 await expect(page.getByRole('button',{name:'Open investigation'})).toBeVisible();
 await expect(page.locator('.research-findings')).toContainText('Conflicting');
 await page.getByRole('button',{name:'Open investigation'}).click();
 await expect(page.locator('.detail-content')).toContainText('90 public-signal points');
 await expect(page.locator('.detail-content')).toContainText('demo fallback');
 await expect(page.locator('.claim-record.conflict')).toContainText('independence');
 await page.locator('.claim-record').first().locator('summary').click();
 await expect(page.locator('.source-excerpt').first()).toContainText('2026-03-18');
 await page.locator('.detail-tabs').getByRole('button',{name:'Why this score?',exact:true}).click();
 await expect(page.locator('.score-factor')).toHaveCount(6);
 await expect(page.locator('.score-total')).toContainText('78 / 100');
 await page.locator('.detail-tabs').getByRole('button',{name:'Outreach',exact:true}).click();
 await expect(page.locator('.message-card')).toContainText('commitment to independence');
 await expect(page.locator('.message-card')).toContainText('no assumption that you are looking to sell');
});

test('unknown company cannot manufacture a score or outreach',async({page})=>{
 await page.goto('http://localhost:5173');
 await page.getByRole('button',{name:'Discover prospects'}).click();
 await page.getByRole('textbox',{name:'Company name'}).fill('Unknown Demo Holdings');
 await page.getByRole('button',{name:'Research company',exact:true}).click();
 await page.getByRole('button',{name:'Open investigation'}).click();
 await expect(page.locator('.detail-company h2')).toContainText('Unknown Demo Holdings');
 await expect(page.locator('.verdict')).toContainText('Do not contact yet');
 await expect(page.getByRole('button',{name:'Prepare outreach'})).toBeDisabled();
 await page.locator('.detail-tabs').getByRole('button',{name:'Outreach',exact:true}).click();
 await expect(page.locator('.detail-content')).toContainText('No outreach is generated');
 await expect(page.locator('.message-card')).toHaveCount(0);
});
