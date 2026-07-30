/**
 * OpenRouter access — key verification + the roster planner.
 *
 * Every call uses the END USER's key (collected at onboarding, held by the
 * user actor, injected here). The deployment never needs its own key.
 */

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import { SPECIALIST_ROLES, VERIFY_MODEL, type SpecialistRole } from '../protocol/index.ts';

export interface VerifyKeyResult {
	ok: boolean;
	error?: string;
}

/**
 * Smallest possible live check that a key works against the verify model:
 * one cheap completion with a tiny token budget.
 */
export async function verifyOpenRouterKey(apiKey: string, model = VERIFY_MODEL): Promise<VerifyKeyResult> {
	try {
		const openrouter = createOpenRouter({ apiKey });
		await generateText({
			model: openrouter.chat(model),
			prompt: 'Reply with exactly: ok',
			maxOutputTokens: 8,
			abortSignal: AbortSignal.timeout(30_000)
		});
		return { ok: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return { ok: false, error: message.slice(0, 300) };
	}
}

// ── Roster planner ──────────────────────────────────────────────────────────

const RoleEnum = z.enum(SPECIALIST_ROLES as unknown as [string, ...string[]]);

export const RosterSchema = z.object({
	statusLine: z.string().describe('One calm present-tense line summarizing the plan of attack'),
	roles: z
		.array(
			z.object({
				role: RoleEnum,
				title: z.string().describe('Short human title, e.g. "Requirements"'),
				focus: z.string().describe('What this specialist should concentrate on for THIS problem and repo'),
				sections: z.array(z.string()).describe('Spec section headings this specialist owns')
			})
		)
		.min(2)
		.max(6)
});

export type PlannedRoster = z.infer<typeof RosterSchema>;

export interface PlannerInput {
	prompt: string;
	repoFullName: string;
	fileTree: string[];
	readmeExcerpt: string | null;
	maxRoles: number;
	/** User-editable house rules for this plan. */
	instructions?: string;
}

/**
 * Decompose the problem + repo into a specialist roster. Structured output —
 * the roster drives which workers are dispatched and which spec sections
 * each one owns.
 */
export async function planRoster(apiKey: string, model: string, input: PlannerInput): Promise<PlannedRoster> {
	const openrouter = createOpenRouter({ apiKey });
	const tree = input.fileTree.slice(0, 400).join('\n');
	const readme = input.readmeExcerpt ? `\n\nREADME excerpt:\n${input.readmeExcerpt}` : '';
	const instructions = input.instructions?.trim()
		? `\n\nThe author's instructions for this plan (respect them when choosing roles and sections):\n<instructions>\n${input.instructions.trim()}\n</instructions>`
		: '';

	const { object } = await generateObject({
		model: openrouter.chat(model),
		schema: RosterSchema,
		system: [
			'You decompose a software planning problem into a small team of specialists who will each write part of a spec plan.',
			'The team shares a checked-out copy of the repository and talks to each other through files.',
			'',
			'Roles you may pick from:',
			'- problem-context — Summary + Context/Problem grounding in what the repo actually is',
			'- goals-scope — Goals & Non-Goals, scope line, appetite',
			'- requirements — Functional requirements + constraints, grounded in the real code layout',
			'- approach — Approach/Plan of Attack + Alternatives Considered, referencing real files/modules',
			'- risks — Risks & Mitigations, Assumptions',
			'- milestones — Milestones/Phases + Rollout plan',
			'- acceptance — Acceptance Criteria / Definition of Done / Test plan',
			'- research — Prior art + references (only when the problem has heavy unknowns)',
			'',
			`Always include problem-context, requirements, approach, and acceptance. Add goals-scope when scope is ambiguous, risks+milestones when non-trivial. Cap: ${input.maxRoles} specialists.`,
			'Sections must start at heading level 2 (##). Assign each section to exactly one specialist.'
		].join('\n'),
		prompt: [
			`Repository: ${input.repoFullName}`,
			'',
			'The problem to plan for:',
			input.prompt,
			readme,
			instructions,
			'',
			'Repository file tree (truncated):',
			tree
		].join('\n'),
		abortSignal: AbortSignal.timeout(3 * 60_000)
	});

	return {
		statusLine: object.statusLine,
		roles: object.roles.map((r) => ({ ...r, role: r.role as SpecialistRole }))
	};
}
