import { proxyModel } from '../server/modelProxy.js';
export default function handler(req,res){return proxyModel(req,res,'/api/health','GET')}
