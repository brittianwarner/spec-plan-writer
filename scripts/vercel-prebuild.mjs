/**
 * Vercel-only prebuild: prune platform-specific Rivet binaries that nft would
 * otherwise trace into the serverless function bundle.
 *
 * Vercel functions run linux-x64 (glibc). Keeping the macOS napi binary
 * (~37MB) and engine-cli binaries inflates the /api/rivet function past the
 * 250MB unzipped limit and slows cold starts for zero benefit.
 *
 * Runs ONLY as part of `vercel-build` — local dev keeps its own binaries.
 */

import { readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const RIVETKIT = join(process.cwd(), 'node_modules', '@rivetkit');

// Platform napi binaries (~25-37MB each). The function already runs on
// RivetKit's WASM runtime fallback on Vercel (the linux binary was never
// traced and user/specPlan actors work fine), so dropping every
// rivetkit-napi-<platform> package is safe and keeps the function under the
// 250MB unzipped limit. `rivetkit-napi` (the tiny loader) stays.
const KEEP = new Set();

const PRUNE_PREFIXES = ['rivetkit-napi-', 'engine-cli-'];

let removed = 0;
if (existsSync(RIVETKIT)) {
	for (const entry of readdirSync(RIVETKIT)) {
		if (!PRUNE_PREFIXES.some((p) => entry.startsWith(p))) continue;
		if (KEEP.has(entry)) continue;
		rmSync(join(RIVETKIT, entry), { recursive: true, force: true });
		removed += 1;
	}
}
console.log(`[vercel-prebuild] pruned ${removed} non-linux @rivetkit binary package(s)`);
