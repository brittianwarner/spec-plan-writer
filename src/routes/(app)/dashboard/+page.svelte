<script lang="ts">
	import { goto } from '$app/navigation';
	import { KeyDialog, TerminalFrame, StatusDot } from '$lib/ui';
	import { userStore } from '$lib/stores/user.svelte';
	import type { PlanStatus } from '$lib/protocol';

	let showKey = $state(false);
	let keyPromptSeen = $state(false);

	$effect(() => {
		// Open once on first unset, never force-reopen after dismiss.
		if (!keyPromptSeen && userStore.profile?.keyStatus === 'unset') {
			showKey = true;
			keyPromptSeen = true;
		}
	});

	async function onKeySubmit(key: string) {
		const ok = await userStore.setKey(key);
		if (ok) showKey = false;
	}

	function statusTone(s: PlanStatus): 'idle' | 'ok' | 'warn' | 'err' | 'busy' {
		if (s === 'ready') return 'ok';
		if (s === 'generating') return 'busy';
		if (s === 'failed') return 'err';
		return 'idle';
	}

	function relTime(ts: number): string {
		const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
		if (s < 60) return `${s}s ago`;
		if (s < 3600) return `${Math.floor(s / 60)}m ago`;
		if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
		return `${Math.floor(s / 86400)}d ago`;
	}

	async function remove(planId: string) {
		if (!confirm('Delete this plan?')) return;
		await userStore.deletePlan(planId);
	}
</script>

<svelte:head>
	<title>plans · spec-plan-writer</title>
</svelte:head>

<main class="flex-1 p-6 max-w-4xl mx-auto w-full space-y-6">
	<header class="flex items-end justify-between gap-4">
		<div>
			<p class="text-xs text-spw-muted tracking-widest uppercase">~/plans</p>
			<h1 class="text-xl text-spw-fg">your spec plans</h1>
		</div>
		<div class="flex items-center gap-2">
			<button class="spw-btn" onclick={() => (showKey = true)} type="button">
				key · {userStore.profile?.keyStatus ?? 'unset'}
			</button>
			<a class="spw-btn-primary no-underline" href="/new">new plan</a>
		</div>
	</header>

	<TerminalFrame title="ls ~/plans">
		{#if userStore.loading}
			<p class="text-spw-muted text-sm">loading…</p>
		{:else if userStore.plans.length === 0}
			<div class="space-y-3 text-sm">
				<p class="text-spw-muted">no plans yet.</p>
				<pre class="text-spw-muted">{`$ spec-plan new --prompt "…" --repo owner/name`}</pre>
				<a class="spw-btn-primary inline-flex no-underline" href="/new">create your first plan →</a>
			</div>
		{:else}
			<ul class="divide-y divide-spw-border">
				{#each userStore.plans as plan (plan.planId)}
					<li class="py-3 flex items-center gap-3">
						<StatusDot status={statusTone(plan.status)} />
						<a class="flex-1 min-w-0 no-underline hover:text-spw-green" href={`/plan/${plan.planId}`}>
							<div class="text-spw-fg truncate">{plan.title}</div>
							<div class="text-xs text-spw-muted truncate">
								{plan.repoFullName} · {plan.status}
								{#if plan.roleCount > 0}
									· {plan.roleCount} specialists
								{/if}
								· {relTime(plan.updatedAt)}
							</div>
						</a>
						<button
							class="spw-btn text-xs"
							type="button"
							onclick={() => remove(plan.planId)}
						>
							rm
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</TerminalFrame>
</main>

<KeyDialog
	bind:open={showKey}
	busy={userStore.keyBusy}
	error={userStore.keyError}
	onsubmit={onKeySubmit}
/>
