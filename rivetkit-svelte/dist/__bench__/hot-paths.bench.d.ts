/**
 * Hot-path microbenchmarks for @rivetkit/svelte.
 *
 * Measures the JS-level cost of the most frequently exercised paths:
 *  - Proxy `get` trap (every actor.method access)
 *  - Method cache lookup chain
 *  - applyState (subscribe firing)
 *  - createReactiveActor cold-start
 *  - Action interceptor wrapping
 *  - extract(MaybeGetter)
 *  - mergeActionDefaults
 *  - preloadActor hash generation
 *
 * Reactivity itself is shimmed (runes-shim) — we are measuring the JS
 * overhead the adapter adds on top of Svelte's reactivity primitives.
 *
 * Run with: `bun run --filter @rivetkit/svelte bench`
 */
import "../__tests__/runes-shim.js";
//# sourceMappingURL=hot-paths.bench.d.ts.map