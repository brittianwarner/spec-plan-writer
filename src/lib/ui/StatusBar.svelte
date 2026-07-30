<script lang="ts">
	import type { OpenRouterKeyStatus } from '$lib/protocol';
	import StatusDot from './StatusDot.svelte';

	let {
		login = '',
		avatarUrl = null,
		keyStatus = 'unset',
		connected = false
	}: {
		login?: string;
		avatarUrl?: string | null;
		keyStatus?: OpenRouterKeyStatus;
		connected?: boolean;
	} = $props();

	const keyLabel = $derived(
		keyStatus === 'valid' ? 'key:ok' : keyStatus === 'invalid' ? 'key:bad' : 'key:—'
	);

	const keyTone = $derived(
		keyStatus === 'valid'
			? 'border-spw-green/40 text-spw-green bg-spw-green/10'
			: keyStatus === 'invalid'
				? 'border-spw-red/40 text-spw-red bg-spw-red/10'
				: 'border-spw-border text-spw-faint bg-spw-panel-2'
	);

	const connStatus = $derived(connected ? 'ok' : 'err');
</script>

<footer
	class="shrink-0 flex items-center gap-3 px-3 py-1.5 border-t border-spw-border bg-spw-panel text-[11px] text-spw-muted"
>
	<span class="inline-flex items-center gap-2 min-w-0">
		{#if avatarUrl}
			<img
				src={avatarUrl}
				alt=""
				class="w-4 h-4 rounded-sm border border-spw-border"
				width="16"
				height="16"
			/>
		{/if}
		<span class="truncate text-spw-text">
			{login ? `${login}@github` : 'guest'}
		</span>
	</span>

	<span class="text-spw-border" aria-hidden="true">·</span>

	<span
		class="inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-spw)] border {keyTone} font-medium"
	>
		{keyLabel}
	</span>

	<span class="text-spw-border" aria-hidden="true">·</span>

	<span class="inline-flex items-center gap-1.5">
		<StatusDot status={connStatus} />
		<span>{connected ? 'connected' : 'offline'}</span>
	</span>

	<span class="flex-1"></span>

	{#if login}
		<form method="POST" action="/auth/logout">
			<button type="submit" class="spw-btn text-[11px] py-0.5 px-2">sign out</button>
		</form>
	{/if}
</footer>
