import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir:'./tests', testMatch:'**/*.spec.ts', use:{channel:'msedge',headless:true,viewport:{width:1440,height:1000}}, reporter:'list',
 webServer:{command:'npm run dev -- --port 5173',url:'http://localhost:5173',reuseExistingServer:!process.env.CI},
});
