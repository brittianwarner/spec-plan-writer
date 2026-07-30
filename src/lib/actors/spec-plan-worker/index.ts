import { actor } from 'rivetkit';
import { workflow } from 'rivetkit/workflow';
import type { RoleAssignment, RoleReport } from '../../protocol/index.ts';
import { LIMITS, actorKeys } from '../../protocol/index.ts';
import {
	assertInternal,
	bindInternalOnlyConnect,
	internalParams,
	redactSecrets
} from '../auth.ts';
import { piModel } from '../env.ts';
import { buildWorkerPrompt } from '../spec-plan-run/prompts.ts';
import {
	readSectionMarkdown,
	runPiPrompt,
	writePiConfig,
	type VmHandle
} from '../spec-plan-run/provision.ts';
import { sessionEventLogLine } from '../spec-plan-run/session-log.ts';

interface WorkerState extends RoleAssignment {
	status: '' | 'running' | 'done' | 'error';
	sectionMd: string;
}

interface RunReporter {
	reportRole(input: RoleReport): Promise<unknown>;
}

interface SpecPlanLogs {
	appendWorkerLog(input: { roleId: string; lines: string[] }): Promise<unknown>;
	setWorkerStatus(input: {
		roleId: string;
		status: 'queued' | 'running' | 'done' | 'error';
		thought?: string;
	}): Promise<unknown>;
}

interface UserSecrets {
	getSecrets(): Promise<{ githubToken: string; openrouterKey: string | null }>;
}

interface SiblingClient {
	specPlanRun: {
		getOrCreate(key: readonly string[], opts?: { params?: unknown }): RunReporter;
	};
	specPlan: {
		getOrCreate(key: readonly string[], opts?: { params?: unknown }): SpecPlanLogs;
	};
	user: {
		getOrCreate(key: readonly string[], opts?: { params?: unknown }): UserSecrets;
	};
	vm: {
		getOrCreate(key: readonly string[], opts?: { params?: unknown }): VmHandle;
	};
}

const SECTION_STEP_TIMEOUT_MS = LIMITS.workerTimeoutMs + 30_000;

function siblings(step: { client: () => unknown }): SiblingClient {
	return step.client() as unknown as SiblingClient;
}

async function report(
	step: { client: () => unknown },
	a: RoleAssignment,
	ev: Omit<RoleReport, 'runId' | 'roleId'>
): Promise<void> {
	try {
		await siblings(step)
			.specPlanRun.getOrCreate(
				actorKeys.specPlanRun(a.userId, a.planId, a.runId),
				{ params: internalParams() }
			)
			.reportRole({
				runId: a.runId,
				roleId: a.roleId,
				...ev
			});
	} catch {
		// no-throw contract
	}
}

async function appendLogs(
	step: { client: () => unknown },
	a: RoleAssignment,
	lines: string[]
): Promise<void> {
	if (lines.length === 0) return;
	try {
		await siblings(step)
			.specPlan.getOrCreate(actorKeys.specPlan(a.userId, a.planId), {
				params: internalParams()
			})
			.appendWorkerLog({ roleId: a.roleId, lines });
	} catch {
		// best-effort
	}
}

