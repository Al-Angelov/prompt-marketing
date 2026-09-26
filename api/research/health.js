import {proxyModel} from '../../server/modelProxy.js';
export default (req,res)=>proxyModel(req,res,'/health','GET','sourcing');
