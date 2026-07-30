/**
 * Pi model routing inside the VM.
 *
 * The pi adapter reads its model from `settings.json` (`defaultProvider` /
 * `defaultModel`) and merges custom models from `models.json` — both under the
 * agent dir at `$HOME/.pi/agent/`, and the stock agentOS HOME is
 * `/home/agentos`. An unknown `defaultModel` does NOT error: pi silently falls
 * back to its built-in default, so the model we want MUST be registered in
 * the provider block here.
 *
 * The `apiKey` value is resolved through pi's config resolver, which checks
 * the session env FIRST — so the literal string "OPENROUTER_API_KEY" reads
 * the user's key from the session env and no secret is ever written to disk.
 */

export const PI_SETTINGS_PATH = '/home/agentos/.pi/agent/settings.json';
export const PI_MODELS_PATH = '/home/agentos/.pi/agent/models.json';

export interface PiSettings {
	defaultProvider: string;
	defaultModel: string;
}

export function piSettingsFile(model: string): { path: string; content: string } {
	const settings: PiSettings = { defaultProvider: 'openrouter', defaultModel: model };
	return { path: PI_SETTINGS_PATH, content: JSON.stringify(settings, null, 2) };
}

/**
 * Register the OpenRouter models pi's built-in catalog doesn't know. Every
 * model needs the full four-field `cost` object or pi drops the WHOLE file.
 * Pricing is display-only (usage stats); keep it roughly right.
 */
export function piModelsFile(model: string): { path: string; content: string } {
	const config = {
		providers: {
			openrouter: {
				baseUrl: 'https://openrouter.ai/api/v1',
				apiKey: 'OPENROUTER_API_KEY',
				models: [
					{
						id: model,
						name: model,
						api: 'openai-completions',
						reasoning: true,
						input: ['text'],
						cost: { input: 0.05, output: 0.25, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 131_072,
						maxTokens: 32_768
					}
				]
			}
		}
	};
	return { path: PI_MODELS_PATH, content: JSON.stringify(config, null, 2) };
}

/** All files a pi session needs; write into the VM before sessions.open. */
export function piProvisionFiles(model: string): Array<{ path: string; content: string }> {
	return [piSettingsFile(model), piModelsFile(model)];
}
