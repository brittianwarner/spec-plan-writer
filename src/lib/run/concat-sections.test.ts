import { describe, expect, it } from 'vitest';
import { concatSections, installRosterEntries } from './concat-sections.ts';

describe('installRosterEntries', () => {
	it('assigns ordinals and unique ids on duplicate roles', () => {
		const { roles, pending } = installRosterEntries([
			{ role: 'approach', title: 'A', focus: 'f', sections: ['S'] },
			{ role: 'approach', title: 'B', focus: 'f', sections: ['T'] }
		]);
		expect(pending).toEqual(['approach', 'approach-1']);
		expect(roles['approach'].ordinal).toBe(0);
		expect(roles['approach-1'].ordinal).toBe(1);
	});
});

describe('concatSections', () => {
	it('orders by ordinal and wraps a title when needed', () => {
		const md = concatSections(
			[
				{ roleId: 'b', ordinal: 1 },
				{ roleId: 'a', ordinal: 0 }
			],
			{ a: '## A', b: '## B' },
			'Hello world'
		);
		expect(md.startsWith('# Hello world')).toBe(true);
		expect(md.indexOf('## A')).toBeLessThan(md.indexOf('## B'));
	});

	it('returns body as-is when it already has an H1', () => {
		const body = '# Already\n\n## Sec';
		expect(concatSections([{ roleId: 'a', ordinal: 0 }], { a: body }, 'X')).toBe(body);
	});
});
