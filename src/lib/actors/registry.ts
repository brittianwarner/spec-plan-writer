/**
 * Rivet actor registry — mounted inside this SvelteKit app at `/api/rivet/*`.
 *
 * One deployable in serverless mode against Rivet Cloud (or a local engine):
 * the browser opens its WebSocket to Rivet; Rivet issues ordinary HTTPS back to
 * `GET /api/rivet/metadata` and `GET|POST /api/rivet/start` on this origin.
 *
 * @see https://rivet.dev/docs/general/runtime-modes
 * @see https://rivet.dev/docs/deploy/vercel
 * @see https://rivet.dev/docs/general/pool-configuration
 */

import { setup } from '@rivet-dev/agentos';
import { env, isLocalDev } from './env.ts';
import { user } from './user/index.ts';
import { vm } from './vm.ts';
import { specPlan } from './spec-plan/index.ts';
import { specPlanRun } from './spec-plan-run/index.ts';
import { specPlanWorker } from './spec-plan-worker/index.ts';

/**
 * Vercel function maxDuration is 300s (Pro). Rivet's request_lifespan must be
 * strictly under the platform timeout. drain_grace_period is reserved *inside*
 * that lifespan for clean actor stop — it MUST be less than request_lifespan.
 *
 * Dashboard default drain_grace_period is 1800s, which is invalid when
 * request_lifespan is ~295. We upsert both values via configurePool so the
 * provider config is always valid: runtime ·288s + grace ·30s ≤ 300.
 */
const REQUEST_LIFESPAN_SEC = 280;
const DRAIN_GRACE_PERIOD_SEC = 30;

const local = isLocalDev();

/**
 * URL Rivet Cloud (prod) or the local engine (dev) calls for /start + /metadata.
 * Prefer RIVET_SERVERLESS_URL; otherwise APP_URL + /api/rivet; else loopback dev.
 */
function serverlessPoolUrl(): string | undefined {
	const explicit = env('RIVET_SERVERLESS_URL') ?? env('RIVET_DEV_SERVERLESS_URL');
	if (explicit) return explicit.replace(/\/$/, '');
	const app = env('APP_URL')?.replace(/\/$/, '');
	if (app) return `${app}/api/rivet`;
	if (local) return 'http://127.0.0.1:5173/api/rivet';
	return undefined;
}

const poolUrl = serverlessPoolUrl();

export const registry = setup({
	use: { user, vm, specPlan, specPlanRun, specPlanWorker },
	// Local: start bundled engine. Prod: RIVET_ENDPOINT points at Rivet Cloud.
	startEngine: local ? true : undefined,
	// Upserts runner pool config (lifespan + drain grace) against the engine.
	// Required so dashboard defaults cannot ship drain_grace=1800 with
	// request_lifespan≈295 (Invalid runner config).
	// Needs endpoint (RIVET_ENDPOINT) or startEngine.
	configurePool: poolUrl
		? {
				url: poolUrl,
				requestLifespan: REQUEST_LIFESPAN_SEC,
				drainGracePeriod: DRAIN_GRACE_PERIOD_SEC
			}
		: undefined
});

export type Registry = typeof registry;
