/**
 * Actor connection auth — Rivet production deny-by-default access control.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { jwtVerify } from 'jose';
import { UserError } from 'rivetkit';
import { allowedOrigins, authSecret, internalSecret, isLocalDev } from './env.ts';
import { redactSecrets } from '../security/redact-secrets.ts';

export { redactSecrets };

export interface AppConnState {
	userId: string | null;
	isInternal: boolean;
}

export async function verifyActorToken(token: string): Promise<string> {
	const secret = new TextEncoder().encode(authSecret());
	try {
		const { payload } = await jwtVerify(token, secret, { audience: 'actor' });
		if (typeof payload.sub !== 'string' || !payload.sub) {
			throw new UserError('Malformed actor token', { code: 'auth_malformed' });
		}
		return payload.sub;
	} catch (err) {
		if (err instanceof UserError) throw err;
		throw new UserError('Invalid or expired actor token', { code: 'auth_invalid' });
	}
}

export function guardOrigin(request?: Request): void {
	const origins = allowedOrigins();
	if (origins.length === 0) {
		if (isLocalDev()) return;
		throw new UserError('Origin not allowed', { code: 'origin_not_allowed' });
	}
	const origin = request?.headers.get('origin');
	if (!origin) {
		if (isLocalDev()) return;
		throw new UserError('Origin required', { code: 'origin_required' });
	}
	if (!origins.includes(origin)) {
		throw new UserError('Origin not allowed', { code: 'origin_not_allowed' });
	}
}

/** Constant-time string compare via hashed buffers (length-oracle resistant). */
function safeEqual(a: string, b: string): boolean {
	const ah = createHash('sha256').update(a).digest();
	const bh = createHash('sha256').update(b).digest();
	return timingSafeEqual(ah, bh);
}

export async function connStateFromParams(params: unknown): Promise<AppConnState> {
	const p = (params ?? {}) as Record<string, unknown>;
	if (typeof p.internal === 'string' && safeEqual(p.internal, internalSecret())) {
		return { userId: null, isInternal: true };
	}
	if (typeof p.token === 'string' && p.token.length > 0) {
		return { userId: await verifyActorToken(p.token), isInternal: false };
	}
	throw new UserError('Authentication required', { code: 'auth_required' });
}

export async function internalConnStateFromParams(params: unknown): Promise<AppConnState> {
	const p = (params ?? {}) as Record<string, unknown>;
	if (typeof p.internal === 'string' && safeEqual(p.internal, internalSecret())) {
		return { userId: null, isInternal: true };
	}
	throw new UserError('Internal callers only', { code: 'auth_forbidden' });
}

export function bindInternalOnlyConnect(): {
	onBeforeConnect: (c: { request?: Request }) => void;
	createConnState: (_c: unknown, params: unknown) => Promise<AppConnState>;
} {
	return {
		onBeforeConnect: () => {},
		createConnState: async (_c, params) => internalConnStateFromParams(params)
	};
}

export function internalParams(): { internal: string } {
	return { internal: internalSecret() };
}

function asConn(connState: unknown): AppConnState {
	const s = connState as Partial<AppConnState> | null | undefined;
	return {
		userId: typeof s?.userId === 'string' ? s.userId : null,
		isInternal: s?.isInternal === true
	};
}

export function assertInternal(connState: unknown): void {
	if (!asConn(connState).isInternal) {
		throw new UserError('This action is internal-only', { code: 'auth_forbidden' });
	}
}

export function assertOwnsKey(connState: unknown, keyUserId: string): void {
	const s = asConn(connState);
	if (s.isInternal) return;
	if (s.userId !== keyUserId) {
		throw new UserError('Not your actor', { code: 'auth_forbidden' });
	}
}
