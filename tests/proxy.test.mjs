import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {proxyModel} from '../server/modelProxy.js';
import marketHandler from '../api/investigate-market.js';

const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(value){this.body=value;return this}});
test('market gateway validates job identifiers and forwards starts and polls through the same route',async()=>{
 const previous=process.env.SOURCING_API_URL,token=process.env.SOURCING_API_TOKEN;
 const seen=[];
 const upstream=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;seen.push({path:req.url,method:req.method,body:body?JSON.parse(body):null});assert.equal(req.headers.authorization,'Bearer test-market-token');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'running'}))});
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 try{
  process.env.SOURCING_API_URL=`http://127.0.0.1:${upstream.address().port}`;process.env.SOURCING_API_TOKEN='test-market-token';
  let res=response();await marketHandler({method:'GET',query:{job:'../health'}},res);assert.equal(res.code,400);
  res=response();await marketHandler({method:'DELETE'},res);assert.equal(res.code,405);
  const body={country:'Germany',industry:'Industrial manufacturing'};
  res=response();await marketHandler({method:'POST',headers:{'content-type':'application/json'},body},res);assert.equal(res.code,200);
  res=response();await marketHandler({method:'GET',query:{job:'a'.repeat(32)}},res);assert.equal(res.code,200);
  assert.deepEqual(seen,[{path:'/api/v1/investigate-market',method:'POST',body},{path:'/api/v1/investigate-market/'+'a'.repeat(32),method:'GET',body:null}]);
 }finally{await new Promise(resolve=>upstream.close(resolve));if(previous===undefined)delete process.env.SOURCING_API_URL;else process.env.SOURCING_API_URL=previous;if(token===undefined)delete process.env.SOURCING_API_TOKEN;else process.env.SOURCING_API_TOKEN=token}
});
test('gateway fails closed, forwards exact path/body/auth, and preserves errors',async()=>{
 const previous=process.env.MODEL_API_URL,token=process.env.MODEL_API_TOKEN;
 delete process.env.MODEL_API_URL;
 try{
  let res=response();await proxyModel({method:'POST'},res,'/api/score','POST');assert.equal(res.code,503);
  res=response();await proxyModel({method:'GET'},res,'/api/score','POST');assert.equal(res.code,405);
  const upstream=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;assert.equal(req.url,'/api/score');assert.equal(req.headers.authorization,'Bearer test-secret');res.setHeader('Content-Type','application/json');res.statusCode=body.includes('invalid')?400:200;res.end(JSON.stringify({received:JSON.parse(body)}))});
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  try{
   process.env.MODEL_API_URL=`http://127.0.0.1:${upstream.address().port}`;process.env.MODEL_API_TOKEN='test-secret';
   res=response();await proxyModel({method:'POST',headers:{'content-type':'application/json'},body:{id:'demo'}},res,'/api/score','POST');assert.equal(res.code,200);assert.deepEqual(res.body.received,{id:'demo'});assert.equal(res.headers['Cache-Control'],'no-store');
   res=response();await proxyModel({method:'POST',headers:{'content-type':'application/json'},body:{id:'invalid'}},res,'/api/score','POST');assert.equal(res.code,400);
  }finally{await new Promise(resolve=>upstream.close(resolve))}
 }finally{if(previous===undefined)delete process.env.MODEL_API_URL;else process.env.MODEL_API_URL=previous;if(token===undefined)delete process.env.MODEL_API_TOKEN;else process.env.MODEL_API_TOKEN=token}
});

test('research gateway requires server configuration and keeps service token out of responses',async()=>{
 const oldUrl=process.env.SOURCING_API_URL,oldToken=process.env.SOURCING_API_TOKEN;
 delete process.env.SOURCING_API_URL;delete process.env.SOURCING_API_TOKEN;
 const req={method:'POST',headers:{'content-type':'application/json'},body:{company_name:'Test',region:'Germany'}};
 try{
  let res=response();await proxyModel(req,res,'/api/v1/research/company','POST','sourcing');assert.equal(res.code,503);
  const upstream=createServer(async(req,res)=>{assert.equal(req.url,'/api/v1/research/company');assert.equal(req.headers.authorization,'Bearer server-only-secret');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({company_name:'Test',schema_version:2}))});
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  try{
   process.env.SOURCING_API_URL=`http://127.0.0.1:${upstream.address().port}`;
   res=response();await proxyModel(req,res,'/api/v1/research/company','POST','sourcing');assert.equal(res.code,503);
   process.env.SOURCING_API_TOKEN='server-only-secret';
   res=response();await proxyModel(req,res,'/api/v1/research/company','POST','sourcing');assert.equal(res.code,200);assert.equal(JSON.stringify(res.body).includes('server-only-secret'),false);
  }finally{await new Promise(resolve=>upstream.close(resolve))}
 }finally{if(oldUrl===undefined)delete process.env.SOURCING_API_URL;else process.env.SOURCING_API_URL=oldUrl;if(oldToken===undefined)delete process.env.SOURCING_API_TOKEN;else process.env.SOURCING_API_TOKEN=oldToken}
});
