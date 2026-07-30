/**
 * spec-plan-writer wire protocol — the shared contract between the browser,
 * the SvelteKit server, and the Rivet actors.
 *
 * TYPES AND FROZEN CONSTANTS ONLY. No rivetkit import, no zod, no env reads —
 * this module must stay importable from browser bundles, the actor server,
 * and plain node scripts alike.
 */

// ── Identity ────────────────────────────────────────────────────────────────

/** Public GitHub-backed profile the browser is allowed to see. */
export interface PublicProfile {
	userId: string;
	login: string;
	name: string | null;
	avatarUrl: string | null;
	keyStatus: OpenRouterKeyStatus;
	createdAt: number;
}

export type OpenRouterKeyStatus = 'unset' | 'valid' | 'invalid';

/** A GitHub repo row in the picker. */
export interface RepoSummary {
	fullName: string; // "owner/repo"
	description: string | null;
	isPrivate: boolean;
	defaultBranch: string;
	language: string | null;
	updatedAt: string;
}

// ── Plans ───────────────────────────────────────────────────────────────────

export type PlanStatus = 'draft' | 'generating' | 'ready' | 'failed';

export interface PlanSummary {
	planId: string;
	title: string;
	status: PlanStatus;
	roleCount: number;
	repoFullName: string;
	createdAt: number;
	updatedAt: number;
	lastGeneratedAt: number | null;
}

/** Lifecycle of one generation run (mirrored onto specPlan by the run actor). */
export type RunPhase =
	| 'idle'
	| 'provisioning'
	| 'planning'
	| 'writing'
	| 'synthesizing'
	| 'done'
	| 'cancelled'
	| 'error';

export const RUN_PHASES: readonly RunPhase[] = [
	'provisioning',
	'planning',
	'writing',
	'synthesizing',
	'done'
] as const;

// ── Specialist roster ───────────────────────────────────────────────────────

/** Canonical specialist roles the planner picks from (mirrors Layerr's). */
export const SPECIALIST_ROLES = [
	'problem-context',
	'goals-scope',
	'requirements',
	'approach',
	'risks',
	'milestones',
	'acceptance',
	'research'
] as const;

export type SpecialistRole = (typeof SPECIALIST_ROLES)[number];

export type WorkerStatus = 'queued' | 'running' | 'done' | 'error';

/** Live card for one specialist, mirrored to the browser. */
export interface AgentCard {
	roleId: string;
	role: SpecialistRole;
	title: string;
	focus: string;
	sections: string[];
	ordinal: number;
	status: WorkerStatus;
	/** Latest human-readable progress line ("Reading src/auth…"). */
	thought: string;
}

/** One versioned spec document. */
export interface SpecDocVersion {
	version: number;
	runId: string;
	markdown: string;
	createdAt: number;
	/** Vercel Blob URL when artifact upload is configured. */
	artifactUrl: string | null;
}

// ── specPlan actor contract ─────────────────────────────────────────────────

export interface SpecPlanSnapshot {
	title: string;
	prompt: string;
	/** User-editable house rules injected into every agent on every run. */
	instructions: string;
	repoFullName: string;
	defaultBranch: string;
	phase: RunPhase;
	statusLine: string;
	agents: AgentCard[];
	activeRunId: string | null;
	doc: SpecDocVersion | null;
	docHistory: Array<{ version: number; createdAt: number }>;
	/** Last log lines per roleId (capped), for reconnect repaint. */
	logs: Record<string, string[]>;
}

/** `workerLog` broadcast payload. */
export interface WorkerLogEvent {
	roleId: string;
	lines: string[];
}

/** `docUpdated` broadcast payload. */
export interface DocUpdatedEvent {
	doc: SpecDocVersion;
}

export interface CreatePlanInput {
	prompt: string;
	repoFullName: string;
	defaultBranch: string;
	title?: string;
	/** Optional house rules; falls back to DEFAULT_INSTRUCTIONS. */
	instructions?: string;
}

// ── Run/worker internals (actor-to-actor only) ──────────────────────────────

/** Input snapshotted onto a durable per-run actor at startRun. */
export interface RunInput {
	userId: string;
	planId: string;
	runId: string;
	prompt: string;
	instructions: string;
	repoFullName: string;
	defaultBranch: string;
	/** Library status before this run, restored on cancel. */
	priorStatus: PlanStatus;
}

