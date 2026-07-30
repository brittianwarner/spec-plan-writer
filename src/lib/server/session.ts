import { SignJWT, jwtVerify } from 'jose';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';

const COOKIE = 'spw_session';
const SESSION_AUD = 'session';
const ACTOR_AUD = 'actor';
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

export interface SessionUser {
	userId: string;
	login: string;
	name: string | null;
	avatarUrl: string | null;
}

function secretKey(): Uint8Array {
	const secret = env.AUTH_SECRET;
	if (!secret || secret.length < 32) {
		throw new Error('AUTH_SECRET must be set (>= 32 chars)');
	}
	return new TextEncoder().encode(secret);
}

function cookieSecure(): boolean {
	if (!dev) return true;
	return (env.APP_URL ?? '').startsWith('https');
}

function cookieFlags(maxAge: number): string {
	const parts = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
	if (cookieSecure()) parts.push('Secure');
	return parts.join('; ');
}

export async function createSessionToken(user: SessionUser): Promise<string> {
	return new SignJWT({
		login: user.login,
		name: user.name,
		avatarUrl: user.avatarUrl
	})
		.setProtectedHeader({ alg: 'HS256' })
		.setSubject(user.userId)
		.setAudience(SESSION_AUD)
		.setIssuedAt()
		.setExpirationTime(`${SESSION_MAX_AGE_SEC}s`)
		.sign(secretKey());
}

export async function readSessionToken(token: string): Promise<SessionUser | null> {
	try {
		const { payload } = await jwtVerify(token, secretKey(), { audience: SESSION_AUD });
		if (typeof payload.sub !== 'string' || !payload.sub) return null;
		if (typeof payload.login !== 'string' || !payload.login) return null;
		return {
			userId: payload.sub,
			login: payload.login,
			name: typeof payload.name === 'string' ? payload.name : null,
			avatarUrl: typeof payload.avatarUrl === 'string' ? payload.avatarUrl : null
		};
	} catch {
		return null;
	}
}

export function sessionCookieHeader(token: string): string {
	return `${COOKIE}=${token}; ${cookieFlags(SESSION_MAX_AGE_SEC)}`;
}

export function clearSessionCookieHeader(): string {
	return `${COOKIE}=; ${cookieFlags(0)}`;
}

function parseCookie(header: string | null, name: string): string | null {
	if (!header) return null;
	for (const part of header.split('; ')) {
		const eq = part.indexOf('=');
		if (eq === -1) continue;
		if (part.slice(0, eq) === name) return part.slice(eq + 1);
	}
	return null;
}

export async function sessionFromRequest(request: Request): Promise<SessionUser | null> {
	const token = parseCookie(request.headers.get('cookie'), COOKIE);
	if (!token) return null;
	return readSessionToken(token);
}

export async function mintActorToken(userId: string, expiresInSec = 10 * 60): Promise<string> {
	return new SignJWT({})
		.setProtectedHeader({ alg: 'HS256' })
		.setSubject(userId)
		.setAudience(ACTOR_AUD)
		.setIssuedAt()
		.setExpirationTime(`${expiresInSec}s`)
		.sign(secretKey());
}
