import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {proxyModel} from '../server/modelProxy.js';

const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(value){this.body=value;return this}});
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
