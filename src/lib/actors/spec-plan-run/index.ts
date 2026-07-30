import { actor, queue } from 'rivetkit';
import { workflow } from 'rivetkit/workflow';
import { put } from '@vercel/blob';
import type {
	AgentCard,
	RoleAssignment,
	RoleReport,
	SpecialistRole,
	WorkerStatus
} from '../../protocol/index.ts';
import {
	DEFAULT_INSTRUCTIONS,
	LIMITS,
	VM_SECTIONS_DIR,
	actorKeys
} from '../../protocol/index.ts';
import { planRoster } from '../../ai/openrouter.ts';
import {
	assertInternal,
	bindInternalOnlyConnect,
	internalParams,
	redactSecrets,
	type AppConnState
} from '../auth.ts';
import { blobToken, maxParallelWorkers, piModel, planModel } from '../env.ts';
import { buildSynthesizerPrompt } from './prompts.ts';
import { concatSections as concatSectionList, installRosterEntries } from '../../run/concat-sections.ts';
import type { PlanStatus, RunInput as ProtocolRunInput, RunPhase } from '../../protocol/index.ts';
import {
	collectPlannerContext,
	provisionWorkspace,
	readSpecMarkdown,
	runPiPrompt,
	writePiConfig,
	type VmHandle
} from './provision.ts';

export type RunInput = ProtocolRunInput;

interface RoleEntry {
	roleId: string;
	role: SpecialistRole;
	title: string;
	focus: string;
	sections: string[];
	ordinal: number;
	status: WorkerStatus;
	thought: string;
}

interface RunState {
	userId: string;
	planId: string;
	runId: string;
	prompt: string;
	instructions: string;
	repoFullName: string;
	defaultBranch: string;
	pending: string[];
	active: string[];
	roles: Record<string, RoleEntry>;
	sections: Record<string, string>;
	cancelRequested: string | null;
	finished: boolean;
	priorStatus: PlanStatus;
}

interface UserSecrets {
	githubToken: string;
	openrouterKey: string | null;
}

interface SpecPlanMirror {
	mirrorPhase(input: { phase: RunPhase; statusLine?: string }): Promise<unknown>;
	mirrorRoster(input: { agents: AgentCard[] }): Promise<unknown>;
	setWorkerStatus(input: {
		roleId: string;
		status: WorkerStatus;
		thought?: string;
	}): Promise<unknown>;
	commitDoc(input: {
		runId: string;
		markdown: string;
		artifactUrl?: string | null;
	}): Promise<{ version: number }>;
}

interface UserMirror {
	getSecrets(): Promise<UserSecrets>;
	markPlanStatus(input: {
		planId: string;
		status: PlanStatus;
		roleCount?: number;
		generatedAt?: number;
	}): Promise<unknown>;
}

interface SiblingClient {
	user: {
		getOrCreate(key: readonly string[], opts?: { params?: unknown }): UserMirror;
	};
	specPlan: {
		getOrCreate(key: readonly string[], opts?: { params?: unknown }): SpecPlanMirror;
	};
	vm: {
		getOrCreate(key: readonly string[], opts?: { params?: unknown }): VmHandle;
	};
	specPlanWorker: {
		getOrCreate(
			key: readonly string[],
			opts?: { createWithInput?: RoleAssignment; params?: unknown }
		): unknown;
	};
}

const FALLBACK_ROLES: Array<{
	role: SpecialistRole;
	title: string;
	focus: string;
	sections: string[];
}> = [
	{
		role: 'approach',
		title: 'Spec Author',
		focus: 'Write the full specification end to end, grounded in the repository.',
		sections: [
			'Summary',
			'Context',
			'Goals',
			'Requirements',
			'Approach',
			'Acceptance'
		]
	}
];

const PLANNER_STEP_TIMEOUT_MS = 210_000;
const SYNTHESIZER_STEP_TIMEOUT_MS = 510_000;

function emptyState(): RunState {
	return {
		userId: '',
		planId: '',
		runId: '',
		prompt: '',
		instructions: '',
		repoFullName: '',
		defaultBranch: 'main',
		pending: [],
		active: [],
		roles: {},
		sections: {},
		cancelRequested: null,
		finished: false,
		priorStatus: 'draft'
	};
}

function siblings(step: { client: () => unknown }): SiblingClient {
	return step.client() as unknown as SiblingClient;
}

