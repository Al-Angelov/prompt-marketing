import {proxyModel} from '../server/modelProxy.js';
// Registry-first market screen (no LLM calls). Same server-side token handling as research.
export default function handler(req,res){return proxyModel(req,res,'/api/v1/quick-search','POST','sourcing')}
