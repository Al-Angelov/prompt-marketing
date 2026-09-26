import { test, expect } from '@playwright/test';

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
 await page.locator('.sidebar nav').getByRole('button',{name:'Market insights'}).click();
 await expect(page.getByRole('heading',{name:'Market coverage'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
