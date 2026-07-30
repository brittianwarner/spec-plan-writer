import type { LayoutServerLoad } from './$types';
import { sessionFromRequest } from '$lib/server/session';
import { getRivetPublicEndpoint } from '$lib/server/rivet';

export const load: LayoutServerLoad = async ({ request }) => {
	const user = await sessionFromRequest(request);
	return {
		user,
		rivetPublicEndpoint: getRivetPublicEndpoint()
	};
};