export interface RoleAssignment {
	userId: string;
	planId: string;
	runId: string;
	roleId: string;
	role: SpecialistRole;
	title: string;
	focus: string;
	sections: string[];
	ordinal: number;
	/** The user's original problem prompt. */
	prompt: string;
	/** User-editable house rules for this plan. */
	instructions: string;
	repoFullName: string;
}

export type RoleTerminalStatus = 'complete' | 'failed';

export interface RoleReport {
	runId: string;
	roleId: string;
	/** Interim updates carry thought only; terminal updates carry status. */
	status: 'running' | RoleTerminalStatus;
	thought?: string;
	sectionMd?: string;
}

// ── Actor keys ──────────────────────────────────────────────────────────────

export const actorKeys = {
	user: (userId: string) => ['user', userId] as const,
	specPlan: (userId: string, planId: string) => ['specPlan', userId, planId] as const,
	specPlanRun: (userId: string, planId: string, runId: string) =>
		['specPlanRun', userId, planId, runId] as const,
	specPlanWorker: (userId: string, planId: string, runId: string, roleId: string) =>
		['specPlanWorker', userId, planId, runId, roleId] as const,
	/** Tenant-scoped VM key — never bare planId (design-patterns actor-per-entity). */
	vm: (userId: string, planId: string) => ['vm', userId, planId] as const
};

// ── Shared VM paths (inside every plan's agentOS VM) ────────────────────────

export const VM_WORK_DIR = '/home/agentos/work';
export const VM_REPO_DIR = `${VM_WORK_DIR}/repo`;
export const VM_PLAN_DIR = `${VM_WORK_DIR}/plan`;
export const VM_SECTIONS_DIR = `${VM_PLAN_DIR}/sections`;
export const VM_NOTES_DIR = `${VM_PLAN_DIR}/notes`;
export const VM_SPEC_PATH = `${VM_PLAN_DIR}/SPEC.md`;

// ── Models ──────────────────────────────────────────────────────────────────

/** Model used to verify the user's OpenRouter key at onboarding. */
export const VERIFY_MODEL = 'openai/gpt-oss-120b:nitro';

/** Default model for the roster planner (+ pi sessions, overridable by env). */
export const DEFAULT_PLAN_MODEL = 'openai/gpt-oss-120b:nitro';

// ── Instructions ────────────────────────────────────────────────────────────

/**
 * The starting house rules for a new plan. Users edit these per plan; they are
 * injected into the roster planner, every specialist worker, and the
 * synthesizer, so one edit changes the whole team's behavior.
 */
export const DEFAULT_INSTRUCTIONS = `Write for an engineer who did not attend the meeting.

- Ground every claim in the repository. Cite real files and modules.
- A fact you cannot verify becomes an explicit assumption, never an invented detail.
- Prefer the smallest change that solves the problem.
- Call out migration and rollback when the change touches data or public APIs.
- No marketing language. Plain, present tense, declarative.`;

// ── Limits ──────────────────────────────────────────────────────────────────

export const LIMITS = {
	maxParallelWorkers: 4,
	maxRosterSize: 6,
	/** Hard plan-directory cap per user (storage DoS fence). */
	maxPlansPerUser: 25,
	/** Soft start budget to protect Rivet compute for a free public demo. */
	maxRunsPerDay: 20,
	/** Concurrent generation runs per user across all plans. */
	maxConcurrentRunsPerUser: 2,
	/** Versions of SPEC.md retained per plan. */
	maxDocVersions: 8,
	/** Per-role log lines retained for reconnect repaint. */
	workerLogRetain: 200,
	/** Repo file-tree paths fed to the planner. */
	plannerTreePaths: 400,
	/** README excerpt chars fed to the planner. */
	plannerReadmeChars: 4000,
	/** Ceiling on user-authored house rules. */
	maxInstructionsChars: 4000,
	/** Worker pi session wall-clock budget. */
	workerTimeoutMs: 5 * 60_000,
	/** Straggler reap inside the run drain loop. */
	runDrainTimeoutMs: 7 * 60_000
} as const;
