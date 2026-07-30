<script lang="ts">
	import { onMount } from 'svelte';
	import { ensureActorToken, getRivet, rivetContext } from '$lib/client/rivet';
	import { StatusBar } from '$lib/ui';
	import UserShell from './UserShell.svelte';

	let { children, data } = $props();

	/* svelte-ignore state_referenced_locally -- layout data is fixed for the session */
	const userId = data.user.userId;
	/* svelte-ignore state_referenced_locally */
	const sessionLogin = data.user.login;
	/* svelte-ignore state_referenced_locally */
	const sessionAvatar = data.user.avatarUrl;

	// Browser always dials this origin's /api/rivet (metadata → WS).
	rivetContext.set(getRivet());

	let tokenReady = $state(false);
	let tokenError = $state<string | null>(null);

	onMount(() => {
		let cancelled = false;
		(async () => {
			try {
				await ensureActorToken();
				if (!cancelled) tokenReady = true;
			} catch (err) {
				tokenError = err instanceof Error ? err.message : 'Failed to mint actor token';
			}
		})();
		return () => {
			cancelled = true;
		};
	});
</script>

{#if tokenError}
	<div class="min-h-full flex flex-col pb-14">
		<div class="p-6 text-spw-red text-sm">{tokenError}</div>
		<StatusBar login={sessionLogin} avatarUrl={sessionAvatar} keyStatus="unset" connected={false} />
	</div>
{:else if !tokenReady}
	<div class="min-h-full flex flex-col pb-14">
		<div class="p-6 text-spw-muted text-sm">minting actor token…</div>
		<StatusBar login={sessionLogin} avatarUrl={sessionAvatar} keyStatus="unset" connected={false} />
	</div>
{:else}
	<UserShell {userId} {sessionLogin} {sessionAvatar}>
		{@render children()}
	</UserShell>
{/if}
