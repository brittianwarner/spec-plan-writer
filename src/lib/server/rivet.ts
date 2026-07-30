/**
 * Server-side Rivet client (OAuth callback, logout, token helpers).
 *
 * Browser clients go through `$lib/client/rivet` → `${origin}/api/rivet`
 * metadata discovery. This module is under `$lib/server/` so it never ships
 * client-side (`RIVET_ENDPOINT` carries a secret `sk_` token).
 *
 * NOTE: this module must NOT import the actor registry — a static (or
 * statically analyzable dynamic) import would pull agentOS + the 131MB pi
 * asset into every Vercel function that touches Rivet (OAuth callback,
 * logout), tripling cold-start weight for no benefit. Local dev warms the
 * engine over HTTP instead.
 */

import { createClient, type Client } from '@rivet-dev/agentos/client';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import type { Registry } from '$lib/actors/registry';

/**
 * Local dev default. When `RIVET_ENDPOINT` is unset, RivetKit runs an engine on
 * this port (started via `startEngine` on the registry, inside `/api/rivet`).
 */
const LOCAL_ENDPOINT = 'http://localhost:6420';

let client: Client<Registry> | undefined;
let localEngineReady: Promise<void> | undefined;

/**
 * Ensure the local engine is running before the first actor call in dev.
 *
 * Hitting our own `/api/rivet/metadata` loads the registry module (which has
 * `startEngine: true` locally) inside the Vite dev server. The engine spawn is
 * idempotent; failures are swallowed because a later call retries.
 */
function ensureLocalEngine(): Promise<void> {
	if (!dev || env.RIVET_ENDPOINT) return Promise.resolve();
	if (!localEngineReady) {
		localEngineReady = (async () => {
			const base = (
				env.RIVET_DEV_SERVERLESS_URL ?? 'http://127.0.0.1:5173/api/rivet'
			).replace(/\/$/, '');
			// Loads the registry in the dev server → startEngine spawns on :6420.
			await fetch(`${base}/metadata`).catch(() => undefined);
			// Poll until the engine is actually listening (spawn is async).
			const deadline = Date.now() + 10_000;
			while (Date.now() < deadline) {
				const up = await fetch('http://127.0.0.1:6420/')
					.then(() => true)
					.catch(() => false);
				if (up) return;
				await new Promise((r) => setTimeout(r, 150));
			}
		})();
	}
	return localEngineReady;
}

/**
 * Memoized client. Built lazily so importing this file during build/prerender
 * does not require the env var to be present.
 *
 * `RIVET_ENDPOINT` uses URL auth: `https://<namespace>:<sk_token>@api.rivet.dev`.
 */
export async function getRivetClient(): Promise<Client<Registry>> {
	await ensureLocalEngine();
	if (!client) {
		client = createClient<Registry>(env.RIVET_ENDPOINT || LOCAL_ENDPOINT);
	}
	return client;
}

/**
 * Publishable endpoint handed to browsers (`pk_` token). `undefined` in local
 * dev — the client talks to this app's `/api/rivet` mount, which discovers the
 * local engine.
 */
export function getRivetPublicEndpoint(): string | undefined {
	return env.RIVET_PUBLIC_ENDPOINT || undefined;
}

export function internalParams(): { internal: string } {
	const secret = env.INTERNAL_SECRET;
	if (!secret || secret.length < 32) {
		throw new Error('INTERNAL_SECRET must be set (>= 32 chars)');
	}
	return { internal: secret };
}
