import type { RequestHandler } from './$types';
import { clearSessionCookieHeader, sessionFromRequest } from '$lib/server/session';
import { getRivetClient, internalParams } from '$lib/server/rivet';

async function logout(request: Request): Promise<Response> {
	const user = await sessionFromRequest(request);
	if (user) {
		try {
			const client = getRivetClient() as unknown as {
				user: {
					getOrCreate: (
						key: readonly string[],
						opts?: { params?: unknown }
					) => { clearSecrets: () => Promise<unknown> };
				};
			};
			await client.user
				.getOrCreate(['user', user.userId], { params: internalParams() })
				.clearSecrets();
		} catch {
			// never block logout on actor failure
		}
	}
	return new Response(null, {
		status: 302,
		headers: {
			location: '/',
			'set-cookie': clearSessionCookieHeader()
		}
	});
}

export const POST: RequestHandler = async ({ request }) => logout(request);
