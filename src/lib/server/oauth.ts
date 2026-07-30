import { env } from '$env/dynamic/private';

/**
 * Public origin used for OAuth redirect_uri.
 * Honors `APP_URL` when set; otherwise derives from the request.
 * Prefer browsing at http://127.0.0.1:5173 locally so redirect_uri matches
 * the GitHub OAuth App and Rivet's IPv4 pool URL.
 */
export function appOrigin(url: URL): string {
	const configured = env.APP_URL?.replace(/\/$/, '');
	if (configured) return configured;
	return `${url.protocol}//${url.host}`;
}

export function githubAuthorizeUrl(state: string, redirectUri: string): string {
	const clientId = env.GITHUB_CLIENT_ID;
	if (!clientId) throw new Error('GITHUB_CLIENT_ID required');
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		scope: 'read:user repo',
		state
	});
	return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<string> {
	const clientId = env.GITHUB_CLIENT_ID;
	const clientSecret = env.GITHUB_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error('GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET required');
	}

	const res = await fetch('https://github.com/login/oauth/access_token', {
		method: 'POST',
		headers: {
			accept: 'application/json',
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			client_id: clientId,
			client_secret: clientSecret,
			code,
			redirect_uri: redirectUri
		})
	});

	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`GitHub token exchange failed (${res.status}): ${body.slice(0, 200)}`);
	}

	const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
	if (!data.access_token) {
		throw new Error(data.error_description || data.error || 'No access_token from GitHub');
	}
	return data.access_token;
}
