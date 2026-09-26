import { test, expect } from '@playwright/test';
import { prospects } from '../src/data';
import { investigate, researchedMessage } from '../src/research';

test('scoring is bounded, auditable and applies negative evidence',()=>{
 for(const p of prospects){
  const r=investigate(p);
  expect(r.factors.filter(f=>f.maximum>0).reduce((n,f)=>n+f.maximum,0)).toBeCloseTo(100);
  const positive=r.factors.filter(f=>f.points>0).reduce((n,f)=>n+f.points,0);
  if(r.score!==null){
   expect(r.score).toBe(Math.round(Math.max(0,Math.min(100,r.factors.reduce((n,f)=>n+f.points,0)))));
   expect(r.score).toBeLessThan(positive);
  }
  for(const e of r.evidence.filter(e=>e.status==='Verified'))expect(e.sources.some(s=>s.independent)).toBe(true);
  if(!r.draftAllowed)expect(researchedMessage(p)).toContain('Do not contact yet');
  expect(r.contact).toBe(false); // fixture sources never authorize real owner contact
 }
 const germany=investigate(prospects[0]);const nordics=investigate(prospects[1]);
 expect(nordics.combined!.nominalStructuredWeight).toBeGreaterThan(germany.combined!.nominalStructuredWeight);
});
