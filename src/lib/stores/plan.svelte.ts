import type {
	AgentCard,
	RunPhase,
	SpecDocVersion,
	SpecPlanSnapshot
} from '$lib/protocol';

export interface PlanActorHandle {
	isConnected: boolean;
	getSnapshot(): Promise<SpecPlanSnapshot | undefined>;
	startRun(): Promise<{ runId: string } | undefined>;
	cancelRun(): Promise<unknown>;
	createPr(): Promise<{ prUrl: string } | undefined>;
	setInstructions(input: { instructions: string }): Promise<{ instructions: string } | undefined>;
}

export class PlanStore {
	title = $state('');
	prompt = $state('');
	/** Saved server value. */
	instructions = $state('');
	/** Editor buffer — diverges from `instructions` until saved. */
	instructionsDraft = $state('');
	instructionsBusy = $state(false);
	instructionsSaved = $state(false);
	repoFullName = $state('');
	defaultBranch = $state('main');
	phase = $state<RunPhase>('idle');
	statusLine = $state('');
	agents = $state.raw<AgentCard[]>([]);
	logs = $state.raw<Record<string, string[]>>({});
	doc = $state.raw<SpecDocVersion | null>(null);
	docHistory = $state.raw<Array<{ version: number; createdAt: number }>>([]);
	activeRunId = $state<string | null>(null);
	loading = $state(true);
	runBusy = $state(false);
	prBusy = $state(false);
	prUrl = $state<string | null>(null);
	prError = $state<string | null>(null);
	#error = $state<string | null>(null);
	#actor: PlanActorHandle | null = null;

	get connected(): boolean {
		return this.#actor?.isConnected ?? false;
	}

	get error(): string | null {
		return this.#error;
	}

	get instructionsDirty(): boolean {
		return this.instructionsDraft.trim() !== this.instructions.trim();
	}

	get isRunning(): boolean {
		return (
			this.phase === 'provisioning' ||
			this.phase === 'planning' ||
			this.phase === 'writing' ||
			this.phase === 'synthesizing'
		);
	}

	bind(actor: PlanActorHandle) {
		this.#actor = actor;
	}

	reset() {
		this.title = '';
		this.prompt = '';
		this.instructions = '';
		this.instructionsDraft = '';
		this.instructionsBusy = false;
		this.instructionsSaved = false;
		this.repoFullName = '';
		this.defaultBranch = 'main';
		this.phase = 'idle';
		this.statusLine = '';
		this.agents = [];
		this.logs = {};
		this.doc = null;
		this.docHistory = [];
		this.activeRunId = null;
		this.loading = true;
		this.runBusy = false;
		this.prBusy = false;
		this.prUrl = null;
		this.prError = null;
		this.#error = null;
	}

	async sync() {
		if (!this.#actor) return;
		this.loading = true;
		try {
			const snap = await this.#actor.getSnapshot();
			if (snap) this.applySnapshot(snap);
		} finally {
			this.loading = false;
		}
	}

	applySnapshot(s: SpecPlanSnapshot) {
		this.title = s.title;
		this.prompt = s.prompt;
		this.instructions = s.instructions;
		if (!this.instructionsDirty || this.instructionsDraft === '') {
			this.instructionsDraft = s.instructions;
		}
		this.repoFullName = s.repoFullName;
		this.defaultBranch = s.defaultBranch;
		this.phase = s.phase;
		this.statusLine = s.statusLine;
		this.agents = s.agents;
		this.activeRunId = s.activeRunId;
		this.doc = s.doc;
		this.docHistory = s.docHistory;
		this.logs = s.logs ?? {};
	}

	applyPhase(phase: RunPhase, statusLine?: string) {
		this.phase = phase;
		if (statusLine !== undefined) this.statusLine = statusLine;
	}

	applyRoster(agents: AgentCard[]) {
		this.agents = agents;
	}

	appendLog(roleId: string, lines: string[]) {
		const cur = this.logs[roleId] ?? [];
		this.logs = {
			...this.logs,
			[roleId]: [...cur, ...lines].slice(-200)
		};
	}

	applyInstructions(instructions: string) {
		this.instructions = instructions;
		if (!this.instructionsDirty) this.instructionsDraft = instructions;
	}

	async saveInstructions(next: string): Promise<boolean> {
		if (!this.#actor) return false;
		this.instructionsBusy = true;
		this.instructionsSaved = false;
		try {
			const result = await this.#actor.setInstructions({ instructions: next });
			if (!result) return false;
			this.instructions = result.instructions;
			this.instructionsDraft = result.instructions;
			this.instructionsSaved = true;
			return true;
		} finally {
			this.instructionsBusy = false;
		}
	}

	applyDoc(doc: SpecDocVersion) {
		this.doc = doc;
		const rest = this.docHistory.filter((h) => h.version !== doc.version);
		this.docHistory = [{ version: doc.version, createdAt: doc.createdAt }, ...rest].sort(
			(a, b) => b.version - a.version
		);
	}

	async startRun(): Promise<boolean> {
		if (!this.#actor) return false;
		this.runBusy = true;
		this.#error = null;
		this.logs = {};
		this.agents = [];
		this.prUrl = null;
		this.prError = null;
		try {
			const result = await this.#actor.startRun();
			if (!result?.runId) {
				this.#error = 'Failed to start run';
				return false;
			}
			this.activeRunId = result.runId;
			return true;
		} catch (err) {
			this.#error = err instanceof Error ? err.message : 'Failed to start run';
			return false;
		} finally {
			this.runBusy = false;
		}
	}

	async cancelRun(): Promise<void> {
		if (!this.#actor) return;
		this.runBusy = true;
		try {
			await this.#actor.cancelRun();
		} finally {
			this.runBusy = false;
		}
	}

	async createPr(): Promise<string | null> {
		if (!this.#actor) return null;
		this.prBusy = true;
		this.prError = null;
		try {
			const result = await this.#actor.createPr();
			if (!result?.prUrl) {
				this.prError = 'Failed to open PR';
				return null;
			}
			this.prUrl = result.prUrl;
			return result.prUrl;
		} catch (err) {
			this.prError = err instanceof Error ? err.message : 'Failed to open PR';
			return null;
		} finally {
			this.prBusy = false;
		}
	}
}

export function createPlanStore(): PlanStore {
	return new PlanStore();
}
