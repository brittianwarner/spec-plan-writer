/**
 * `specPlan` — key ["specPlan", userId, planId]. Browser fan-in brain.
 */

import { actor, UserError } from 'rivetkit';
import { db, type RawAccess } from 'rivetkit/db';
import type {
	AgentCard,
	DocUpdatedEvent,
	PlanStatus,
	RunInput,
	RunPhase,
	SpecDocVersion,
	SpecPlanSnapshot,
	WorkerLogEvent
} from '../../protocol/index.ts';
import { DEFAULT_INSTRUCTIONS, LIMITS, actorKeys } from '../../protocol/index.ts';
import { createSpecPr } from '../../github/client.ts';
import { buildSpecPrPaths } from '../../run/plan-paths.ts';
import {
	assertInternal,
	assertOwnsKey,
	connStateFromParams,
	guardOrigin,
	internalParams,
	redactSecrets
} from '../auth.ts';

async function migrate(database: RawAccess): Promise<void> {
	await database.execute(`CREATE TABLE IF NOT EXISTS plan_versions (
		version INTEGER PRIMARY KEY,
		run_id TEXT NOT NULL UNIQUE,
		markdown TEXT NOT NULL,
		roster_json TEXT NOT NULL,
		artifact_url TEXT,
		created_at INTEGER NOT NULL
	)`);
	await database.execute(`CREATE TABLE IF NOT EXISTS worker_logs (
		role_id TEXT NOT NULL,
		ts INTEGER NOT NULL,
		line TEXT NOT NULL
	)`);
	await database.execute(
		'CREATE INDEX IF NOT EXISTS idx_worker_logs_role ON worker_logs (role_id, rowid)'
	);
}

type VersionRow = {
	version: number;
	run_id: string;
	markdown: string;
	roster_json: string;
	artifact_url: string | null;
	created_at: number;
} & Record<string, unknown>;

interface SpecPlanState {
	userId: string;
	planId: string;
	title: string;
	prompt: string;
	instructions: string;
	repoFullName: string;
	defaultBranch: string;
	phase: RunPhase;
	statusLine: string;
	agents: AgentCard[];
	activeRunId: string | null;
	cancelRequested: boolean;
	currentVersion: number;
	createdAt: number;
}

interface RunHandle {
	cancelRun(input: { reason?: string }): Promise<unknown>;
}
interface UserHandle {
	getSecrets(): Promise<{ githubToken: string; openrouterKey: string | null }>;
}
interface SiblingClient {
	specPlanRun: {
		create(key: readonly string[], opts: { input: RunInput; params?: unknown }): Promise<unknown>;
		getOrCreate(key: readonly string[], opts?: { params?: unknown }): RunHandle;
	};
	user: {
		getOrCreate(key: readonly string[], opts?: { params?: unknown }): UserHandle;
	};
}

const RESTING: ReadonlySet<RunPhase> = new Set(['idle', 'done', 'cancelled', 'error']);

