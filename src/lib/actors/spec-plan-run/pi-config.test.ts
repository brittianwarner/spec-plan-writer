import { describe, expect, it } from 'vitest';
import { PI_MODELS_PATH, PI_SETTINGS_PATH, piModelsFile, piProvisionFiles, piSettingsFile } from './pi-config.ts';

const MODEL = 'openai/gpt-oss-120b:nitro';

describe('pi provisioning files', () => {
	it('pins the requested model as the openrouter default', () => {
		const file = piSettingsFile(MODEL);
		expect(file.path).toBe(PI_SETTINGS_PATH);
		expect(JSON.parse(file.content)).toEqual({
			defaultProvider: 'openrouter',
			defaultModel: MODEL
		});
	});

	it('registers the model so pi cannot silently fall back to its built-in default', () => {
		const file = piModelsFile(MODEL);
		expect(file.path).toBe(PI_MODELS_PATH);
		const parsed = JSON.parse(file.content);
		const provider = parsed.providers.openrouter;
		expect(provider.baseUrl).toBe('https://openrouter.ai/api/v1');
		expect(provider.models.map((m: { id: string }) => m.id)).toContain(MODEL);
	});

	it('reads the key from the session env by name, never embedding a secret', () => {
		const provider = JSON.parse(piModelsFile(MODEL).content).providers.openrouter;
		expect(provider.apiKey).toBe('OPENROUTER_API_KEY');
	});

	it('gives every model the full four-field cost object pi requires', () => {
		const provider = JSON.parse(piModelsFile(MODEL).content).providers.openrouter;
		for (const model of provider.models) {
			expect(Object.keys(model.cost).sort()).toEqual([
				'cacheRead',
				'cacheWrite',
				'input',
				'output'
			]);
		}
	});

	it('writes both files under the agentOS home agent dir', () => {
		const paths = piProvisionFiles(MODEL).map((f) => f.path);
		expect(paths).toEqual([PI_SETTINGS_PATH, PI_MODELS_PATH]);
		for (const path of paths) expect(path.startsWith('/home/agentos/.pi/agent/')).toBe(true);
	});
});
