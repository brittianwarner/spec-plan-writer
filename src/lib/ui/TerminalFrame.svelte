<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title = '',
		children,
		actions,
		class: className = ''
	}: {
		title?: string;
		children: Snippet;
		actions?: Snippet;
		class?: string;
	} = $props();
</script>

<section class="spw-panel overflow-hidden flex flex-col {className}">
	<header
		class="flex items-center gap-2 px-3 py-2 border-b border-spw-border bg-spw-panel-2/60 select-none"
	>
		<span class="flex items-center gap-1.5 shrink-0" aria-hidden="true">
			<span class="spw-dot-red"></span>
			<span class="spw-dot-amber"></span>
			<span class="spw-dot-green"></span>
		</span>
		{#if title}
			<span class="text-spw-muted text-[11px] tracking-wide truncate flex-1 min-w-0">{title}</span>
		{:else}
			<span class="flex-1"></span>
		{/if}
		{#if actions}
			<div class="flex items-center gap-2 shrink-0">
				{@render actions()}
			</div>
		{/if}
	</header>
	<div class="flex-1 min-h-0 p-3">
		{@render children()}
	</div>
</section>
