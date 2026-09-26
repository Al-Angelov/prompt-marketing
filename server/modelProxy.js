// Same-origin Vercel gateway. Secrets stay on the server, never in VITE_* variables.
export async function proxyModel(req, res, endpoint, expectedMethod) {
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Type','application/json; charset=utf-8');
 if(req.method!==expectedMethod){res.setHeader('Allow',expectedMethod);return res.status(405).json({error:'method_not_allowed'})}
 const origin=process.env.MODEL_API_URL;
 if(!origin)return res.status(503).json({error:'model_backend_not_configured',message:'Java model service is not configured. Public-signal demo fallback is active.'});
 let url;
 try{url=new URL(origin);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error();url=new URL(endpoint,url.origin)}catch{return res.status(503).json({error:'invalid_backend_configuration'})}
 let body;
 if(expectedMethod==='POST'){
  if(!(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))return res.status(415).json({error:'application/json required'});
  body=typeof req.body==='string'?req.body:JSON.stringify(req.body);
  if(!body)return res.status(400).json({error:'JSON company object required'});
  if(Buffer.byteLength(body)>16384)return res.status(413).json({error:'request_too_large'});
 }
 try{
  const response=await fetch(url,{method:expectedMethod,headers:{'Content-Type':'application/json',...(process.env.MODEL_API_TOKEN?{Authorization:`Bearer ${process.env.MODEL_API_TOKEN}`}:{})},body,signal:AbortSignal.timeout(9000),redirect:'error'});
  if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('Non-JSON upstream');
  const value=await response.json();
  if(response.status>=500)return res.status(503).json({error:'model_backend_unavailable',message:'Java model service is temporarily unavailable.'});
  if(response.status===401||response.status===403)return res.status(503).json({error:'model_backend_auth_failed',message:'Model service authentication needs configuration.'});
  return res.status(response.status).json(value);
 }catch{return res.status(503).json({error:'model_backend_unavailable',message:'Java model service could not be reached. Public-signal demo fallback is active.'})}
}