function buildRoster(state: RunState): AgentCard[] {
	return Object.values(state.roles)
		.sort((a, b) => a.ordinal - b.ordinal)
		.map((r) => ({
			roleId: r.roleId,
			role: r.role,
			title: r.title,
			focus: r.focus,
			sections: r.sections,
			ordinal: r.ordinal,
			status: r.status,
			thought: r.thought
		}));
}

function installRoster(
	state: RunState,
	roles: Array<{
		role: string;
		title: string;
		focus: string;
		sections: string[];
	}>
): void {
	const installed = installRosterEntries(roles);
	state.roles = installed.roles;
	state.pending = installed.pending;
	state.active = [];
	state.sections = {};
}

async function mirrorPhase(
	step: { client: () => unknown },
	state: RunState,
	phase: RunPhase,
	statusLine?: string
): Promise<void> {
	try {
		await siblings(step)
			.specPlan.getOrCreate(actorKeys.specPlan(state.userId, state.planId), {
				params: internalParams()
			})
			.mirrorPhase({
				phase,
				statusLine: statusLine !== undefined ? redactSecrets(statusLine) : undefined
			});
	} catch {
		// best-effort
	}
}

async function mirrorRoster(step: { client: () => unknown }, state: RunState): Promise<void> {
	try {
		await siblings(step)
			.specPlan.getOrCreate(actorKeys.specPlan(state.userId, state.planId), {
				params: internalParams()
			})
			.mirrorRoster({ agents: buildRoster(state) });
	} catch {
		// best-effort
	}
}

async function markStatus(
	step: { client: () => unknown },
	state: RunState,
	status: PlanStatus,
	extra?: { roleCount?: number; generatedAt?: number }
): Promise<void> {
	try {
		await siblings(step)
			.user.getOrCreate(actorKeys.user(state.userId), { params: internalParams() })
			.markPlanStatus({
				planId: state.planId,
				status,
				roleCount: extra?.roleCount,
				generatedAt: extra?.generatedAt
			});
	} catch {
		// best-effort
	}
}

async function dispatchMore(step: {
	client: () => unknown;
	state: RunState;
}): Promise<void> {
	const state = step.state;
	const client = siblings(step);
	const budget = maxParallelWorkers();

	while (state.active.length < budget && state.pending.length > 0) {
		const roleId = state.pending.shift();
		if (!roleId) break;
		const entry = state.roles[roleId];
		if (!entry) continue;

		entry.status = 'running';
		entry.thought = 'Starting…';
		state.active.push(roleId);

		try {
			await client.specPlan
				.getOrCreate(actorKeys.specPlan(state.userId, state.planId), {
					params: internalParams()
				})
				.setWorkerStatus({ roleId, status: 'running', thought: 'Starting…' });
		} catch {
			// best-effort
		}

		const assignment: RoleAssignment = {
			userId: state.userId,
			planId: state.planId,
			runId: state.runId,
			roleId: entry.roleId,
			role: entry.role,
			title: entry.title,
			focus: entry.focus,
			sections: entry.sections,
			ordinal: entry.ordinal,
			prompt: state.prompt,
			instructions: state.instructions,
			repoFullName: state.repoFullName
		};

		try {
			// getOrCreate is idempotent under redelivery: a replay of this
			// step will not invent a second worker instance for the same key.
			await client.specPlanWorker.getOrCreate(
				actorKeys.specPlanWorker(state.userId, state.planId, state.runId, roleId),
				{ createWithInput: assignment, params: internalParams() }
			);
		} catch {
			entry.status = 'error';
			entry.thought = 'Could not start worker.';
			const idx = state.active.indexOf(roleId);
			if (idx >= 0) state.active.splice(idx, 1);
			state.sections[roleId] = '';
		}
	}

	await mirrorRoster(step, state);
}

function concatPlanSections(state: RunState, titleHint: string): string {
	return concatSectionList(Object.values(state.roles), state.sections, titleHint);
}


const internalOnly = {
	canPublish: (c: { conn?: { state?: AppConnState } | null }) =>
		!c.conn || c.conn.state?.isInternal === true
};

