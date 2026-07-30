/**
 * Actor-side environment access.
 *
 * Runs in THREE places: the standalone actor server (node strip-types), the
 * SvelteKit server bundle (type-only imports), and vitest. SvelteKit's `$env`
 * modules are NOT available here — `process.env` only.
 */

export function env(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
}

/** HS256 secret signing browser session cookies + actor connection tokens. */
export function authSecret(): string {
	const secret = env('AUTH_SECRET');
	if (!secret || secret.length < 32) {
		throw new Error('AUTH_SECRET must be set (>= 32 chars). See .env.example.');
	}
	return secret;
}

/** Shared secret stamping actor-to-actor and server-to-actor connections. */
export function internalSecret(): string {
	const secret = env('INTERNAL_SECRET');
	if (!secret || secret.length < 32) {
		throw new Error('INTERNAL_SECRET must be set (>= 32 chars). See .env.example.');
	}
	return secret;
}

/**
 * WebSocket origin allowlist for browser actor connections. Rivet has no
 * WebSocket CORS — this check is the only one there is. Empty list: hard deny
 * when running against Rivet Cloud, allow in local dev (engine has no origin).
 */
export function allowedOrigins(): string[] {
	return (env('ALLOWED_ORIGINS') ?? '')
		.split(',')
		.map((o) => o.trim())
		.filter(Boolean);
}

export function isLocalDev(): boolean {
	return !env('RIVET_ENDPOINT');
}

export function planModel(): string {
	return env('SPEC_PLAN_MODEL') ?? 'openai/gpt-oss-120b:nitro';
}

export function piModel(): string {
	return env('PI_MODEL') ?? 'openai/gpt-oss-120b:nitro';
}

export function maxParallelWorkers(): number {
	const raw = Number(env('SPEC_PLAN_MAX_PARALLEL') ?? '4');
	if (!Number.isFinite(raw)) return 4;
	return Math.min(8, Math.max(1, Math.floor(raw)));
}

export interface S3MountConfig {
	bucket: string;
	prefix: string;
	region: string;
	endpoint?: string;
	credentials?: { accessKeyId: string; secretAccessKey: string };
}

/**
 * Shared agent-filesystem mount config, or null when unconfigured (the VM's
 * own persisted filesystem is used — identical behavior, less durability).
 */
export function s3MountConfig(): S3MountConfig | null {
	const bucket = env('SPEC_S3_BUCKET');
	if (!bucket) return null;
	const accessKeyId = env('SPEC_S3_ACCESS_KEY_ID');
	const secretAccessKey = env('SPEC_S3_SECRET_ACCESS_KEY');
	return {
		bucket,
		prefix: env('SPEC_S3_PREFIX') ?? 'spec-plan-writer/',
		region: env('SPEC_S3_REGION') ?? 'auto',
		endpoint: env('SPEC_S3_ENDPOINT'),
		credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined
	};
}

export function blobToken(): string | undefined {
	return env('BLOB_READ_WRITE_TOKEN');
}
