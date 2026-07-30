import { describe, expect, it } from 'vitest';
import { buildSynthesizerPrompt, buildWorkerPrompt, renderInstructions } from './prompts.ts';
import {
	LIMITS,
	VM_NOTES_DIR,
	VM_REPO_DIR,
	VM_SECTIONS_DIR,
	VM_SPEC_PATH,
	type RoleAssignment
} from '../../protocol/index.ts';

const assignment: RoleAssignment = {
	userId: 'u1',
	planId: 'p1',
	runId: 'r1',
	roleId: 'requirements',
	role: 'requirements',
	title: 'Requirements',
	focus: 'What must be true when the work is done',
	sections: ['Requirements', 'Constraints'],
	ordinal: 2,
	prompt: 'Add SSO to the admin console',
	instructions: 'Cite files. No marketing language.',
	repoFullName: 'acme/console'
};

describe('renderInstructions', () => {
	it('fences authored rules so they read as policy, not task text', () => {
		expect(renderInstructions('be terse')).toBe('<instructions>\nbe terse\n</instructions>');
	});

	it('returns empty string for blank input rather than an empty block', () => {
		expect(renderInstructions('   \n  ')).toBe('');
	});

	it('clamps to the protocol ceiling', () => {
		const rendered = renderInstructions('x'.repeat(LIMITS.maxInstructionsChars + 500));
		const body = rendered.replace('<instructions>\n', '').replace('\n</instructions>', '');
		expect(body).toHaveLength(LIMITS.maxInstructionsChars);
	});
});

describe('buildWorkerPrompt', () => {
	const prompt = buildWorkerPrompt(assignment);

	it('carries the user problem and the specialist focus', () => {
		expect(prompt).toContain('Add SSO to the admin console');
		expect(prompt).toContain('What must be true when the work is done');
		expect(prompt).toContain('Requirements, Constraints');
	});

	it('names absolute shared-filesystem paths for repo, notes, and its own section', () => {
		expect(prompt).toContain(VM_REPO_DIR);
		expect(prompt).toContain(`${VM_NOTES_DIR}/requirements.md`);
		expect(prompt).toContain(`${VM_SECTIONS_DIR}/requirements.md`);
	});

	it('injects the plan instructions in a fenced block', () => {
		expect(prompt).toContain('<instructions>\nCite files. No marketing language.\n</instructions>');
	});

	it('omits the block entirely when the user cleared their instructions', () => {
		expect(buildWorkerPrompt({ ...assignment, instructions: '' })).not.toContain('<instructions>');
	});
});

describe('buildSynthesizerPrompt', () => {
	const prompt = buildSynthesizerPrompt({
		prompt: assignment.prompt,
		repoFullName: assignment.repoFullName,
		rosterLines: ['Requirements (requirements) → sections'],
		instructions: assignment.instructions
	});

	it('targets the single SPEC.md artifact', () => {
		expect(prompt).toContain(VM_SPEC_PATH);
		expect(prompt).toContain(VM_SECTIONS_DIR);
	});

	it('lists the roster it must reconcile', () => {
		expect(prompt).toContain('Requirements (requirements) → sections');
	});

	it('injects the same authored instructions the workers received', () => {
		expect(prompt).toContain('<instructions>\nCite files. No marketing language.\n</instructions>');
	});
});
