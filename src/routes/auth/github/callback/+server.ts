import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { appOrigin, exchangeCode } from '$lib/server/oauth';
import { getRivetClient, internalParams } from '$lib/server/rivet';
import {
	createSessionToken,
	sessionCookieHeader,
	type SessionUser
} from '$lib/server/session';
import { fetchProfile } from '$lib/github/client';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

const STATE_COOKIE = 'spw_oauth_state';

function parseCookie(header: string | null, name: string): string | null {
	if (!header) return null;
	for (const part of header.split('; ')) {
		const eq = part.indexOf('=');
		if (eq === -1) continue;
		if (part.slice(0, eq) === name) return part.slice(eq + 1);
	}
	return null;
}

function secure(): boolean {
	if (!dev) return true;
	return (env.APP_URL ?? '').startsWith('https');
}

function clearOauthStateCookie(): string {
	const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
	if (secure()) flags.push('Secure');
	return `${STATE_COOKIE}=; ${flags.join('; ')}`;
}

function fail(error: string): never {
	redirect(302, `/?error=${error}`);
}

export const GET: RequestHandler = async ({ url, request }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const cookieState = parseCookie(request.headers.get('cookie'), STATE_COOKIE);

	if (!state || !cookieState || state !== cookieState) {
		fail('state');
	}
	if (!code) {
		fail('auth_failed');
	}

	try {
		const origin = appOrigin(url);
		const redirectUri = `${origin}/auth/github/callback`;
		const accessToken = await exchangeCode(code, redirectUri);
		const profile = await fetchProfile(accessToken);
		const userId = String(profile.id);

		const client = getRivetClient();
		const handle = client.user.getOrCreate(['user', userId], {
			params: internalParams()
		});
		await handle.upsertProfile({
			userId,
			login: profile.login,
			name: profile.name,
			avatarUrl: profile.avatar_url,
			githubToken: accessToken
		});

		const user: SessionUser = {
			userId,
			login: profile.login,
			name: profile.name,
			avatarUrl: profile.avatar_url
		};
		const token = await createSessionToken(user);

		return new Response(null, {
			status: 302,
			headers: [
				['location', '/dashboard'],
				['set-cookie', sessionCookieHeader(token)],
				['set-cookie', clearOauthStateCookie()]
			]
		});
	} catch {
		fail('auth_failed');
	}
};
