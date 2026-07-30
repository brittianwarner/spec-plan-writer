import type {
	OpenRouterKeyStatus,
	PlanSummary,
	PublicProfile,
	RepoSummary
} from '$lib/protocol';

export interface UserActorHandle {
	isConnected: boolean;
	getProfile(): Promise<PublicProfile | undefined>;
	listPlans(): Promise<{ plans: PlanSummary[] } | undefined>;
	listRepos(): Promise<{ repos: RepoSummary[] } | undefined>;
	setOpenRouterKey(input: { key: string }): Promise<{ ok: boolean; error?: string } | undefined>;
	clearOpenRouterKey(): Promise<unknown>;
	createPlan(input: {
		prompt: string;
		repoFullName: string;
		defaultBranch: string;
		title?: string;
		instructions?: string;
	}): Promise<{ planId: string } | undefined>;
	renamePlan(input: { planId: string; title: string }): Promise<unknown>;
	deletePlan(input: { planId: string }): Promise<unknown>;
}

export class UserStore {
	profile = $state.raw<PublicProfile | null>(null);
	plans = $state.raw<PlanSummary[]>([]);
	repos = $state.raw<RepoSummary[]>([]);
	loading = $state(true);
	reposLoading = $state(false);
	keyBusy = $state(false);
	keyError = $state<string | null>(null);
	#actor: UserActorHandle | null = null;

	get connected(): boolean {
		return this.#actor?.isConnected ?? false;
	}

	bind(actor: UserActorHandle) {
		this.#actor = actor;
	}

	async sync() {
		if (!this.#actor) return;
		this.loading = true;
		try {
			const [p, plans] = await Promise.all([
				this.#actor.getProfile(),
				this.#actor.listPlans()
			]);
			if (p) this.profile = p;
			if (plans?.plans) this.plans = plans.plans;
		} finally {
			this.loading = false;
		}
	}

	applyProfile(p: PublicProfile) {
		this.profile = p;
	}

	applyPlans(plans: PlanSummary[]) {
		this.plans = plans;
	}

	applyKeyStatus(s: OpenRouterKeyStatus) {
		if (!this.profile) return;
		this.profile = { ...this.profile, keyStatus: s };
	}

	async setKey(key: string): Promise<boolean> {
		if (!this.#actor) return false;
		this.keyBusy = true;
		this.keyError = null;
		try {
			const result = await this.#actor.setOpenRouterKey({ key });
			if (!result) {
				this.keyError = 'Request failed';
				return false;
			}
			if (!result.ok) {
				this.keyError = result.error ?? 'Invalid key';
				this.applyKeyStatus('invalid');
				return false;
			}
			this.applyKeyStatus('valid');
			return true;
		} catch (err) {
			this.keyError = err instanceof Error ? err.message : 'Failed to set key';
			return false;
		} finally {
			this.keyBusy = false;
		}
	}

	async clearKey(): Promise<void> {
		if (!this.#actor) return;
		this.keyBusy = true;
		this.keyError = null;
		try {
			await this.#actor.clearOpenRouterKey();
			this.applyKeyStatus('unset');
		} finally {
			this.keyBusy = false;
		}
	}

	async loadRepos(): Promise<RepoSummary[]> {
		if (!this.#actor) return this.repos;
		this.reposLoading = true;
		try {
			const result = await this.#actor.listRepos();
			if (result?.repos) this.repos = result.repos;
			return this.repos;
		} finally {
			this.reposLoading = false;
		}
	}

	async createPlan(input: {
		prompt: string;
		repoFullName: string;
		defaultBranch: string;
		title?: string;
		instructions?: string;
	}): Promise<string | null> {
		if (!this.#actor) return null;
		const result = await this.#actor.createPlan(input);
		return result?.planId ?? null;
	}

	async renamePlan(planId: string, title: string): Promise<void> {
		if (!this.#actor) return;
		await this.#actor.renamePlan({ planId, title });
	}

	async deletePlan(planId: string): Promise<void> {
		if (!this.#actor) return;
		await this.#actor.deletePlan({ planId });
		this.plans = this.plans.filter((p) => p.planId !== planId);
	}
}

export const userStore = new UserStore();