export const specPlan = actor({
	options: { name: 'Spec Plan', icon: 'file-lines' },
	db: db({ onMigrate: migrate }),

	createState: (
		_c,
		input?: Partial<{
			userId: string;
			planId: string;
			title: string;
			prompt: string;
			instructions: string;
			repoFullName: string;
			defaultBranch: string;
		}>
	): SpecPlanState => ({
		userId: input?.userId ?? '',
		planId: input?.planId ?? '',
		title: input?.title ?? 'Untitled plan',
		prompt: input?.prompt ?? '',
		instructions: input?.instructions ?? DEFAULT_INSTRUCTIONS,
		repoFullName: input?.repoFullName ?? '',
		defaultBranch: (input?.defaultBranch ?? '').trim(),
		phase: 'idle',
		statusLine: '',
		agents: [],
		activeRunId: null,
		cancelRequested: false,
		currentVersion: 0,
		createdAt: Date.now()
	}),

	onBeforeConnect: (c) => guardOrigin(c.request),

	createConnState: async (c, params) => {
		const conn = await connStateFromParams(params);
		assertOwnsKey(conn, c.key[1] as string);
		return conn;
	},

	actions: {
		initialize: async (
			c,
			input: {
				userId: string;
				planId: string;
				title: string;
				prompt: string;
				instructions?: string;
				repoFullName: string;
				defaultBranch: string;
			}
		): Promise<{ ok: true }> => {
			assertInternal(c.conn.state);
			c.state.userId = input.userId;
			c.state.planId = input.planId;
			c.state.title = input.title;
			c.state.prompt = input.prompt;
			c.state.instructions = (input.instructions ?? DEFAULT_INSTRUCTIONS)
				.trim()
				.slice(0, LIMITS.maxInstructionsChars);
			c.state.repoFullName = input.repoFullName;
			c.state.defaultBranch = (input.defaultBranch ?? '').trim();
			return { ok: true };
		},

		setInstructions: (c, input: { instructions: string }): { instructions: string } => {
			const next = input.instructions.trim().slice(0, LIMITS.maxInstructionsChars);
			c.state.instructions = next;
			c.broadcast('instructionsChanged', { instructions: next });
			return { instructions: next };
		},

		getSnapshot: async (c): Promise<SpecPlanSnapshot> => {
			const versionRows = await c.db.execute<VersionRow>(
				'SELECT * FROM plan_versions ORDER BY version DESC LIMIT 50'
			);
			const latest = versionRows[0];
			const logs: Record<string, string[]> = {};
			for (const agent of c.state.agents) {
				logs[agent.roleId] = await recentLogs(c.db, agent.roleId);
			}
			return {
				title: c.state.title,
				prompt: c.state.prompt,
				instructions: c.state.instructions,
				repoFullName: c.state.repoFullName,
				defaultBranch: c.state.defaultBranch,
				phase: c.state.phase,
				statusLine: c.state.statusLine,
				agents: c.state.agents,
				activeRunId: c.state.activeRunId,
				doc: latest ? rowToDoc(latest) : null,
				docHistory: versionRows.map((r) => ({ version: Number(r.version), createdAt: Number(r.created_at) })),
				logs
			};
		},

		startRun: async (c): Promise<{ runId: string }> => {
			if (!RESTING.has(c.state.phase)) {
				throw new UserError('A run is already in progress', { code: 'run_active' });
			}
			const runId = crypto.randomUUID();
			const priorStatus: PlanStatus =
				c.state.currentVersion > 0 || c.state.phase === 'done' ? 'ready' : 'draft';
			c.state.activeRunId = runId;
			c.state.cancelRequested = false;
			c.state.agents = [];
			setPhase(c, 'provisioning', 'Waking the shared workspace…');
			try {
				await c.db.execute('DELETE FROM worker_logs');
				const input: RunInput = {
					userId: c.state.userId,
					planId: c.state.planId,
					runId,
					prompt: c.state.prompt,
					instructions: c.state.instructions,
					repoFullName: c.state.repoFullName,
					defaultBranch: c.state.defaultBranch,
					priorStatus
				};
				await (c.client() as unknown as SiblingClient).specPlanRun.create(
					actorKeys.specPlanRun(c.state.userId, c.state.planId, runId),
					{ input, params: internalParams() }
				);
			} catch (err) {
				c.state.activeRunId = null;
				c.state.cancelRequested = false;
				setPhase(c, 'error', 'Could not start the run.');
				throw err;
			}
			return { runId };
		},

		cancelRun: async (c): Promise<{ ok: true }> => {
			const runId = c.state.activeRunId;
			if (!runId) return { ok: true };
			c.state.cancelRequested = true;
			if (c.state.phase !== 'cancelled' && c.state.phase !== 'done') {
				setPhase(c, c.state.phase, 'Cancelling…');
			}
			try {
				await (c.client() as unknown as SiblingClient).specPlanRun
					.getOrCreate(actorKeys.specPlanRun(c.state.userId, c.state.planId, runId), {
						params: internalParams()
					})
					.cancelRun({ reason: 'user' });
			} catch {
				setPhase(c, 'cancelled', 'Cancelled.');
				c.state.activeRunId = null;
				c.state.cancelRequested = false;
			}
			return { ok: true };
		},

		mirrorPhase: (c, input: { phase: RunPhase; statusLine?: string }): { ok: true } => {
			assertInternal(c.conn.state);
			setPhase(c, input.phase, input.statusLine);
			return { ok: true };
		},

		mirrorRoster: (c, input: { agents: AgentCard[] }): { ok: true } => {
			assertInternal(c.conn.state);
			c.state.agents = input.agents;
			c.broadcast('rosterChanged', { agents: c.state.agents });
			return { ok: true };
		},

		setWorkerStatus: (
			c,
			input: { roleId: string; status: AgentCard['status']; thought?: string }
		): { ok: true } => {
			assertInternal(c.conn.state);
			const agent = c.state.agents.find((a) => a.roleId === input.roleId);
			if (agent) {
				agent.status = input.status;
				if (input.thought !== undefined) agent.thought = input.thought;
				c.broadcast('rosterChanged', { agents: c.state.agents });
			}
			return { ok: true };
		},

		appendWorkerLog: async (c, input: { roleId: string; lines: string[] }): Promise<{ ok: true }> => {
			assertInternal(c.conn.state);
			if (input.lines.length === 0) return { ok: true };
			const now = Date.now();
			const redacted = input.lines.map((l) => redactSecrets(l).slice(0, 500));
			for (const line of redacted) {
				await c.db.execute(
					'INSERT INTO worker_logs (role_id, ts, line) VALUES (?, ?, ?)',
					input.roleId,
					now,
					line
				);
			}
			await c.db.execute(
				`DELETE FROM worker_logs WHERE role_id = ? AND rowid NOT IN (
					SELECT rowid FROM worker_logs WHERE role_id = ? ORDER BY rowid DESC LIMIT ?
				)`,
				input.roleId,
				input.roleId,
				LIMITS.workerLogRetain
			);
			c.broadcast('workerLog', { roleId: input.roleId, lines: redacted } satisfies WorkerLogEvent);
			return { ok: true };
		},

		commitDoc: async (
			c,
			input: { runId: string; markdown: string; artifactUrl?: string | null }
		): Promise<{ version: number }> => {
			assertInternal(c.conn.state);
			if (c.state.cancelRequested || c.state.phase === 'cancelled') {
				throw new UserError('Run was cancelled', { code: 'run_cancelled' });
			}
			if (c.state.activeRunId && c.state.activeRunId !== input.runId) {
				throw new UserError('Stale run', { code: 'run_stale' });
			}
			const markdown = redactSecrets(input.markdown);
			const existing = await c.db.execute<VersionRow>(
				'SELECT * FROM plan_versions WHERE run_id = ?',
				input.runId
			);
			if (existing.length > 0) return { version: Number(existing[0].version) };

			const version = c.state.currentVersion + 1;
			await c.db.execute(
				`INSERT INTO plan_versions (version, run_id, markdown, roster_json, artifact_url, created_at)
				 VALUES (?, ?, ?, ?, ?, ?)`,
				version,
				input.runId,
				markdown,
				JSON.stringify(c.state.agents),
				input.artifactUrl ?? null,
				Date.now()
			);
			c.state.currentVersion = version;
			const pruneBelow = version - LIMITS.maxDocVersions;
			if (pruneBelow > 0) {
				await c.db.execute('DELETE FROM plan_versions WHERE version <= ?', pruneBelow);
			}
			const doc: SpecDocVersion = {
				version,
				runId: input.runId,
				markdown,
				createdAt: Date.now(),
				artifactUrl: input.artifactUrl ?? null
			};
			c.broadcast('docUpdated', { doc } satisfies DocUpdatedEvent);
			setPhase(c, 'done', 'Spec plan ready.');
			return { version };
		},

		createPr: async (c): Promise<{ prUrl: string }> => {
			const rows = await c.db.execute<VersionRow>(
				'SELECT * FROM plan_versions ORDER BY version DESC LIMIT 1'
			);
			const latest = rows[0];
			if (!latest) throw new UserError('No spec to publish yet', { code: 'doc_missing' });

			const secrets = await (c.client() as unknown as SiblingClient).user
				.getOrCreate(actorKeys.user(c.state.userId), { params: internalParams() })
				.getSecrets();
			if (!secrets.githubToken) {
				throw new UserError('GitHub is not connected', { code: 'github_missing' });
			}

			const date = new Date().toISOString().slice(0, 10);
			const paths = buildSpecPrPaths({
				title: c.state.title,
				version: Number(latest.version),
				date
			});
			const result = await createSpecPr(secrets.githubToken, c.state.repoFullName, {
				branch: paths.branch,
				path: paths.path,
				content: redactSecrets(String(latest.markdown)),
				title: `Spec plan: ${c.state.title}`,
				body: `Written by a team of specialists via spec-plan-writer.\n\nRepository: ${c.state.repoFullName}`
			});
			return { prUrl: result.prUrl };
		},

		purge: async (c): Promise<{ ok: true }> => {
			assertInternal(c.conn.state);
			await c.db.execute('DELETE FROM plan_versions');
			await c.db.execute('DELETE FROM worker_logs');
			c.state.agents = [];
			c.state.phase = 'idle';
			c.state.statusLine = '';
			c.state.activeRunId = null;
			c.state.cancelRequested = false;
			c.state.currentVersion = 0;
			return { ok: true };
		}
	}
});

