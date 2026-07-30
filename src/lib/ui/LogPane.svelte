<script lang="ts">
	import { browser } from '$app/environment';

	let {
		title,
		status,
		thought = '',
		lines = [],
		accent = 'green'
	}: {
		title: string;
		status: string;
		thought?: string;
		lines?: string[];
		accent?: 'green' | 'blue' | 'amber' | 'red';
	} = $props();

	let scroller: HTMLDivElement | undefined = $state();

	const accentColor = $derived(
		accent === 'blue'
			? 'text-spw-blue'
			: accent === 'amber'
				? 'text-spw-amber'
				: accent === 'red'
					? 'text-spw-red'
					: 'text-spw-green'
	);

	const accentBar = $derived(
		accent === 'blue'
			? 'bg-spw-blue'
			: accent === 'amber'
				? 'bg-spw-amber'
				: accent === 'red'
					? 'bg-spw-red'
					: 'bg-spw-green'
	);

	$effect(() => {
		void lines.length;
		if (!browser || !scroller) return;
		scroller.scrollTop = scroller.scrollHeight;
	});
</script>

<section class="spw-panel flex flex-col min-h-0 overflow-hidden h-full">
	<header class="flex items-center gap-2 px-2.5 py-1.5 border-b border-spw-border bg-spw-panel-2/50">
		<span class="w-0.5 h-3.5 rounded-full shrink-0 {accentBar}" aria-hidden="true"></span>
		<span class="text-[11px] font-medium truncate {accentColor}">{title}</span>
		<span class="ml-auto text-[10px] text-spw-faint uppercase tracking-wider shrink-0">{status}</span>
	</header>
	{#if thought}
		<p class="px-2.5 py-1 text-[11px] text-spw-muted border-b border-spw-border/60 truncate">
			{thought}
		</p>
	{/if}
	<div
		bind:this={scroller}
		class="flex-1 min-h-0 overflow-y-auto px-2.5 py-2 font-mono text-[11px] leading-relaxed"
	>
		{#if lines.length === 0}
			<p class="text-spw-faint italic">waiting…</p>
		{:else}
			{#each lines as line, i (`${i}-${line.slice(0, 24)}`)}
				<p class="text-spw-text/90 whitespace-pre-wrap break-words">{line}</p>
			{/each}
		{/if}
	</div>
</section>
