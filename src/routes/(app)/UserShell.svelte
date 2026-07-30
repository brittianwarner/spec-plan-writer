<script lang="ts">
	import { onMount } from 'svelte';
	import { actorParamsToken, rivetContext } from '$lib/client/rivet';
	import { withActorParams } from '@rivetkit/svelte';
	import { StatusBar } from '$lib/ui';
	import { userStore } from '$lib/stores/user.svelte';
	import type { OpenRouterKeyStatus, PlanSummary, PublicProfile } from '$lib/protocol';

	let {
		userId,
		sessionLogin,
		sessionAvatar,
		children
	}: {
		userId: string;
		sessionLogin: string;
		sessionAvatar: string | null;
		children: import('svelte').Snippet;
	} = $props();

	const { useActor } = rivetContext.get();

	const userActor = useActor(
		withActorParams(
			() => ({ name: 'user' as const, key: ['user', userId] }),
			actorParamsToken()
		)
	);

	userActor.onEvent('profileChanged', (p: PublicProfile) => userStore.applyProfile(p));
	userActor.onEvent('keyStatusChanged', (p: { keyStatus: OpenRouterKeyStatus }) =>
		userStore.applyKeyStatus(p.keyStatus)
	);
	userActor.onEvent('plansChanged', (p: { plans: PlanSummary[] }) => userStore.applyPlans(p.plans));

	let ready = $state(false);
	let error = $state<string | null>(null);

	onMount(() => {
		let cancelled = false;
		userStore.bind(userActor as unknown as Parameters<typeof userStore.bind>[0]);
		(async () => {
			try {
				const start = Date.now();
				while (!userActor.isConnected && Date.now() - start < 10_000) {
					await new Promise((r) => setTimeout(r, 40));
					if (cancelled) return;
				}
				if (!userActor.isConnected) {
					error = 'Could not connect to your user actor. Refresh to retry.';
					return;
				}
				await userStore.sync();
				if (!cancelled) ready = true;
			} catch (err) {
				error = err instanceof Error ? err.message : 'Failed to connect';
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		if (userActor.isConnected && ready) void userStore.sync();
	});
</script>

<div class="min-h-full flex flex-col pb-10">
	{#if error}
		<div class="p-6 text-spw-red text-sm">{error}</div>
	{:else if !ready}
		<div class="p-6 text-spw-muted text-sm">connecting to actors…</div>
	{:else}
		{@render children()}
	{/if}

	 <StatusBar
		login={userStore.profile?.login ?? sessionLogin}
		avatarUrl={userStore.profile?.avatarUrl ?? sessionAvatar}
		keyStatus={userStore.profile?.keyStatus ?? 'unset'}
		connected={userActor.isConnected}
	/>
</div>
