/**
 * Rivet actor registry — mounted inside this SvelteKit app at `/api/rivet/*`.
 *
 * One deployable in serverless mode against Rivet Cloud (or a local engine):
 * the browser opens its WebSocket to Rivet; Rivet issues ordinary HTTPS back to
 * `GET /api/rivet/metadata` and `GET|POST /api/rivet/start` on this origin.
 *
 * Topology matches euchre: pool configuration (URL, requestLifespan,
 * drainGracePeriod) is managed in the Rivet dashboard, not here. Only the
 * local engine callback URL is overridden — Vite's port can't be guessed.
 *
 * @see https://rivet.dev/docs/general/runtime-modes
 * @see https://rivet.dev/docs/deploy/vercel
 * @see https://rivet.dev/docs/general/pool-configuration
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
 * Prefer 127.0.0.1 over localhost — Vite is often IPv4-only, and `localhost`
 * resolving to ::1 makes every actor wake time out.
 *
 * Override with `RIVET_DEV_SERVERLESS_URL` if Vite is not on :5173.
 * (Ours, not a RivetKit builtin — same pattern as euchre.)
 */
const DEV_SERVERLESS_URL = 'http://127.0.0.1:5173/api/rivet';

/** True when no Rivet Cloud endpoint is configured, i.e. `npm run dev`. */
const local = isLocalDev();

export const registry = setup({
	use: { user, vm, specPlan, specPlanRun, specPlanWorker },

	// Local-dev only. Production `RIVET_ENDPOINT` points at Rivet Cloud; the
	// serverless provider URL + pool timings live in the Rivet dashboard.
	// `configurePool` requires `startEngine` or an endpoint.
	//
	// Dashboard values for the Vercel provider (must satisfy
	// drain_grace_period < request_lifespan ≤ function maxDuration):
	//   url: https://<app>/api/rivet · request_lifespan: 790 · drain_grace: 30
	startEngine: local ? true : undefined,
	configurePool: local
		? { url: process.env.RIVET_DEV_SERVERLESS_URL?.trim() || DEV_SERVERLESS_URL }
		: undefined
});

export type Registry = typeof registry;
