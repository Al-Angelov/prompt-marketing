import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {prospects} from '../src/data';
import {investigate,researchedMessage} from '../src/research';
import {sourcedInputs,type ResearchReport} from '../src/researchApi';
const fixture=():ResearchReport=>JSON.parse(readFileSync('tests/fixtures/research-report.json','utf8'));

test('live evidence uses verification, keeps contradictions, excludes structured context and never leaks fixture facts',()=>{
 const report=fixture();const p={...prospects[0],publicResearch:{status:'live' as const,report}};
 const input=sourcedInputs(p,report,2027);expect(input.employees).toBe(120);expect(input.revenueK).toBe(24000);expect(input.foundedYear).toBeUndefined();expect(input.ownerAge).toBeUndefined();
 const assessment=investigate(p);expect(assessment.combined?.contradictionPenalty).toBe(-20);expect(assessment.contact).toBe(false);expect(assessment.draftAllowed).toBe(true);
 expect(researchedMessage(p)).not.toContain('Thomas');expect(researchedMessage(p)).not.toContain('chairman');expect(researchedMessage(p)).toContain('external CEO');
 report.signal_evidence[0].kind='structured_context';expect(investigate(p).combined!.publicPositive).toBeLessThan(assessment.combined!.publicPositive);
 for(const claim of report.signal_evidence)claim.verification_status='unverified';
 expect(investigate(p).draftAllowed).toBe(false);
 const empty=fixture();empty.signal_evidence=[];empty.structured_facts=[];
 expect(investigate({...p,publicResearch:{status:'live',report:empty}}).score).toBeNull();
});

test('live research renders actual source links and survives Java outage without silently using fixtures',async({page})=>{
 let release!:()=>void;const ready=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/score',route=>route.fulfill({status:503,body:'{}'}));
 await page.route('**/api/research/company',async route=>{await ready;await route.fulfill({contentType:'application/json',body:JSON.stringify(fixture())})});
 await page.goto('http://localhost:5173');
 await page.getByRole('button',{name:'Discover prospects'}).click();
 await page.getByRole('textbox',{name:'Company name',exact:true}).fill('Integration Test Works');
 await page.getByRole('button',{name:'Research company',exact:true}).click();
 await expect(page.getByText('Research in progress…')).toBeVisible();release();
 await page.getByRole('button',{name:'Open investigation'}).click();
 await expect(page.locator('.detail-content')).toContainText('Live public evidence');
 await expect(page.locator('.structured-model')).toContainText('API unavailable');
 await expect(page.locator('.research-gaps')).toContainText('missing');
 await expect(page.locator('.claim-record.conflict')).toContainText('independence');
 await page.locator('.claim-record').first().locator('summary').click();
 await expect(page.locator('.source-excerpt a').first()).toHaveAttribute('href','https://company.example/leadership');
 await expect(page.locator('.source-excerpt').first()).toContainText('Live public source');
 await expect(page.locator('.detail-content')).not.toContainText('Mock source record');
 await page.locator('.detail-tabs').getByRole('button',{name:'Outreach',exact:true}).click();
 await expect(page.locator('.message-card')).toContainText('external CEO');
 await expect(page.locator('.message-card')).toContainText('no assumption that you are looking to sell');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('wrong company/schema or unavailable Python fails into explicitly labeled fallback',async({page})=>{
 await page.route('**/api/score',route=>route.fulfill({status:503,body:'{}'}));
 await page.route('**/api/research/company',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({...fixture(),company_name:'Wrong company'})}));
 await page.goto('http://localhost:5173');await page.getByRole('button',{name:'Discover prospects'}).click();
 await page.getByRole('textbox',{name:'Company name',exact:true}).fill('Unknown Company');await page.getByRole('button',{name:'Research company',exact:true}).click();
 await page.getByRole('button',{name:'Open investigation'}).click();
 await expect(page.locator('.detail-content')).toContainText('incompatible or ungrounded report');
 await expect(page.locator('.detail-content')).toContainText('demo fallback');
 await expect(page.getByRole('button',{name:'Prepare outreach'})).toBeDisabled();
});

test('complete HTTP journey: browser to Python verification/cache and Java, combined result and outreach',async({page,request})=>{
 test.skip(!process.env.FULL_STACK_URL,'Requires recorded Python harness, Java service, and configured Vite proxy');
 const base=process.env.FULL_STACK_URL!;
 expect((await request.get(base+'/api/research/health')).ok()).toBe(true);expect((await request.get(base+'/api/health')).ok()).toBe(true);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.getByRole('button',{name:'Discover prospects'}).click();
 await page.getByText('Discover a few companies by criteria',{exact:true}).click();
 await page.getByRole('button',{name:'Find candidate companies'}).click();
 await page.getByRole('button',{name:/Integration Test Works/}).click();
 const scored=page.waitForResponse(r=>r.url().endsWith('/api/score')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Research company',exact:true}).click();
 const response=await scored;expect(response.ok()).toBe(true);const payload=await response.json();
 expect(payload.suppliedFields.sort()).toEqual(['employees','revenueK']);expect(payload.metadata.syntheticTraining).toBe(true);
 await page.getByRole('button',{name:'Open investigation'}).click();
 await expect(page.locator('.model-readout')).toContainText('2 / 11');await expect(page.locator('.detail-content')).toContainText('Live public evidence');
 await expect(page.locator('.combined-assessment')).toContainText('20 contradiction points');
 await expect(page.locator('.detail-content')).toContainText('synthetic training');
 await page.locator('.detail-tabs').getByRole('button',{name:'Outreach',exact:true}).click();await expect(page.locator('.message-card')).toContainText('external CEO');
 const repeated=await request.post(base+'/api/research/company',{data:{company_name:'Integration Test Works',company_website:'https://company.example',region:'Germany'}});
 expect((await repeated.json()).cache_hit).toBe(true);
 expect(errors).toEqual([]);
});
