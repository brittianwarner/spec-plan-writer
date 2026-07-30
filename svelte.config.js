import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// Actors (and agentOS) run on Rivet Compute, not Vercel. No need to
		// externalize the agentOS package here — the frontend only type-imports
		// the registry anduses rivetkit/client.
		adapter: adapter()
	}
};

export default config;
