import {test,expect} from '@playwright/test';
import {prospects} from '../src/data';
import {investigate} from '../src/research';
import {companyInput,structuredFields,type ModelResult} from '../src/modelApi';

function result(id='1',coverage=1,percentile=90):ModelResult{return {
 schemaVersion:1,companyId:id,year:2027,status:'scored',probability:.07,percentile,baselineLogOdds:-3,
 contributions:[{feature:'firmAge',observedValue:29,imputed:false,logOdds:.2},{feature:'familyOwned',observedValue:null,imputed:true,logOdds:-.1}],
 suppliedFields:coverage===1?['foundedYear','revenueK','employees','ebitdaMargin','leverage','revenueGrowth3y','maxDirectorTenure','ownerAge','familyOwned','shareholders','sectorDeals24m']:['employees','revenueK'],missingFields:coverage===1?[]:['ownerAge'],coverage,confidence:coverage===1?'High':'Low',
 metadata:{modelId:'shared-model-1',modelUsed:'Logistic regression',initializedAt:'2026-09-26T00:00:00Z',trainingSource:'synthetic',syntheticTraining:true,trainingRows:1000,trainedThroughYear:2025,trainingBaseRate:.02,target:'Historical acquisition propensity',calibration:'Not externally calibrated',explanationMethod:'Additive log-odds'},warnings:['Synthetic training only'],
}}

test('fusion weights track region and missingness; contradictions survive any model rank',()=>{
 const report=(index:number,coverage:number,rank=90)=>investigate({...prospects[index],structured:{status:'ready',input:companyInput(prospects[index]),inputProvenance:'demo-fixture',result:result(String(index+1),coverage,rank)}});
 const nordic=report(1,1),germany=report(0,1),sparse=report(1,.2);
 expect(nordic.combined!.structuredWeight).toBe(.65);expect(germany.combined!.structuredWeight).toBe(.25);
 expect(sparse.combined!.structuredWeight).toBeCloseTo(.13);
 expect(sparse.confidence).toBe('Low');expect(nordic.confidence).toBe('Moderate');
 expect(germany.combined!.contradictionPenalty).toBe(-12);
 expect(report(7,1,100).contact).toBe(false);expect(report(7,1,100).score).toBeNull();
 expect(nordic.contact).toBe(false); // synthetic training / mock evidence always requires validation
 expect(nordic.factors.map(f=>f.label)).not.toContain('Ownership / founder tenure');
 expect(nordic.factors.map(f=>f.label)).not.toContain('Financial / company context');
 expect(companyInput(prospects[1])).not.toHaveProperty('ownerAge');
 expect(companyInput(prospects[1])).not.toHaveProperty('familyOwned');
});

test('frontend calls HTTP model, displays missingness and uses updated research result',async({page})=>{
 const requests:Record<string,unknown>[]=[];
 await page.route('**/api/score',route=>{const body=route.request().postDataJSON();requests.push(body);const supplied=structuredFields.map(([key])=>key).filter(key=>body[key]!=null);return route.fulfill({contentType:'application/json',body:JSON.stringify({...result(body.id,supplied.length/11,90),suppliedFields:supplied,missingFields:structuredFields.map(([key])=>key).filter(key=>!supplied.includes(key))})})});
 await page.goto('http://localhost:5173');
 await expect(page.locator('.structured-model')).toContainText('Live Java computation');
 await expect(page.locator('.model-readout')).toContainText('7.00%');
 expect(requests[0]).toMatchObject({id:'1',year:2027,revenueK:24600,employees:120,foundedYear:1998});
 expect(requests[0]).not.toHaveProperty('ownerAge');
 await page.getByRole('button',{name:'Discover prospects'}).click();
 await page.getByRole('dialog').getByRole('button',{name:/Nordvik/}).click();
 await page.getByRole('button',{name:'Research company',exact:true}).click();
 await page.getByRole('button',{name:'Open investigation'}).click();
 await expect(page.locator('.detail-company h2')).toContainText('Nordvik');
 await expect(page.locator('.combined-assessment')).toContainText('11.8%');
 await expect(page.locator('.model-readout')).toContainText('7.00%');
 await page.locator('.structured-editor summary').click();
 await page.getByRole('spinbutton',{name:'EBITDA margin (ratio)',exact:true}).fill('0.15');
 await page.getByRole('button',{name:'Run structured model',exact:true}).click();
 await expect.poll(()=>requests.at(-1)?.ebitdaMargin).toBe(.15);
});

test('malformed model response fails closed instead of inventing a score',async({page})=>{
 await page.route('**/api/score',route=>route.fulfill({contentType:'application/json',body:'{"probability":99}'}));
 await page.goto('http://localhost:5173');
 await expect(page.locator('.structured-model')).toContainText('incompatible response');
 await expect(page.locator('.structured-model')).toContainText('demo fallback');
 await expect(page.locator('.model-readout')).toHaveCount(0);
});

test('real Vite proxy → Java service → investigation',async({page,request})=>{
 test.skip(process.env.RUN_JAVA_INTEGRATION!=='1','Requires the packaged Java service on port 8080');
 const health=await request.get('http://localhost:5173/api/health');expect(health.ok()).toBe(true);
 const modelId=(await health.json()).modelId;
 const scored=await request.post('http://localhost:5173/api/score',{data:companyInput(prospects[0])});
 expect(scored.ok()).toBe(true);const payload=await scored.json();
 expect(payload.metadata.modelId).toBe(modelId);expect(payload.missingFields).toContain('familyOwned');
 expect(payload.suppliedFields).toHaveLength(3);
 await page.goto('http://localhost:5173');
 await expect(page.locator('.structured-model')).toContainText('Live Java computation');
 await expect(page.locator('.model-readout')).toContainText('3 / 11');
 await page.getByRole('button',{name:'Discover prospects'}).click();
 await page.getByRole('dialog').getByRole('button',{name:/Schneider/}).click();
 await page.getByRole('button',{name:'Research company',exact:true}).click();
 await page.getByRole('button',{name:'Open investigation'}).click();
 await expect(page.locator('.model-readout')).toContainText((payload.probability*100).toFixed(2)+'%');
});
