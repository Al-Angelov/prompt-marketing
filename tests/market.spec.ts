import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const result=()=>JSON.parse(readFileSync('tests/fixtures/market-result.json','utf8'));
const id='a'.repeat(32);
const job=(status='complete')=>({id,country:'Germany',industry:'Industrial manufacturing',status,stages:Array(6).fill(status==='complete'?'complete':'running'),results:status==='complete'?[result()]:[],warnings:[],error:null});
async function select(page:any){await page.getByRole('combobox',{name:'Country',exact:true}).fill('Germ');await page.getByRole('option',{name:'Germany',exact:true}).click();await page.getByRole('combobox',{name:'Industry',exact:true}).fill('Industrial');await page.getByRole('option',{name:'Industrial manufacturing',exact:true}).click()}

test('two confirmed inputs start exactly one job; typing never starts research; results progressively disclose evidence',async({page})=>{
 let starts=0,polls=0;const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/investigate-market*',async route=>{if(route.request().method()==='POST'){starts++;expect(route.request().postDataJSON()).toEqual({country:'Germany',industry:'Industrial manufacturing'});await route.fulfill({json:job('running')})}else{polls++;await route.fulfill({json:job()})}});
 await page.goto('http://localhost:5173');await expect(page.getByRole('combobox')).toHaveCount(2);await expect(page.getByRole('button')).toHaveCount(0);
 await page.getByRole('combobox',{name:'Country',exact:true}).fill('Germany');await page.getByRole('combobox',{name:'Industry',exact:true}).fill('Industrial');await page.waitForTimeout(300);expect(starts).toBe(0);
 await select(page);await expect(page.getByRole('heading',{name:'Researching Germany'})).toBeVisible();await expect(page.getByRole('heading',{name:'Integration Test Works'})).toBeVisible();expect(starts).toBe(1);expect(polls).toBe(1);
 await expect(page.getByRole('heading',{name:'Strongest verified signals'})).not.toBeVisible();await page.locator('.company summary').click();
 await expect(page.getByRole('heading',{name:'Contradictory evidence'})).toBeVisible();await expect(page.locator('.score-breakdown')).toContainText('Public evidence contribution');const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download JSON'}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toMatch(/^[a-f0-9]{24}\.json$/);await expect(page.locator('.investigation')).toContainText('independence');await expect(page.locator('.investigation')).toContainText('Do not contact yet');await expect(page.locator('.outreach')).toContainText('external CEO');await expect(page.locator('.sources a').first()).toHaveAttribute('href','https://company.example/leadership');expect(errors).toEqual([]);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/market-mobile.png',fullPage:true});
});
test('keyboard selection and unavailable backend produce a clear recoverable state',async({page})=>{
 await page.route('**/api/investigate-market*',route=>route.fulfill({status:503,json:{detail:'secret internal failure'}}));await page.goto('http://localhost:5173');
 await page.getByRole('combobox',{name:'Country',exact:true}).fill('Germany');await page.keyboard.press('Enter');await page.getByRole('combobox',{name:'Industry',exact:true}).fill('Industrial manufacturing');await page.keyboard.press('Enter');
 await expect(page.getByRole('alert')).toContainText('Research is temporarily unavailable');await expect(page.getByRole('alert')).not.toContainText('secret');await page.getByRole('button',{name:'Change market'}).click();await expect(page.getByRole('combobox')).toHaveCount(2);
});
test('incompatible result is rejected without displaying mismatched companies',async({page})=>{
 await page.route('**/api/investigate-market*',route=>route.fulfill({json:{...job(),country:'Finland'}}));await page.goto('http://localhost:5173');await select(page);await expect(page.getByRole('alert')).toContainText('match these results');await expect(page.locator('.company')).toHaveCount(0);
});
test('mobile landing has only two inputs and no horizontal overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('http://localhost:5173');await expect(page.getByRole('combobox')).toHaveCount(2);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/landing-mobile.png',fullPage:true});
});
test('HTTP journey uses real Python orchestration and Java with recorded research transport',async({page})=>{
 test.skip(!process.env.FULL_STACK_URL,'Requires local recorded Python harness and Java service');let starts=0;const calls:string[]=[];
 page.on('request',req=>{if(req.url().includes('/api/')){calls.push(req.url());if(req.method()==='POST')starts++}});
 await page.goto(process.env.FULL_STACK_URL!);await select(page);await expect(page.getByRole('heading',{name:'Integration Test Works'})).toBeVisible({timeout:60000});await page.locator('.company summary').click();
 await expect(page.locator('.investigation')).toContainText('Company data covers 2 of 11');await expect(page.locator('.investigation')).toContainText('synthetic training');await expect(page.locator('.investigation')).toContainText('Contradictory evidence subtracts 20');await expect(page.locator('.outreach')).toContainText('external CEO');expect(starts).toBe(1);expect(calls.every(url=>url.includes('/api/investigate-market'))).toBe(true);
});
