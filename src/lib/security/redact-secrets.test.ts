import { describe, expect, it } from 'vitest';
import { redactSecrets } from './redact-secrets.ts';

describe('redactSecrets', () => {
	it('scrubs common token shapes', () => {
		expect(redactSecrets('x-access-token:gho_ABCDEF')).toContain('[redacted]');
		expect(redactSecrets('ghp_ABCDEFGHIJKLMNOP')).toContain('[redacted]');
		expect(redactSecrets('sk-or-v1-abc_def-ghi')).toContain('[redacted]');
		expect(redactSecrets('Authorization: Bearer legaleTOKENVALUE1234567890')).toContain('[redacted]');
	});

	it('leaves non-secret text alone', () => {
		expect(redactSecrets('plain status')).toBe('plain status');
	});
});
