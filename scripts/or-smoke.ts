/**
 * Smallest live check that a given OpenRouter key works against the verify model.
 * Usage: OPENROUTER_API_KEY=sk-or-… node scripts/or-smoke.ts
 */
import { verifyOpenRouterKey } from '../src/lib/ai/openrouter.ts';
import { VERIFY_MODEL } from '../src/lib/protocol/index.ts';

const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) {
	console.error('Set OPENROUTER_API_KEY');
	process.exit(1);
}

const result = await verifyOpenRouterKey(key, VERIFY_MODEL);
if (!result.ok) {
	console.error('verify failed:', result.error);
	process.exit(1);
}
console.log(`ok · ${VERIFY_MODEL}`);
