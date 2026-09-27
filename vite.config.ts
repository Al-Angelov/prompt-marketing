import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({mode})=>{
 const env=loadEnv(mode,process.cwd(),'');
 return {plugins:[react()],server:{proxy:{'/api/quick-search':{
  target:env.SOURCING_API_URL||'http://localhost:8000',changeOrigin:true,
  rewrite:()=>'/api/v1/quick-search',
  ...(env.SOURCING_API_TOKEN?{headers:{Authorization:`Bearer ${env.SOURCING_API_TOKEN}`}}:{}),
 },'/api/investigate-market':{
  target:env.SOURCING_API_URL||'http://localhost:8000',changeOrigin:true,
  rewrite:(path:string)=>{const url=new URL(path,'http://localhost');const id=url.searchParams.get('job');return '/api/v1/investigate-market'+(id?'/'+encodeURIComponent(id):'')},
  ...(env.SOURCING_API_TOKEN?{headers:{Authorization:`Bearer ${env.SOURCING_API_TOKEN}`}}:{}),
 },'/api/research':{
  target:env.SOURCING_API_URL||'http://localhost:8000',changeOrigin:true,
  rewrite:(path:string)=>path.replace('/api/research/health','/health').replace('/api/research/universe','/api/v1/sourcing/universe').replace('/api/research/','/api/v1/research/'),
  ...(env.SOURCING_API_TOKEN?{headers:{Authorization:`Bearer ${env.SOURCING_API_TOKEN}`}}:{}),
 },'/api':{
  target:env.MODEL_API_URL||'http://localhost:8080',changeOrigin:true,
  ...(env.MODEL_API_TOKEN?{headers:{Authorization:`Bearer ${env.MODEL_API_TOKEN}`}}:{}),
 }}}};
});
