import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { rivetDevMiddleware } from './vite-plugin-rivet-dev';

export default defineConfig({
	plugins: [
		// Before sveltekit so /api/rivet keeps Rivet's raw start payload in dev.
		rivetDevMiddleware(),
		tailwindcss(),
		sveltekit()
	],
	// Bind IPv4 loopback. Rivet's local engine calls
	// configurePool → http://127.0.0.1:5173/api/rivet — if Vite only listens on
	// [::1] (the default when host is unset on some macOS Node builds), every
	// actor wake hangs forever and OAuth never finishes.
	server: {
		host: '127.0.0.1',
		port: 5173,
		strictPort: true
	},
	// `@rivetkit/svelte` (file: dist) pulls CJS deps like fast-deep-equal; prebundle them.
	optimizeDeps: { include: ['fast-deep-equal', '@rivetkit/framework-base'] },
	ssr: { noExternal: ['@rivetkit/svelte', '@rivetkit/framework-base'] },
	test: {
		expect: { requireAssertions: true },
		environment: 'node',
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
});
