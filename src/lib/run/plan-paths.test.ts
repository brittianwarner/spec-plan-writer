import { describe, expect, it } from 'vitest';
import { buildSpecPrPaths, slugifyPlanTitle } from './plan-paths.ts';

describe('slugifyPlanTitle', () => {
	it('normalizes punctuation and caps length', () => {
		expect(slugifyPlanTitle('Auth Flow!')).toBe('auth-flow');
		expect(slugifyPlanTitle('!!!')).toBe('spec-plan');
		expect(slugifyPlanTitle('a'.repeat(60))).toHaveLength(48);
	});
});

describe('buildSpecPrPaths', () => {
	it('builds stable branch and path', () => {
		const p = buildSpecPrPaths({ title: 'Auth Flow', version: 3, date: '2026-07-30' });
		expect(p.branch).toBe('spec-plan/auth-flow-3');
		expect(p.path).toBe('docs/spec-plans/2026-07-30-auth-flow.md');
	});
});