type MirrorCtx = { state: SpecPlanState; broadcast: (event: string, data: unknown) => void };

function setPhase(c: MirrorCtx, phase: RunPhase, statusLine?: string): void {
	c.state.phase = phase;
	if (statusLine !== undefined) c.state.statusLine = statusLine;
	if (phase === 'cancelled' || phase === 'done' || phase === 'error') {
		c.state.activeRunId = null;
		if (phase === 'cancelled' || phase === 'done') c.state.cancelRequested = false;
	}
	c.broadcast('phaseChanged', { phase, statusLine: c.state.statusLine });
}

function rowToDoc(row: VersionRow): SpecDocVersion {
	return {
		version: Number(row.version),
		runId: String(row.run_id),
		markdown: String(row.markdown),
		createdAt: Number(row.created_at),
		artifactUrl: row.artifact_url == null ? null : String(row.artifact_url)
	};
}

async function recentLogs(database: RawAccess, roleId: string): Promise<string[]> {
	const rows = await database.execute<{ line: string }>(
		`SELECT line FROM (
			SELECT line, rowid AS rid FROM worker_logs WHERE role_id = ? ORDER BY rid DESC LIMIT ?
		) ORDER BY rid`,
		roleId,
		LIMITS.workerLogRetain
	);
	return rows.map((r) => r.line);
}