export const specPlanWorker = actor({
	options: {
		name: 'Spec Plan Worker',
		icon: 'user-pen',
		sleepTimeout: 120_000,
		actionTimeout: LIMITS.workerTimeoutMs + 60_000
	},

	createState: (_c, input?: Partial<RoleAssignment>): WorkerState => ({
		userId: input?.userId ?? '',
		planId: input?.planId ?? '',
		runId: input?.runId ?? '',
		roleId: input?.roleId ?? '',
		role: input?.role ?? 'approach',
		title: input?.title ?? '',
		focus: input?.focus ?? '',
		sections: input?.sections ?? [],
		ordinal: input?.ordinal ?? 0,
		prompt: input?.prompt ?? '',
		instructions: input?.instructions ?? '',
		repoFullName: input?.repoFullName ?? '',
		status: '',
		sectionMd: ''
	}),

	...bindInternalOnlyConnect(),

	run: workflow(async (ctx) => {
		// Idempotent under getOrCreate redelivery: a finished worker must not
		// re-burn OpenRouter on wake.
		const already = await ctx.step('check-done', async (step) => {
			return step.state.status === 'done' || step.state.status === 'error';
		});
		if (already) return;

		const assignment = await ctx.step('load-assignment', async (step) => {
			step.state.status = 'running';
			return {
				userId: step.state.userId,
				planId: step.state.planId,
				runId: step.state.runId,
				roleId: step.state.roleId,
				role: step.state.role,
				title: step.state.title,
				focus: step.state.focus,
				sections: step.state.sections,
				ordinal: step.state.ordinal,
				prompt: step.state.prompt,
				instructions: step.state.instructions,
				repoFullName: step.state.repoFullName
			} satisfies RoleAssignment;
		});

		const written = await ctx.tryStep({
			name: 'write-section',
			timeout: SECTION_STEP_TIMEOUT_MS,
			maxRetries: 0,
			run: async (step) => {
				const a = assignment;
				try {
					await report(step, a, {
						status: 'running',
						thought: 'Reviewing the repository…'
					});

					const secrets = await siblings(step)
						.user.getOrCreate(actorKeys.user(a.userId), {
							params: internalParams()
						})
						.getSecrets();

					if (!secrets.openrouterKey) {
						return {
							ok: false as const,
							sectionMd: '',
							thought: 'OpenRouter key missing.'
						};
					}

					const vm = siblings(step).vm.getOrCreate(actorKeys.vm(a.userId, a.planId), {
						params: internalParams()
					});
					await writePiConfig(vm, piModel());

					const pending: string[] = [];
					const flush = async (force = false) => {
						if (!force && pending.length < 10) return;
						if (pending.length === 0) return;
						const batch = pending.splice(0, pending.length);
						await appendLogs(step, a, batch);
					};

					let lastThoughtAt = 0;
					const onEvent = (event: unknown) => {
						const line = sessionEventLogLine(event);
						if (!line) return;
						pending.push(line);
						const now = Date.now();
						if (now - lastThoughtAt > 4_000) {
							lastThoughtAt = now;
							void report(step, a, {
								status: 'running',
								thought: line.slice(0, 160)
							});
						}
						void flush(false);
					};

					await report(step, a, {
						status: 'running',
						thought: `Drafting ${a.sections.join(', ') || a.title}…`
					});

					const result = await runPiPrompt(vm, {
						openrouterKey: secrets.openrouterKey,
						prompt: buildWorkerPrompt(a),
						onEvent,
						connectParams: internalParams()
					});
					await flush(true);

					const sectionMd = (await readSectionMarkdown(vm, a.roleId)).trim();
					if (sectionMd) {
						return { ok: true as const, sectionMd, thought: 'Done.' };
					}
					return {
						ok: false as const,
						sectionMd: '',
						thought:
							result.error?.slice(0, 160) ?? "Couldn't complete this section."
					};
				} catch (err) {
					const message =
						redactSecrets(err instanceof Error ? err.message : 'Worker failed unexpectedly.');
					return {
						ok: false as const,
						sectionMd: '',
						thought: message.slice(0, 160)
					};
				}
			}
		});

		await ctx.step('report-complete', async (step) => {
			const a = assignment;
			if (!written.ok) {
				step.state.status = 'error';
				step.state.sectionMd = '';
				await report(step, a, {
					status: 'failed',
					thought: `Worker failed (${written.failure.kind}).`,
					sectionMd: ''
				});
				return;
			}
			const { sectionMd, thought, ok } = written.value;
			step.state.sectionMd = sectionMd;
			step.state.status = ok ? 'done' : 'error';
			await report(step, a, {
				status: ok ? 'complete' : 'failed',
				thought,
				sectionMd
			});
		});
	}),

	actions: {
		getState: (c): WorkerState => {
			assertInternal(c.conn.state);
			return { ...c.state };
		},

		/** Internal probe — unused by coordinator but useful for debug. */
		ping: (c): { ok: true; roleId: string } => {
			assertInternal(c.conn.state);
			return { ok: true, roleId: c.state.roleId };
		}
	}
});
