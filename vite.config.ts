import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// `@rivetkit/svelte` (file: dist) pulls CJS deps like fast-deep-equal; prebundle them.
	optimizeDeps: { include: ['fast-deep-equal', '@rivetkit/framework-base'] },
	ssr: { noExternal: ['@rivetkit/svelte', '@rivetkit/framework-base'] },
	test: {
		expect: { requireAssertions: true },
		environment: 'node',
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
});
