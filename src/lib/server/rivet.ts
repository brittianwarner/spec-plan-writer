/**
 * Server-side Rivet client (OAuth callback, logout, token helpers).
 *
 * Browser clients go through `$lib/client/rivet` → `${origin}/api/rivet`
 * metadata discovery. This module is under `$lib/server/` so it never ships
 * client-side (`RIVET_ENDPOINT` carries a secret `sk_` token).
 */

import { createClient, type Client } from '@rivet-dev/agentos/client';
import { env } from '$env/dynamic/private';
import type { Registry } from '$lib/actors/registry';

/**
 * Local dev default. When `RIVET_ENDPOINT` is unset, RivetKit runs an engine on
 * this port (started via `startEngine` on the registry). That fallback is fine
 * locally and fatal on Vercel (read-only FS) — hence the env var is required in
 * every deployed environment.
 */
const LOCAL_ENDPOINT = 'http://localhost:6420';

let client: Client<Registry> | undefined;
let localEngineReady: Promise<void> | undefined;

/**
 * Ensure the registry module is evaluated in local dev so `startEngine: true`
 * brings up the engine before the first actor call (OAuth often hits Rivet
 * before any browser `/api/rivet` request).
 */
function ensureLocalEngine(): Promise<void> {
	if (env.RIVET_ENDPOINT) return Promise.resolve();
	if (!localEngineReady) {
		localEngineReady = import('$lib/actors/registry').then(() => undefined);
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
