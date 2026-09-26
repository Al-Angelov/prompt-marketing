import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({mode})=>{
 const env=loadEnv(mode,process.cwd(),'');
 return {plugins:[react()],server:{proxy:{'/api':{
  target:env.MODEL_API_URL||'http://localhost:8080',changeOrigin:true,
  ...(env.MODEL_API_TOKEN?{headers:{Authorization:`Bearer ${env.MODEL_API_TOKEN}`}}:{}),
 }}}};
});
