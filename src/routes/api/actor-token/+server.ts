import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { mintActorToken, sessionFromRequest } from '$lib/server/session';
import { getRivetPublicEndpoint } from '$lib/server/rivet';

export const GET: RequestHandler = async ({ request }) => {
	const user = await sessionFromRequest(request);
	if (!user) error(401, 'Unauthorized');

	const token = await mintActorToken(user.userId);
	return json(
		{ token, endpoint: getRivetPublicEndpoint() },
		{ headers: { 'cache-control': 'private, no-store' } }
	);
};
