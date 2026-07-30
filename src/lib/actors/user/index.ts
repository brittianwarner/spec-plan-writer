/**
 * `user` — key `["user", userId]`. One actor per human.
 *
 * The durable home for everything about a user that outlives a page load:
 * their GitHub profile + access token (from OAuth), their OpenRouter key
 * (from onboarding), and their plan directory.
 *
 * Partitioning: the key IS the ACL — a browser connection's token `sub` must
 * equal `key[1]` in `createConnState`, so no action can be reached on someone
 * else's actor. Secrets live in `c.state` (bounded, hot) and NEVER leave
 * through a browser-facing action: `getProfile`/`listPlans` build DTOs with
 * no secret fields, and `getSecrets` is internal-only (run/worker actors call
 * it server-side to inject credentials into VM sessions).
 *
 * The plan directory lives in `c.db` (SQLite), not state: the list is
 * unbounded and read as a sorted range scan, which is what SQLite is for.
 */

import { actor, UserError } from 'rivetkit';
import { db, type RawAccess } from 'rivetkit/db';
import type {
	CreatePlanInput,
	OpenRouterKeyStatus,
	PlanStatus,
	PlanSummary,
	PublicProfile,
	RepoSummary
} from '../../protocol/index.ts';
import { actorKeys, DEFAULT_INSTRUCTIONS, LIMITS } from '../../protocol/index.ts';
import { verifyOpenRouterKey } from '../../ai/openrouter.ts';
import { listRepos as ghListRepos } from '../../github/client.ts';
import {
	assertInternal,
	assertOwnsKey,
	connStateFromParams,
	guardOrigin,
	internalParams
} from '../auth.ts';

// ── SQLite ──────────────────────────────────────────────────────────────────

async function migrate(database: RawAccess): Promise<void> {
	await database.execute(`CREATE TABLE IF NOT EXISTS plans (
		plan_id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'draft',
		role_count INTEGER NOT NULL DEFAULT 0,
		repo_full_name TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		last_generated_at INTEGER
	)`);
}

type PlanRow = {
	plan_id: string;
	title: string;
	status: string;
	role_count: number;
	repo_full_name: string;
	created_at: number;
	updated_at: number;
	last_generated_at: number | null;
} & Record<string, unknown>;

function rowToSummary(row: PlanRow): PlanSummary {
	return {
		planId: String(row.plan_id),
		title: String(row.title),
		status: row.status as PlanStatus,
		roleCount: Number(row.role_count) || 0,
		repoFullName: String(row.repo_full_name),
		createdAt: Number(row.created_at) || 0,
		updatedAt: Number(row.updated_at) || 0,
		lastGeneratedAt: row.last_generated_at == null ? null : Number(row.last_generated_at)
	};
}

// ── State ───────────────────────────────────────────────────────────────────

interface UserState {
	userId: string;
	login: string;
	name: string | null;
	avatarUrl: string | null;
	/** GitHub OAuth access token — server-side only, never broadcast. */
	githubToken: string;
	/** OpenRouter key from onboarding — server-side only, never broadcast. */
	openrouterKey: string | null;
	keyStatus: OpenRouterKeyStatus;
	createdAt: number;
	lastSeenAt: number;
}

interface UserVars {
	reposCache: { at: number; repos: RepoSummary[] } | null;
}

// ── Cross-actor handles (structural — avoids the registry inference cycle) ──

interface SpecPlanInitHandle {
	initialize(input: {
		userId: string;
		planId: string;
		title: string;
		prompt: string;
		instructions: string;
		repoFullName: string;
		defaultBranch: string;
	}): Promise<unknown>;
	purge(): Promise<unknown>;
}

interface SiblingClient {
	specPlan: {
		getOrCreate(key: readonly string[], opts?: { params?: unknown }): SpecPlanInitHandle;
	};
}

// ── Actor ───────────────────────────────────────────────────────────────────

