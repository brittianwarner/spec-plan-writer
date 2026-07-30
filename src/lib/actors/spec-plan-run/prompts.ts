/**
 * Prompt builders for the specialist workers and the synthesizer.
 *
 * Every prompt is written for a pi coding agent with a real shell and the
 * shared filesystem — not for a text-only LLM. The prompts name ABSOLUTE
 * paths (the VM's session cwd may be elsewhere) and the collaboration
 * protocol: notes for each other, sections for the synthesizer.
 *
 * The user's editable house rules ride in a fenced `<instructions>` block so
 * they read as authored policy rather than as part of the task, and so a
 * prompt-injection attempt inside them cannot silently replace the mechanics
 * above it.
 */

import {
	LIMITS,
	VM_NOTES_DIR,
	VM_PLAN_DIR,
	VM_REPO_DIR,
	VM_SECTIONS_DIR,
	VM_SPEC_PATH,
	type RoleAssignment
} from '../../protocol/index.ts';

/** Clamp + fence the user's house rules. Empty input yields an empty string. */
export function renderInstructions(instructions: string): string {
	const trimmed = instructions.trim().slice(0, LIMITS.maxInstructionsChars);
	if (!trimmed) return '';
	return ['<instructions>', trimmed, '</instructions>'].join('\n');
}

export function buildWorkerPrompt(a: RoleAssignment): string {
	return [
		`You are the "${a.title}" specialist on a team writing a spec plan for a software change.`,
		'',
		'The problem the user wants planned:',
		a.prompt,
		'',
		`The repository (${a.repoFullName}) is checked out at: ${VM_REPO_DIR}`,
		'Read it. Your sections must be grounded in what is actually there.',
		'',
		`Your focus for this problem: ${a.focus}`,
		`Sections you own (write these, Markdown starting at heading level 2 "## "): ${a.sections.join(', ')}`,
		'',
		'You share this machine with the other specialists on the team:',
		`- ${VM_NOTES_DIR}/ — leave each other short notes. Write ${VM_NOTES_DIR}/${a.roleId}.md with anything the team should know (decisions, open questions, file references). READ the notes already there before you start.`,
		`- ${VM_SECTIONS_DIR}/ — where everyone writes their sections. You may read other sections as they appear to stay consistent.`,
		'',
		`Write ONLY your sections to: ${VM_SECTIONS_DIR}/${a.roleId}.md`,
		'',
		'Follow the author\'s instructions below for voice, standards, and any project-specific rules.',
		renderInstructions(a.instructions)
	]
		.filter((line, i, all) => !(line === '' && all[i - 1] === ''))
		.join('\n');
}

export function buildSynthesizerPrompt(input: {
	prompt: string;
	repoFullName: string;
	rosterLines: string[];
	instructions: string;
}): string {
	return [
		`You are the editor assembling the final spec plan for a change to ${input.repoFullName}.`,
		'',
		'The problem being planned:',
		input.prompt,
		'',
		'A team of specialists wrote sections to this shared filesystem:',
		...input.rosterLines.map((l) => `- ${l}`),
		'',
		`Read every file in ${VM_SECTIONS_DIR}/ and every note in ${VM_NOTES_DIR}/.`,
		`The repository itself is at ${VM_REPO_DIR} if you need to check a claim.`,
		'',
		`Assemble ONE spec plan and write it to: ${VM_SPEC_PATH}`,
		'',
		'Rules:',
		'- Single H1 title; sections in template order: Summary, Context & Problem, Goals & Non-Goals, Requirements, Approach (+ Alternatives Considered), Acceptance Criteria, Milestones, Risks & Mitigations, Assumptions & Open Questions.',
		'- Acceptance criteria are numbered A1, A2, …; milestones are a "- [ ]" checklist.',
		'- Resolve contradictions between specialists; keep the more repository-grounded claim.',
		'- Cut duplicate throat-clearing. The document reads as one voice.',
		`- ${VM_PLAN_DIR}/ is the team's scratch space — the SPEC.md file is the only artifact that matters.`,
		'',
		"Follow the author's instructions below for voice, standards, and any project-specific rules.",
		renderInstructions(input.instructions)
	]
		.filter((line, i, all) => !(line === '' && all[i - 1] === ''))
		.join('\n');
}
