import {proxyModel} from '../../server/modelProxy.js';
export default (req,res)=>proxyModel(req,res,'/api/v1/research/company','POST','sourcing');
