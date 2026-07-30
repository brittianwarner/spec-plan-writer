import { createClient, type Client } from '@rivet-dev/agentos/client';
import { env } from '$env/dynamic/private';
import type { Registry } from '$lib/actors/registry';

const LOCAL = 'http://localhost:6420';

let client: Client<Registry> | undefined;

export function getRivetClient(): Client<Registry> {
	if (!client) {
		const endpoint = env.RIVET_ENDPOINT || LOCAL;
		client = createClient<Registry>(endpoint);
	}
	return client;
}

export function getRivetPublicEndpoint(): string {
	return env.RIVET_PUBLIC_ENDPOINT || env.RIVET_ENDPOINT || LOCAL;
}

export function internalParams(): { internal: string } {
	const secret = env.INTERNAL_SECRET;
	if (!secret || secret.length < 32) {
		throw new Error('INTERNAL_SECRET must be set (>= 32 chars)');
	}
	return { internal: secret };
}
