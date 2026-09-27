import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const result=()=>JSON.parse(readFileSync('tests/fixtures/market-result.json','utf8'));
const id='a'.repeat(32);
test.beforeEach(async ({page}) => { await page.route('**/api/quick-search', route => route.fulfill({status:404,json:{detail:'No registry in recorded test'}})); });
const job=(status='complete')=>({id,country:'Germany',industry:'Industrial manufacturing',status,stages:Array(6).fill(status==='complete'?'complete':'running'),results:status==='complete'?[result()]:[],warnings:[],error:null});
async function select(page:any,start=true){await page.getByRole('combobox',{name:'Country',exact:true}).fill('Germ');await page.getByRole('option',{name:'Germany',exact:true}).click();await page.getByRole('combobox',{name:'Industry',exact:true}).fill('Industrial');await page.getByRole('option',{name:'Industrial manufacturing',exact:true}).click();if(start)await page.getByRole('button',{name:'Search companies',exact:true}).click()}

test('only the search button starts one job; results progressively disclose evidence',async({page})=>{
 let starts=0,polls=0;const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/investigate-market*',async route=>{if(route.request().method()==='POST'){starts++;expect(route.request().postDataJSON()).toEqual({country:'Germany',industry:'Industrial manufacturing'});await route.fulfill({json:job('running')})}else{polls++;await route.fulfill({json:job()})}});
 await page.goto('http://localhost:5173');await expect(page.getByRole('combobox')).toHaveCount(2);await page.screenshot({path:'test-results/landing-desktop.png',fullPage:true});await expect(page.locator('main input')).toHaveCount(2);
 await page.getByRole('combobox',{name:'Country',exact:true}).fill('Germany');await page.getByRole('combobox',{name:'Industry',exact:true}).fill('Industrial');await page.waitForTimeout(300);expect(starts).toBe(0);
 await select(page,false);await page.waitForTimeout(350);expect(starts).toBe(0);await expect(page.getByRole('button',{name:'Search companies',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Search companies',exact:true}).click();await expect(page.getByRole('heading',{name:'Researching Germany'})).toBeVisible();await expect(page.getByRole('heading',{name:'Integration Test Works'})).toBeVisible();expect(starts).toBe(1);expect(polls).toBe(1);
 await expect(page.getByRole('heading',{name:'Strongest verified signals'})).not.toBeVisible();await page.locator('.company > summary').click();
 await expect(page.getByRole('heading',{name:'Contradictory evidence'})).toBeVisible();await expect(page.locator('.score-breakdown')).toContainText('Public evidence');const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download JSON'}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toMatch(/^[a-f0-9]{24}\.json$/);await expect(page.locator('.investigation')).toContainText('independence');await expect(page.locator('.investigation')).toContainText('Do not contact yet');await expect(page.locator('.outreach')).toContainText('external CEO');await expect(page.locator('.sources a').first()).toHaveAttribute('href','https://company.example/leadership');expect(errors).toEqual([]);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/market-mobile.png',fullPage:true});
});
test('keyboard selection and unavailable backend produce a clear recoverable state',async({page})=>{
 await page.route('**/api/investigate-market*',route=>route.fulfill({status:503,json:{detail:'secret internal failure'}}));await page.goto('http://localhost:5173');
 await page.getByRole('combobox',{name:'Country',exact:true}).fill('Germany');await page.keyboard.press('Enter');await page.getByRole('combobox',{name:'Industry',exact:true}).fill('Industrial manufacturing');await page.keyboard.press('Enter');await page.getByRole('button',{name:'Search companies',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Research is temporarily unavailable');await expect(page.getByRole('alert')).not.toContainText('secret');await page.getByRole('button',{name:'Change market'}).click();await expect(page.getByRole('combobox')).toHaveCount(2);
});
test('incompatible result is rejected without displaying mismatched companies',async({page})=>{
 await page.route('**/api/investigate-market*',route=>route.fulfill({json:{...job(),country:'Finland'}}));await page.goto('http://localhost:5173');await select(page);await expect(page.getByRole('alert')).toContainText('match these results');await expect(page.locator('.company')).toHaveCount(0);
});
test('mobile landing has only two inputs and no horizontal overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('http://localhost:5173');await expect(page.getByRole('combobox')).toHaveCount(2);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/landing-mobile.png',fullPage:true});
});
test('sidebar collapses, contextual navigation is honest, and search focuses the existing inputs',async({page})=>{
 let requests=0;await page.route('**/api/investigate-market*',route=>{requests++;return route.abort()});
 await page.goto('http://localhost:5173');
 await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
 await expect(page.locator('.sidebar')).toHaveClass(/collapsed/);
 await page.getByRole('button',{name:'Outreach',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Outreach.'})).toBeVisible();
 await page.getByRole('button',{name:'Potential Sellers',exact:true}).click();
 await expect(page.locator('.context-card')).toContainText('No companies saved yet');
 await page.getByRole('button',{name:'Search markets and industries',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Country',exact:true})).toBeFocused();
 await expect(page.getByRole('combobox')).toHaveCount(2);expect(requests).toBe(0);
});
test('registry screen is saved and a second market stays disabled while deep research runs',async({page})=>{
 const screened=result();screened.provenance='Official registry screen';screened.contact=false;screened.outreach=null;screened.evidence=[];
 const quick={...job(),mode:'quick',screened:1,results:[screened]};
 await page.route('**/api/quick-search',route=>route.fulfill({json:quick}));
 await page.route('**/api/investigate-market*',route=>route.fulfill({json:job('running')}));
 await page.goto('http://localhost:5173');await select(page);
 await expect(page.getByRole('heading',{name:'Integration Test Works'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Change market'})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Search markets and industries'})).toBeDisabled();
 await page.getByRole('button',{name:'Potential Sellers',exact:true}).click();
 await expect(page.locator('.library-page .company')).toHaveCount(1);
 await page.reload();await page.getByRole('button',{name:'Potential Sellers',exact:true}).click();
 await expect(page.locator('.library-page .company')).toHaveCount(1);
});
for(const field of ['website','company_website']){
 test(`company profile exposes a safe clickable ${field} from the report`,async({page})=>{
  const payload=job();delete payload.results[0].report.company.website;
  if(field==='website')payload.results[0].report.company.website='https://www.example.com/company';
  else payload.results[0].company_website='https://www.example.com/company';
  await page.route('**/api/investigate-market*',route=>route.fulfill({json:payload}));
  await page.goto('http://localhost:5173');await select(page);await page.locator('.company > summary').click();
  const link=page.getByRole('link',{name:/Visit company website/});await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href','https://www.example.com/company');await expect(link).toHaveAttribute('target','_blank');
  await expect(link).toHaveAttribute('rel','noopener noreferrer');
  await page.screenshot({path:`test-results/profile-${field}.png`,fullPage:true});
 });
}
test('unsafe company websites never become clickable links',async({page})=>{
 const payload=job();payload.results[0].report.company.website='javascript:alert(1)';payload.results[0].company_website='https://secret:password@example.com';
 await page.route('**/api/investigate-market*',route=>route.fulfill({json:payload}));await page.goto('http://localhost:5173');await select(page);await page.locator('.company > summary').click();
 await expect(page.getByRole('link',{name:/Visit company website/})).toHaveCount(0);await expect(page.locator('.website-unavailable')).toBeVisible();
});
test('HTTP journey uses real Python orchestration and Java with recorded research transport',async({page})=>{
 test.skip(!process.env.FULL_STACK_URL,'Requires local recorded Python harness and Java service');let starts=0;const calls:string[]=[];
 page.on('request',req=>{if(req.url().includes('/api/')){calls.push(req.url());if(req.method()==='POST')starts++}});
 await page.goto(process.env.FULL_STACK_URL!);await select(page);await expect(page.getByRole('heading',{name:'Integration Test Works'})).toBeVisible({timeout:60000});await page.locator('.company > summary').click();
 await expect(page.locator('.investigation')).toContainText('Company data covers 2 of 11');
 await expect(page.locator('.investigation')).toContainText('synthetic training');
 const penalty = page.locator('.score-breakdown > div').filter({has:page.locator('dt', {hasText:'Contradictions'})}).locator('dd');
 await expect(penalty).toHaveText('-14.6');
 await expect(page.locator('.mna-dimension')).toHaveCount(7);
 await page.locator('.mna-dimension > summary').filter({hasText:'Business quality'}).click();
 await expect(page.locator('.mna-assessment')).toContainText('recurring maintenance contracts');
 await expect(page.locator('.outreach')).toContainText('external CEO');
 expect(starts).toBe(2); // Registry screen (unsupported) then one deep investigation.
 expect(calls.every(url=>url.includes('/api/investigate-market') || url.includes('/api/quick-search'))).toBe(true);
});

test('saved companies survive reload, retain reports, and deduplicate repeated research',async({page})=>{
 let starts=0;await page.route('**/api/investigate-market*',route=>{if(route.request().method()==='POST')starts++;return route.fulfill({json:job()})});
 await page.goto('http://localhost:5173');await select(page);await expect(page.getByRole('heading',{name:'Integration Test Works'})).toBeVisible();
 await page.getByRole('button',{name:'Potential Sellers',exact:true}).click();
 await expect(page.locator('.library-page .company')).toHaveCount(1);await expect(page.locator('.library-page')).toContainText('Germany · Industrial manufacturing');
 await page.reload();await page.getByRole('button',{name:'Potential Sellers',exact:true}).click();await expect(page.locator('.library-page .company')).toHaveCount(1);
 await page.locator('.library-page .company > summary').click();await expect(page.locator('.library-page .score-breakdown')).toContainText('Public evidence');expect(starts).toBe(1);
 await page.getByRole('button',{name:'Search markets and industries',exact:true}).click();await select(page);await expect(page.getByRole('heading',{name:'Integration Test Works'})).toBeVisible();
 await page.getByRole('button',{name:'Potential Sellers',exact:true}).click();await expect(page.locator('.library-page .company')).toHaveCount(1);expect(starts).toBe(2);
 await page.screenshot({path:'test-results/saved-companies-desktop.png',fullPage:true});
});

test('regional metric menu uses saved research and switches the visible evidence',async({page})=>{
 await page.route('**/api/investigate-market*',route=>route.fulfill({json:job()}));await page.goto('http://localhost:5173');await select(page);await expect(page.getByRole('heading',{name:'Integration Test Works'})).toBeVisible();
 await page.getByRole('button',{name:'Outreach',exact:true}).click();
 await expect(page.locator('.signal-menu button')).toHaveCount(5);await expect(page.locator('.signal-detail')).toContainText('CEO handover');
 await expect(page.getByLabel('Regional signal strength: strong')).toBeVisible();await expect(page.locator('.metric-summary')).toContainText('Verified findings');
 await page.locator('.signal-menu button').filter({hasText:'Independence statement'}).click();await expect(page.locator('.signal-detail h2')).toHaveText('Independence statement');
 await expect(page.locator('.metric-summary div').filter({hasText:'Contradictions'}).locator('dd')).toHaveText('1');
 await page.screenshot({path:'test-results/regional-signals-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.waitForTimeout(300);await page.screenshot({path:'test-results/regional-signals-mobile.png',fullPage:true});
 await page.reload();await page.getByRole('button',{name:'Outreach',exact:true}).click();await expect(page.locator('.signal-menu button')).toHaveCount(5);
});

test('storage failure keeps companies usable and discloses session-only saving',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(window,'indexedDB',{value:{open(){throw new Error('Storage disabled')}}}));
 await page.route('**/api/investigate-market*',route=>route.fulfill({json:job()}));await page.goto('http://localhost:5173');await select(page);await expect(page.getByRole('heading',{name:'Integration Test Works'})).toBeVisible();
 await page.getByRole('button',{name:'Potential Sellers',exact:true}).click();await expect(page.locator('.library-page .company')).toHaveCount(1);await expect(page.locator('.library-status')).toContainText('session only');
});

test('editing a confirmed selector disables search until reconfirmed',async({page})=>{
 let starts=0;await page.route('**/api/investigate-market*',route=>{starts++;return route.abort()});await page.goto('http://localhost:5173');
 await expect(page.getByRole('button',{name:'Search companies',exact:true})).toBeDisabled();await select(page,false);
 await page.getByRole('combobox',{name:'Country',exact:true}).fill('Swed');await expect(page.getByRole('button',{name:'Search companies',exact:true})).toBeDisabled();
 await page.getByRole('option',{name:'Sweden',exact:true}).click();await expect(page.getByRole('button',{name:'Search companies',exact:true})).toBeEnabled();expect(starts).toBe(0);
});

test('regional counts do not combine reused signal IDs from different checklists',async({page})=>{
 const payload=job();const older=result();older.company=older.report.company.name='Earlier company';older.report.report_id='b'.repeat(24);older.report.generated_at='2020-01-01T00:00:00Z';
 older.report.market_context.signals[0].name='Unrelated metric';payload.results.push(older);
 await page.route('**/api/investigate-market*',route=>route.fulfill({json:payload}));await page.goto('http://localhost:5173');await select(page);
 await expect(page.getByRole('heading',{name:'Integration Test Works'})).toBeVisible();await page.getByRole('button',{name:'Outreach',exact:true}).click();
 await expect(page.locator('.metric-summary div').filter({hasText:'Verified findings'}).locator('dd')).toHaveText('1');await expect(page.locator('.signal-detail')).toContainText('Counts cover 1 saved company');
});

test('corrupted saved entries are ignored and replaced by valid completed research',async({page})=>{
 await page.goto('http://localhost:5173');await page.getByRole('button',{name:'Potential Sellers',exact:true}).click();await expect(page.locator('.library-status')).toContainText('Saved on this device');
 const invalid=result();invalid.report.generated_at='not-a-date';
 await page.evaluate(async report=>{await new Promise<void>((resolve,reject)=>{const open=indexedDB.open('mergero-research',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result;const transaction=db.transaction('companies','readwrite');const store=transaction.objectStore('companies');store.put({key:'malformed'});store.put({key:JSON.stringify([report.company,report.country,report.industry].map(s=>s.trim().toLocaleLowerCase())),report});transaction.oncomplete=()=>{db.close();resolve()};transaction.onerror=()=>reject(transaction.error)}})},invalid);
 await page.reload();await page.getByRole('button',{name:'Potential Sellers',exact:true}).click();await expect(page.locator('.library-page .empty-state')).toContainText('No companies saved yet');
 await page.route('**/api/investigate-market*',route=>route.fulfill({json:job()}));await page.getByRole('button',{name:'Search markets and industries',exact:true}).click();await select(page);await expect(page.getByRole('heading',{name:'Integration Test Works'})).toBeVisible();
 await page.reload();await page.getByRole('button',{name:'Potential Sellers',exact:true}).click();await expect(page.locator('.library-page .company')).toHaveCount(1);
});
