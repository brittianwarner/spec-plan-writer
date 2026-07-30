/**
 * Rivet actor registry — mounted inside this SvelteKit app at `/api/rivet/*`.
 *
 * One deployable in serverless mode against Rivet Cloud (or a local engine):
 * the browser opens its WebSocket to Rivet; Rivet issues ordinary HTTPS back to
 * `GET /api/rivet/metadata` and `GET|POST /api/rivet/start` on this origin.
 *
 * @see https://rivet.dev/docs/general/runtime-modes
 * @see https://rivet.dev/docs/deploy/vercel
 */

import { setup } from '@rivet-dev/agentos';
import { isLocalDev } from './env.ts';
import { user } from './user/index.ts';
import { vm } from './vm.ts';
import { specPlan } from './spec-plan/index.ts';
import { specPlanRun } from './spec-plan-run/index.ts';
import { specPlanWorker } from './spec-plan-worker/index.ts';

/**
 * Local-dev only: where the bundled engine should call back to reach us.
 * Prefer 127.0.0.1 over localhost — Vite is often IPv4-only and `localhost` →
 * ::1 makes every actor wake time out.
 *
 * Override with `RIVET_DEV_SERVERLESS_URL` if Vite is not on :5173.
 */
const DEV_SERVERLESS_URL = 'http://127.0.0.1:5173/api/rivet';

const local = isLocalDev();

export const registry = setup({
	use: { user, vm, specPlan, specPlanRun, specPlanWorker },
	// Both flip together — configurePool is rejected without startEngine/endpoint.
	startEngine: local ? true : undefined,
	configurePool: local
		? { url: process.env.RIVET_DEV_SERVERLESS_URL?.trim() || DEV_SERVERLESS_URL }
		: undefined
});

export type Registry = typeof registry;
