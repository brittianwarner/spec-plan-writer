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

/**
 * Where the engine (local or Rivet Cloud) calls back for /start + /metadata.
 *
 * Prod: `RIVET_SERVERLESS_URL` override, else derived from Vercel's system env
 * (`VERCEL_PROJECT_PRODUCTION_URL` → `VERCEL_URL`, hosts without scheme).
 * Local: the Vite origin above.
 */
function serverlessPoolUrl(): string | undefined {
	const explicit = process.env.RIVET_SERVERLESS_URL?.trim()
		|| process.env.RIVET_DEV_SERVERLESS_URL?.trim();
	if (explicit) return explicit.replace(/\/$/, '');
	if (local) return DEV_SERVERLESS_URL;
	const host =
		process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
	if (host) return `https://${host.replace(/\/$/, '')}/api/rivet`;
	return undefined;
}

const poolUrl = serverlessPoolUrl();

/**
 * Pool timings. NOT defaults — the two values the platform forces on us:
 * - requestLifespan must stay under Vercel maxDuration (800s on /api/rivet).
 *   790s leaves a 10s margin and makes migrations rare.
 * - drainGracePeriod must be < requestLifespan. The product default (1800s)
 *   is invalid with any sub-30-minute lifespan; 30s is graceful without
 *   burning request budget.
 * - metadataPollInterval: 10s instead of the 1s configure default — same
 *   version detection, 10× less metadata traffic.
 */
const REQUEST_LIFESPAN_SEC = 790;
const DRAIN_GRACE_PERIOD_SEC = 30;
const METADATA_POLL_INTERVAL_MS = 10_000;

export const registry = setup({
	use: { user, vm, specPlan, specPlanRun, specPlanWorker },

	// Local: start the bundled engine. Prod: RIVET_ENDPOINT points at Rivet
	// Cloud. `configurePool` requires `startEngine` or an endpoint.
	startEngine: local ? true : undefined,
	configurePool: poolUrl
		? {
				url: poolUrl,
				requestLifespan: REQUEST_LIFESPAN_SEC,
				drainGracePeriod: DRAIN_GRACE_PERIOD_SEC,
				metadataPollInterval: METADATA_POLL_INTERVAL_MS
			}
		: undefined
});

export type Registry = typeof registry;
