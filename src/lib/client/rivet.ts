/**
 * Browser Rivet client — one shared transport for the whole app.
 *
 * The endpoint is this origin's `/api/rivet` mount: metadata discovery, then the
 * browser opens its WebSocket to Rivet Cloud (or the local engine on :6420).
 *
 * @see https://rivet.dev/docs/deploy/vercel
 */

import { browser } from '$app/environment';
import { createClient, createRivetContext, createSharedRivetKit } from '@rivetkit/svelte';
import type { registry } from '$lib/actors/registry';

export const rivetContext = createRivetContext<typeof registry>('SpecPlanWriter');

/** Lazy singleton — created only in the browser. */
const getClient = (() => {
	let client: ReturnType<typeof createClient<typeof registry>> | null = null;
	return () => {
		if (!browser) {
			throw new Error('Rivet client is browser-only');
		}
		if (!client) {
			client = createClient<typeof registry>({
				endpoint: `${window.location.origin}/api/rivet`
			});
		}
		return client;
	};
})();

export const getRivet = createSharedRivetKit<typeof registry>(getClient, {
	actionDefaults: { timeout: 60_000, throwOnError: false, guardConnection: true }
});

let cachedToken: { token: string; exp: number } | null = null;
let lastGoodToken = '';

export function peekActorToken(): string {
	return lastGoodToken;
}

export async function getActorToken(): Promise<string> {
	const now = Date.now();
	if (cachedToken && cachedToken.exp - now > 5 * 60_000) {
		lastGoodToken = cachedToken.token;
		return cachedToken.token;
	}
	const res = await fetch('/api/actor-token', {
		credentials: 'same-origin',
		headers: { accept: 'application/json', 'cache-control': 'no-store' }
	});
	if (!res.ok) throw new Error('Failed to mint actor token');
	const data = (await res.json()) as { token: string };
	let exp = now + 10 * 60_000;
	try {
		const payload = JSON.parse(
			atob(data.token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))
		) as { exp?: number };
		if (typeof payload.exp === 'number') exp = payload.exp * 1000;
	} catch {
		// keep default
	}
	cachedToken = { token: data.token, exp };
	lastGoodToken = data.token;
	return data.token;
}

/** Params getter — only call after ensureActorToken(); never returns empty. */
export function actorParamsToken(): () => { token: string } {
	return () => {
		if (!lastGoodToken) throw new Error('Actor token not ready');
		return { token: lastGoodToken };
	};
}

export async function ensureActorToken(): Promise<string> {
	return getActorToken();
}

export function clearActorTokenCache(): void {
	cachedToken = null;
	lastGoodToken = '';
}
