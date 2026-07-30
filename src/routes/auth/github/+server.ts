import type { RequestHandler } from './$types';
import { appOrigin, githubAuthorizeUrl } from '$lib/server/oauth';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

const STATE_COOKIE = 'spw_oauth_state';
const STATE_MAX_AGE = 10 * 60;

function secure(): boolean {
	if (!dev) return true;
	return (env.APP_URL ?? '').startsWith('https');
}

export const GET: RequestHandler = async ({ url }) => {
	const state = crypto.randomUUID();
	const origin = appOrigin(url);
	const redirectUri = `${origin}/auth/github/callback`;
	const authorize = githubAuthorizeUrl(state, redirectUri);

	const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${STATE_MAX_AGE}`];
	if (secure()) flags.push('Secure');

	return new Response(null, {
		status: 302,
		headers: {
			location: authorize,
			'set-cookie': `${STATE_COOKIE}=${state}; ${flags.join('; ')}`
		}
	});
};
