import { test, expect } from '@playwright/test';
import { prospects } from '../src/data';
import { investigate, researchedMessage } from '../src/research';

test('scoring is bounded, auditable and applies negative evidence',()=>{
 for(const p of prospects){
  const r=investigate(p);
  expect(r.factors.filter(f=>f.maximum>0).reduce((n,f)=>n+f.maximum,0)).toBe(100);
  const positive=r.factors.filter(f=>f.points>0).reduce((n,f)=>n+f.points,0);
  if(r.score!==null){
   expect(r.score).toBe(Math.max(0,Math.min(100,r.factors.reduce((n,f)=>n+f.points,0))));
   expect(r.score).toBeLessThan(positive);
  }
  for(const e of r.evidence.filter(e=>e.status==='Verified'))expect(e.sources.some(s=>s.independent)).toBe(true);
  if(!r.contact)expect(researchedMessage(p)).toContain('Do not contact yet');
 }
 const germany=investigate(prospects[0]);const nordics=investigate(prospects[1]);
 expect(germany.factors[1].maximum).toBeGreaterThan(nordics.factors[1].maximum);
 expect(nordics.factors[3].maximum).toBeGreaterThan(germany.factors[3].maximum);
});
