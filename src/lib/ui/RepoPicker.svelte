<script lang="ts">
	import type { RepoSummary } from '$lib/protocol';

	let {
		repos = [],
		value = $bindable(''),
		loading = false
	}: {
		repos?: RepoSummary[];
		value?: string;
		loading?: boolean;
	} = $props();

	let filter = $state('');

	const filtered = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		if (!q) return repos;
		return repos.filter(
			(r) =>
				r.fullName.toLowerCase().includes(q) ||
				(r.description?.toLowerCase().includes(q) ?? false) ||
				(r.language?.toLowerCase().includes(q) ?? false)
		);
	});

	function relTime(iso: string): string {
		const t = Date.parse(iso);
		if (Number.isNaN(t)) return '';
		const sec = Math.round((Date.now() - t) / 1000);
		if (sec < 60) return 'just now';
		const min = Math.round(sec / 60);
		if (min < 60) return `${min}m ago`;
		const hr = Math.round(min / 60);
		if (hr < 48) return `${hr}h ago`;
		const day = Math.round(hr / 24);
		if (day < 60) return `${day}d ago`;
		const mo = Math.round(day / 30);
		return `${mo}mo ago`;
	}

	function select(fullName: string) {
		value = fullName;
	}
</script>

<div class="flex flex-col gap-2 min-h-0">
	<input
		class="spw-input"
		type="search"
		placeholder="filter repos…"
		bind:value={filter}
		disabled={loading}
	/>
	<div class="spw-panel overflow-y-auto max-h-64 divide-y divide-spw-border">
		{#if loading}
			<p class="px-3 py-4 text-[11px] text-spw-faint">loading repos…</p>
		{:else if filtered.length === 0}
			<p class="px-3 py-4 text-[11px] text-spw-faint">
				{repos.length === 0 ? 'no repos' : 'no matches'}
			</p>
		{:else}
			{#each filtered as repo (repo.fullName)}
				<button
					type="button"
					class="w-full text-left px-3 py-2 flex flex-col gap-0.5 hover:bg-spw-panel-2 transition-colors
						{value === repo.fullName ? 'bg-spw-blue/10 border-l-2 border-l-spw-blue' : 'border-l-2 border-l-transparent'}"
					onclick={() => select(repo.fullName)}
				>
					<span class="flex items-center gap-2 min-w-0">
						<span class="text-[12px] text-spw-text truncate font-medium">{repo.fullName}</span>
						{#if repo.isPrivate}
							<span
								class="shrink-0 text-[9px] uppercase tracking-wider px-1 py-0.5 rounded-[var(--radius-spw)] border border-spw-border text-spw-faint"
								>private</span
							>
						{/if}
					</span>
					<span class="flex items-center gap-2 text-[10px] text-spw-faint">
						{#if repo.language}
							<span>{repo.language}</span>
							<span aria-hidden="true">·</span>
						{/if}
						<span>{relTime(repo.updatedAt)}</span>
						{#if repo.description}
							<span aria-hidden="true">·</span>
							<span class="truncate">{repo.description}</span>
						{/if}
					</span>
				</button>
			{/each}
		{/if}
	</div>
</div>
