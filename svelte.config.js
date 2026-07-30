import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// One deployable: UI + Rivet serverless mount at `/api/rivet/*`.
		// Browser WS goes to Rivet Cloud; Rivet Cloud HTTPS-callbacks this origin.
		// @see https://rivet.dev/docs/deploy/vercel
		adapter: adapter()
	}
};

export default config;
