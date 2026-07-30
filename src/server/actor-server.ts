import { registry } from '../lib/actors/registry.ts';

// Optional runner-mode entry (Docker / Rivet Compute). Local and production
// default is serverless: Vite/Vercel mount registry.handler at /api/rivet.
console.log('[spec-plan-writer] actor server starting (runner mode)…');
registry.start();