export const user = actor({
	options: { name: 'User', icon: 'user' },

	db: db({ onMigrate: migrate }),

	createState: (_c, input?: { userId?: string }): UserState => ({
		userId: input?.userId ?? '',
		login: '',
		name: null,
		avatarUrl: null,
		githubToken: '',
		openrouterKey: null,
		keyStatus: 'unset',
		createdAt: Date.now(),
		lastSeenAt: Date.now()
	}),

	createVars: (): UserVars => ({ reposCache: null }),

	onBeforeConnect: (c) => guardOrigin(c.request),

	createConnState: async (c, params) => {
		const conn = await connStateFromParams(params);
		assertOwnsKey(conn, c.key[1] as string);
		return conn;
	},

	actions: {
		/** OAuth callback upsert — internal (SvelteKit server) only. */
		upsertProfile: async (
			c,
			input: { userId: string; login: string; name: string | null; avatarUrl: string | null; githubToken: string }
		): Promise<{ ok: true }> => {
			assertInternal(c.conn.state);
			c.state.userId = input.userId;
			c.state.login = input.login;
			c.state.name = input.name;
			c.state.avatarUrl = input.avatarUrl;
			c.state.githubToken = input.githubToken;
			c.state.lastSeenAt = Date.now();
			c.broadcast('profileChanged', publicProfile(c.state));
			return { ok: true };
		},

		getProfile: (c): PublicProfile => {
			return publicProfile(c.state);
		},

		/**
		 * Store the user's OpenRouter key after a live verification ping
		 * against the verify model. The key is never returned by any action.
		 */
		setOpenRouterKey: async (c, input: { key: string }): Promise<{ ok: boolean; error?: string }> => {
			const key = input.key.trim();
			if (!key) throw new UserError('API key is required', { code: 'key_required' });
			const result = await verifyOpenRouterKey(key);
			c.state.keyStatus = result.ok ? 'valid' : 'invalid';
			if (result.ok) c.state.openrouterKey = key;
			c.broadcast('keyStatusChanged', { keyStatus: c.state.keyStatus });
			return result.ok ? { ok: true } : { ok: false, error: result.error };
		},

		clearOpenRouterKey: (c): { ok: true } => {
			c.state.openrouterKey = null;
			c.state.keyStatus = 'unset';
			c.broadcast('keyStatusChanged', { keyStatus: c.state.keyStatus });
			return { ok: true };
		},

		/** Repos the user can pick from. GitHub API via the stored token, 60s cache. */
		listRepos: async (c): Promise<{ repos: RepoSummary[] }> => {
			const cached = c.vars.reposCache;
			if (cached && Date.now() - cached.at < 60_000) return { repos: cached.repos };
			if (!c.state.githubToken) throw new UserError('GitHub is not connected', { code: 'github_missing' });
			const rows = await ghListRepos(c.state.githubToken);
			const repos: RepoSummary[] = rows.map((r) => ({
				fullName: r.full_name,
				description: r.description,
				isPrivate: r.private,
				defaultBranch: r.default_branch,
				language: r.language,
				updatedAt: r.updated_at
			}));
			c.vars.reposCache = { at: Date.now(), repos };
			return { repos };
		},

		listPlans: async (c): Promise<{ plans: PlanSummary[] }> => {
			const rows = await c.db.execute<PlanRow>(
				'SELECT * FROM plans ORDER BY updated_at DESC LIMIT 100'
			);
			return { plans: rows.map(rowToSummary) };
		},

		createPlan: async (c, input: CreatePlanInput): Promise<{ planId: string }> => {
			const prompt = input.prompt.trim();
			if (!prompt) throw new UserError('Describe the problem first', { code: 'prompt_required' });
			if (prompt.length > 10_000) throw new UserError('Prompt is too long (10k chars)', { code: 'prompt_too_long' });
			if (!/^[\w.-]+\/[\w.-]+$/.test(input.repoFullName)) {
				throw new UserError('Pick a repository', { code: 'repo_required' });
			}
			if (c.state.keyStatus !== 'valid' || !c.state.openrouterKey) {
				throw new UserError('Add your OpenRouter key first', { code: 'key_required' });
			}

			const countRows = await c.db.execute<{ n: number } & Record<string, unknown>>(
				'SELECT COUNT(*) AS n FROM plans'
			);
			const planCount = Number(countRows[0]?.n ?? 0);
			if (planCount >= LIMITS.maxPlansPerUser) {
				throw new UserError(
					`Plan limit reached (${LIMITS.maxPlansPerUser}). Delete an old plan first.`,
					{ code: 'plan_quota' }
				);
			}

			const planId = crypto.randomUUID();
			const title = (input.title?.trim() || deriveTitle(prompt)).slice(0, 120);
			const now = Date.now();
			await c.db.execute(
				`INSERT INTO plans (plan_id, title, status, role_count, repo_full_name, created_at, updated_at)
				 VALUES (?, ?, 'draft', 0, ?, ?, ?)`,
				planId,
				title,
				input.repoFullName,
				now,
				now
			);

			await (c.client() as unknown as SiblingClient).specPlan
				.getOrCreate(actorKeys.specPlan(c.state.userId, planId), { params: internalParams() })
				.initialize({
					userId: c.state.userId,
					planId,
					title,
					prompt,
					instructions: (input.instructions ?? DEFAULT_INSTRUCTIONS)
						.trim()
						.slice(0, LIMITS.maxInstructionsChars),
					repoFullName: input.repoFullName,
					defaultBranch: (input.defaultBranch ?? '').trim()
				});

			await broadcastPlans(c);
			return { planId };
		},

		renamePlan: async (c, input: { planId: string; title: string }): Promise<{ ok: true }> => {
			const title = input.title.trim().slice(0, 120);
			if (!title) throw new UserError('Title is required', { code: 'title_required' });
			await c.db.execute(
				'UPDATE plans SET title = ?, updated_at = ? WHERE plan_id = ?',
				title,
				Date.now(),
				input.planId
			);
			await broadcastPlans(c);
			return { ok: true };
		},

		deletePlan: async (c, input: { planId: string }): Promise<{ ok: true }> => {
			await c.db.execute('DELETE FROM plans WHERE plan_id = ?', input.planId);
			// Best-effort purge of the plan brain; failure leaves an orphan actor,
			// not an inconsistent directory.
			try {
				await (c.client() as unknown as SiblingClient).specPlan
					.getOrCreate(actorKeys.specPlan(c.state.userId, input.planId), { params: internalParams() })
					.purge();
			} catch {
				// deliberately best-effort
			}
			await broadcastPlans(c);
			return { ok: true };
		},

		/** Run lifecycle mirror from the run actor — internal only. */
		markPlanStatus: async (
			c,
			input: { planId: string; status: PlanStatus; roleCount?: number; generatedAt?: number }
		): Promise<{ ok: true }> => {
			assertInternal(c.conn.state);
			await c.db.execute(
				`UPDATE plans SET status = ?, role_count = COALESCE(?, role_count),
				 last_generated_at = COALESCE(?, last_generated_at), updated_at = ?
				 WHERE plan_id = ?`,
				input.status,
				input.roleCount ?? null,
				input.generatedAt ?? null,
				Date.now(),
				input.planId
			);
			await broadcastPlans(c);
			return { ok: true };
		},

		/** Credentials for run/worker actors to inject into VM sessions. Internal only. */
		getSecrets: (c): { githubToken: string; openrouterKey: string | null } => {
			assertInternal(c.conn.state);
			return { githubToken: c.state.githubToken, openrouterKey: c.state.openrouterKey };
		},

		/** Wipe durable secrets (logout path). Internal only. */
		clearSecrets: (c): { ok: true } => {
			assertInternal(c.conn.state);
			c.state.githubToken = '';
			c.state.openrouterKey = null;
			c.state.keyStatus = 'unset';
			c.broadcast('keyStatusChanged', { keyStatus: 'unset' as const });
			return { ok: true };
		}
	}
});

// ── Helpers ─────────────────────────────────────────────────────────────────

type UserCtx = { state: UserState; db: RawAccess; broadcast: (event: string, data: unknown) => void };

function publicProfile(state: UserState): PublicProfile {
	return {
		userId: state.userId,
		login: state.login,
		name: state.name,
		avatarUrl: state.avatarUrl,
		keyStatus: state.keyStatus,
		createdAt: state.createdAt
	};
}

async function broadcastPlans(c: UserCtx): Promise<void> {
	const rows = await c.db.execute<PlanRow>('SELECT * FROM plans ORDER BY updated_at DESC LIMIT 100');
	c.broadcast('plansChanged', { plans: rows.map(rowToSummary) });
}

/** First sentence-ish fragment of the prompt as the default plan title. */
function deriveTitle(prompt: string): string {
	const firstLine = prompt.split('\n')[0].trim();
	const sentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine;
	return sentence.length > 80 ? `${sentence.slice(0, 77)}…` : sentence;
}