export const specPlanRun = actor({
	options: {
		name: 'Spec Plan Run',
		icon: 'diagram-project',
		sleepTimeout: 300_000,
		actionTimeout: 10 * 60_000
	},

	createState: (_c, input?: Partial<RunInput>): RunState => ({
		...emptyState(),
		userId: input?.userId ?? '',
		planId: input?.planId ?? '',
		runId: input?.runId ?? '',
		prompt: input?.prompt ?? '',
		instructions: input?.instructions ?? DEFAULT_INSTRUCTIONS,
		priorStatus: input?.priorStatus ?? 'draft',
		repoFullName: input?.repoFullName ?? '',
		defaultBranch: input?.defaultBranch ?? 'main'
	}),

	queues: {
		roleEvents: queue<RoleReport, undefined, { conn?: { state?: AppConnState } | null }>(
			internalOnly
		),
		cancel: queue<{ runId: string; reason?: string }, undefined, {
			conn?: { state?: AppConnState } | null;
		}>(internalOnly)
	},

	...bindInternalOnlyConnect(),

	run: workflow(async (ctx) => {
		try {
			await ctx.step('provision', async (step) => {
				const state = step.state;
				const client = siblings(step);

				await mirrorPhase(step, state, 'provisioning', 'Waking the shared workspace…');

				const secrets = await client.user
					.getOrCreate(actorKeys.user(state.userId), { params: internalParams() })
					.getSecrets();

				if (!secrets.openrouterKey) {
					throw new Error('Add your OpenRouter key before generating a plan.');
				}
				if (!secrets.githubToken) {
					throw new Error('GitHub is not connected.');
				}

				const vm = client.vm.getOrCreate(actorKeys.vm(state.userId, state.planId), { params: internalParams() });
				const result = await provisionWorkspace(vm, {
					userId: state.userId,
					planId: state.planId,
					repoFullName: state.repoFullName,
					defaultBranch: state.defaultBranch,
					githubToken: secrets.githubToken,
					model: piModel()
				});
				await mirrorPhase(step, state, 'provisioning', result.statusLine);
			});

			const planned = await ctx.tryStep({
				name: 'plan-roster',
				timeout: PLANNER_STEP_TIMEOUT_MS,
				maxRetries: 0,
				run: async (step) => {
					const state = step.state;
					const client = siblings(step);
					await mirrorPhase(step, state, 'planning', 'Choosing specialists…');

					const secrets = await client.user
						.getOrCreate(actorKeys.user(state.userId), { params: internalParams() })
						.getSecrets();
					const openrouterKey = secrets.openrouterKey;
					if (!openrouterKey) throw new Error('OpenRouter key missing');

					const vm = client.vm.getOrCreate(actorKeys.vm(state.userId, state.planId), { params: internalParams() });
					const { fileTree, readmeExcerpt } = await collectPlannerContext(vm);
					const roster = await planRoster(openrouterKey, planModel(), {
						prompt: state.prompt,
						repoFullName: state.repoFullName,
						instructions: state.instructions,
						fileTree,
						readmeExcerpt,
						maxRoles: LIMITS.maxRosterSize
					});

					if (!roster.roles.length) throw new Error('Planner returned an empty roster');

					installRoster(state, roster.roles);
					await mirrorRoster(step, state);
					await mirrorPhase(
						step,
						state,
						'planning',
						roster.statusLine || 'Specialists ready.'
					);
					await markStatus(step, state, 'generating', {
						roleCount: roster.roles.length
					});
					return roster.statusLine;
				}
			});

			if (!planned.ok) {
				await ctx.step('repair-roster', async (step) => {
					const state = step.state;
					installRoster(state, FALLBACK_ROLES);
					await mirrorRoster(step, state);
					await mirrorPhase(
						step,
						state,
						'planning',
						'Using the default specialist roster.'
					);
					await markStatus(step, state, 'generating', {
						roleCount: FALLBACK_ROLES.length
					});
				});
			}

			await ctx.step('dispatch-initial', async (step) => {
				const state = step.state;
				if (Object.keys(state.roles).length === 0) {
					installRoster(state, FALLBACK_ROLES);
					await markStatus(step, state, 'generating', {
						roleCount: FALLBACK_ROLES.length
					});
				}
				await mirrorPhase(step, state, 'writing', 'Specialists are writing…');
				await dispatchMore(step);
			});

			let cancelled = false;
			let iter = 0;
			while (true) {
				const stop = await ctx.step(`drain-check:${iter}`, async (step) => {
					const state = step.state;
					if (state.cancelRequested) return 'cancel';
					if (state.active.length === 0 && state.pending.length === 0) return 'done';
					return '';
				});
				if (stop === 'cancel') {
					cancelled = true;
					break;
				}
				if (stop === 'done') break;

				const [msg] = await ctx.queue.nextBatch(`wait-evt:${iter}`, {
					names: ['roleEvents', 'cancel'],
					timeout: LIMITS.runDrainTimeoutMs
				});
				iter += 1;

				if (!msg) {
					await ctx.step(`straggler:${iter}`, async (step) => {
						const state = step.state;
						for (const roleId of [...state.active]) {
							const entry = state.roles[roleId];
							if (entry) {
								entry.status = 'error';
								entry.thought = 'Timed out waiting for this specialist.';
							}
							try {
								await siblings(step)
									.specPlan.getOrCreate(
										actorKeys.specPlan(state.userId, state.planId),
										{ params: internalParams() }
									)
									.setWorkerStatus({
										roleId,
										status: 'error',
										thought: 'Timed out.'
									});
							} catch {
								// best-effort
							}
						}
						state.active = [];
						if (!state.cancelRequested) await dispatchMore(step);
					});
					const remains = await ctx.step(`after-straggler:${iter}`, async (step) =>
						step.state.active.length > 0 || step.state.pending.length > 0
					);
					if (!remains) break;
					continue;
				}

				if (msg.name === 'cancel') {
					await ctx.step(`apply-cancel:${iter}`, async (step) => {
						step.state.cancelRequested = step.state.runId;
					});
					continue;
				}

				if (msg.name === 'roleEvents') {
					await ctx.step(`apply-role:${iter}`, async (step) => {
						const state = step.state;
						const body = msg.body as RoleReport;
						if (body.runId !== state.runId) return;

						const entry = state.roles[body.roleId];
						if (body.status === 'running') {
							if (entry) {
								entry.status = 'running';
								if (body.thought) entry.thought = body.thought;
							}
							try {
								await siblings(step)
									.specPlan.getOrCreate(
										actorKeys.specPlan(state.userId, state.planId),
										{ params: internalParams() }
									)
									.setWorkerStatus({
										roleId: body.roleId,
										status: 'running',
										thought: body.thought
									});
							} catch {
								// best-effort
							}
							return;
						}

						const idx = state.active.indexOf(body.roleId);
						if (idx >= 0) state.active.splice(idx, 1);
						if (entry) {
							entry.status = body.status === 'complete' ? 'done' : 'error';
							entry.thought =
								body.thought ??
								(body.status === 'complete' ? 'Done.' : 'Failed.');
						}
						state.sections[body.roleId] = body.sectionMd ?? '';

						try {
							await siblings(step)
								.specPlan.getOrCreate(
									actorKeys.specPlan(state.userId, state.planId),
									{ params: internalParams() }
								)
								.setWorkerStatus({
									roleId: body.roleId,
									status: body.status === 'complete' ? 'done' : 'error',
									thought: entry?.thought
								});
						} catch {
							// best-effort
						}

						if (!state.cancelRequested) {
							await dispatchMore(step);
						}
					});
				}
			}

			if (cancelled) {
				await ctx.step('finalize-cancelled', async (step) => {
					const state = step.state;
					await mirrorPhase(step, state, 'cancelled', 'Cancelled.');
					await markStatus(step, state, state.priorStatus === 'ready' ? 'ready' : 'draft', {
						roleCount: Object.keys(state.roles).length
					});
					state.finished = true;
					state.cancelRequested = null;
				});
				return;
			}

			// Final cancel fence — a cancel that landed after drain finished
			// must still skip synthesis/persist (authoritative terminal).
			const cancelAfterDrain = await ctx.step('cancel-fence', async (step) => {
				return Boolean(step.state.cancelRequested);
			});
			if (cancelAfterDrain) {
				await ctx.step('finalize-cancelled-late', async (step) => {
					const state = step.state;
					await mirrorPhase(step, state, 'cancelled', 'Cancelled.');
					await markStatus(step, state, state.priorStatus === 'ready' ? 'ready' : 'draft', {
						roleCount: Object.keys(state.roles).length
					});
					state.finished = true;
					state.cancelRequested = null;
				});
				return;
			}

			const synthesized = await ctx.tryStep({
				name: 'synthesize',
				timeout: SYNTHESIZER_STEP_TIMEOUT_MS,
				maxRetries: 0,
				run: async (step) => {
					const state = step.state;
					const client = siblings(step);
					await mirrorPhase(step, state, 'synthesizing', 'Assembling the final plan…');

					const secrets = await client.user
						.getOrCreate(actorKeys.user(state.userId), { params: internalParams() })
						.getSecrets();
					const openrouterKey = secrets.openrouterKey;
					if (!openrouterKey) return concatPlanSections(state, state.prompt);

					const vm = client.vm.getOrCreate(actorKeys.vm(state.userId, state.planId), { params: internalParams() });
					await writePiConfig(vm, piModel());

					const rosterLines = Object.values(state.roles)
						.sort((a, b) => a.ordinal - b.ordinal)
						.map(
							(r) =>
								`${r.title} (${r.roleId}) → ${VM_SECTIONS_DIR}/${r.roleId}.md · ${r.sections.join(', ')}`
						);

					const result = await runPiPrompt(vm, {
						openrouterKey,
						prompt: buildSynthesizerPrompt({
							prompt: state.prompt,
							repoFullName: state.repoFullName,
							rosterLines,
							instructions: state.instructions
						}),
						connectParams: internalParams()
					});

					const fromFile = await readSpecMarkdown(vm);
					if (fromFile) return fromFile;
					if (!result.ok) {
						return concatPlanSections(state, state.prompt);
					}
					return concatPlanSections(state, state.prompt);
				}
			});

			await ctx.step('persist', async (step) => {
				const state = step.state;
				if (state.cancelRequested) {
					await mirrorPhase(step, state, 'cancelled', 'Cancelled.');
					await markStatus(step, state, state.priorStatus === 'ready' ? 'ready' : 'draft', {
						roleCount: Object.keys(state.roles).length
					});
					state.finished = true;
					state.cancelRequested = null;
					return;
				}
				const client = siblings(step);
				let markdown =
					(synthesized.ok ? synthesized.value : null) ??
					concatPlanSections(state, state.prompt);

				let artifactUrl: string | null = null;
				const token = blobToken();
				if (token) {
					try {
						const uploaded = await put(
							`plans/${state.userId}/${state.planId}/SPEC.md`,
							markdown,
							{
								access: 'private',
								token,
								allowOverwrite: true,
								contentType: 'text/markdown'
							}
						);
						artifactUrl = uploaded.url;
					} catch {
						// artifact upload is best-effort
					}
				}

				await client.specPlan
					.getOrCreate(actorKeys.specPlan(state.userId, state.planId), {
						params: internalParams()
					})
					.commitDoc({ runId: state.runId, markdown, artifactUrl });

				await markStatus(step, state, 'ready', {
					roleCount: Object.keys(state.roles).length,
					generatedAt: Date.now()
				});
				state.finished = true;
			});
		} catch (err) {
			await ctx.step('fail', async (step) => {
				const state = step.state;
				const message = redactSecrets(
					err instanceof Error ? err.message : 'Generation failed unexpectedly.'
				);
				await mirrorPhase(step, state, 'error', message.slice(0, 300));
				await markStatus(step, state, 'failed', {
					roleCount: Object.keys(state.roles).length
				});
				state.finished = true;
			});
		}
	}),

	actions: {
		reportRole: async (c, input: RoleReport): Promise<{ ok: true }> => {
			assertInternal(c.conn.state);
			if (input.runId !== c.state.runId) return { ok: true };

			const entry = c.state.roles[input.roleId];
			if (input.status === 'running') {
				if (entry) {
					entry.status = 'running';
					if (input.thought) entry.thought = input.thought;
				}
				try {
					await (c.client() as unknown as SiblingClient).specPlan
						.getOrCreate(actorKeys.specPlan(c.state.userId, c.state.planId), {
							params: internalParams()
						})
						.setWorkerStatus({
							roleId: input.roleId,
							status: 'running',
							thought: input.thought
						});
				} catch {
					// best-effort
				}
				return { ok: true };
			}

			if (entry && input.thought) entry.thought = input.thought;
			await c.queue.send('roleEvents', input);
			return { ok: true };
		},

		cancelRun: async (
			c,
			input?: { reason?: string }
		): Promise<{ ok: true }> => {
			assertInternal(c.conn.state);
			c.state.cancelRequested = c.state.runId;
			await c.queue.send('cancel', {
				runId: c.state.runId,
				reason: input?.reason
			});
			return { ok: true };
		},

		getState: (c): RunState => {
			assertInternal(c.conn.state);
			return {
				userId: c.state.userId,
				planId: c.state.planId,
				runId: c.state.runId,
				prompt: c.state.prompt,
				instructions: c.state.instructions,
				repoFullName: c.state.repoFullName,
				defaultBranch: c.state.defaultBranch,
				pending: [...c.state.pending],
				active: [...c.state.active],
				roles: { ...c.state.roles },
				sections: { ...c.state.sections },
				cancelRequested: c.state.cancelRequested,
				finished: c.state.finished,
				priorStatus: c.state.priorStatus
			};
		}
	}
});
