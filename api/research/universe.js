import {proxyModel} from '../../server/modelProxy.js';
export default (req,res)=>proxyModel(req,res,'/api/v1/sourcing/universe','POST','sourcing');
