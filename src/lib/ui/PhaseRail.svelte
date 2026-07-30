<script lang="ts">
	import { RUN_PHASES, type RunPhase } from '$lib/protocol';

	let {
		phase = 'idle'
	}: {
		phase?: RunPhase;
	} = $props();

	const steps = RUN_PHASES;

	const failed = $derived(phase === 'cancelled' || phase === 'error');
	const currentIdx = $derived(
		phase === 'idle' ? -1 : phase === 'done' ? steps.length - 1 : steps.indexOf(phase as (typeof steps)[number])
	);

	function label(p: string): string {
		return p;
	}
</script>

<nav class="flex items-center gap-1 overflow-x-auto py-1" aria-label="run phase">
	{#if failed}
		<span
			class="inline-flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-spw)] border border-spw-red/40 bg-spw-red/10 text-spw-red text-[11px]"
		>
			<span class="spw-dot-red"></span>
			{phase}
		</span>
	{:else}
		{#each steps as step, i (step)}
			{@const done = currentIdx > i || phase === 'done'}
			{@const active = currentIdx === i && phase !== 'done'}
			{@const future = currentIdx < i && phase !== 'done'}
			{#if i > 0}
				<span
					class="h-px w-4 shrink-0 {done || active ? 'bg-spw-green/50' : 'bg-spw-border'}"
					aria-hidden="true"
				></span>
			{/if}
			<span
				class="inline-flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-spw)] text-[11px] border shrink-0
					{active
					? 'border-spw-green/50 bg-spw-green/10 text-spw-green'
					: done
						? 'border-spw-border bg-spw-panel-2 text-spw-muted'
						: future
							? 'border-transparent text-spw-faint'
							: 'border-spw-border text-spw-muted'}"
				aria-current={active ? 'step' : undefined}
			>
				<span
					class="inline-block w-1.5 h-1.5 rounded-full shrink-0
						{active ? 'bg-spw-green spw-pulse' : done ? 'bg-spw-green' : 'bg-spw-faint'}"
				></span>
				{label(step)}
			</span>
		{/each}
	{/if}
</nav>
