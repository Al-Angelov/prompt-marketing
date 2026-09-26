import {proxyModel} from '../server/modelProxy.js';
export default async function handler(req,res){
 if(req.method==='POST')return proxyModel(req,res,'/api/v1/investigate-market','POST','sourcing');
 if(req.method==='GET'){
  const id=req.query?.job;
  if(typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))return res.status(400).json({error:'invalid_research_session'});
  return proxyModel(req,res,'/api/v1/investigate-market/'+id,'GET','sourcing');
 }
 res.setHeader('Allow','GET, POST');return res.status(405).json({error:'method_not_allowed'});
}
