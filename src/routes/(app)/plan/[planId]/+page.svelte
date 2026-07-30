<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { withActorParams } from '@rivetkit/svelte';
	import { actorParamsToken, ensureActorToken, rivetContext } from '$lib/client/rivet';
	import { createPlanStore } from '$lib/stores/plan.svelte';
	import {
		InstructionsEditor,
		LogPane,
		Markdown,
		PhaseRail,
		TerminalFrame
	} from '$lib/ui';
	import type {
		AgentCard,
		DocUpdatedEvent,
		RunPhase,
		WorkerLogEvent
	} from '$lib/protocol';

	let { data } = $props();
	const planId = $derived(page.params.planId ?? '');

	const store = createPlanStore();
	const { useActor } = rivetContext.get();

	let view = $state<'run' | 'spec'>('run');
	let booted = $state(false);
	let bootError = $state<string | null>(null);

	const planActor = useActor(
		withActorParams(
			() => ({
				name: 'specPlan' as const,
				key: ['specPlan', data.user.userId, planId]
			}),
			actorParamsToken()
		)
	);

	planActor.onEvent('phaseChanged', (p: {phase: RunPhase; statusLine?: string }) => {
		store.applyPhase(p.phase, p.statusLine);
		if (p.phase === 'done') view = 'spec';
		if (p.phase === 'provisioning' || p.phase === 'planning' || p.phase === 'writing' || p.phase === 'synthesizing') {
			view = 'run';
		}
	});
	planActor.onEvent('rosterChanged', (p: { agents: AgentCard[] }) => store.applyRoster(p.agents));
	planActor.onEvent('workerLog', (p: WorkerLogEvent) => store.appendLog(p.roleId, p.lines));
	planActor.onEvent('instructionsChanged', (p: { instructions: string }) =>
		store.applyInstructions(p.instructions)
	);
	planActor.onEvent('docUpdated', (p: DocUpdatedEvent) => {
		store.applyDoc(p.doc);
		view = 'spec';
	});

	onMount(() => {
		let cancelled = false;
		(async () => {
			try {
				await ensureActorToken();
				if (cancelled) return;
				store.bind(planActor as unknown as Parameters<typeof store.bind>[0]);
				const start = Date.now();
				while (!planActor.isConnected && Date.now() - start < 8_000) {
					await new Promise((r) => setTimeout(r, 50));
					if (cancelled) return;
				}
				await store.sync();
				if (store.doc) view = 'spec';
				booted = true;
			} catch (err) {
				bootError = err instanceof Error ? err.message : 'failed to connect';
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	const gridClass = $derived(
		store.agents.length <= 1
			? 'grid-cols-1'
			: store.agents.length <= 4
				? 'grid-cols-1 md:grid-cols-2'
				: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
	);

	function accentFor(status: AgentCard['status']): 'green' | 'blue' | 'amber' | 'red' {
		if (status === 'done') return 'green';
		if (status === 'error') return 'red';
		if (status === 'running') return 'blue';
		return 'amber';
	}

	async function downloadMd() {
		if (!store.doc) return;
		const blob = new Blob([store.doc.markdown], { type: 'text/markdown' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${store.title || 'spec'}.md`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function copyMd() {
		if (!store.doc) return;
		await navigator.clipboard.writeText(store.doc.markdown);
	}
</script>

<svelte:head>
	<title>{store.title || 'plan'} · spec-plan-writer</title>
</svelte:head>

<main class="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full space-y-4">
	<header class="flex flex-wrap items-end justify-between gap-3">
		<div class="min-w-0">
			<p class="text-xs text-spw-muted tracking-widest uppercase truncate">
				~/plans/{planId.slice(0, 8)}
			</p>
			<h1 class="text-xl text-spw-fg truncate">{store.title || 'loading…'}</h1>
			<p class="text-xs text-spw-muted truncate">
				{store.repoFullName}
				{#if store.statusLine}
					· {store.statusLine}
				{/if}
			</p>
		</div>
		<div class="flex items-center gap-2 flex-wrap">
			<a class="spw-btn no-underline" href="/dashboard">← plans</a>
			{#if store.doc}
				<button class="spw-btn" type="button" class:opacity-100={view === 'run'} onclick={() => (view = 'run')}>
					run
				</button>
				<button class="spw-btn" type="button" onclick={() => (view = 'spec')}>spec</button>
			{/if}
			{#if store.isRunning}
				<button class="spw-btn" type="button" disabled={store.runBusy} onclick={() => store.cancelRun()}>
					cancel
				</button>
			{:else}
				<button
					class="spw-btn-primary"
					type="button"
					disabled={store.runBusy || !booted}
					onclick={async () => {
						const ok = await store.startRun();
						if (ok) view = 'run';
					}}
				>
					{store.doc ? 'regenerate' : 'generate'}
				</button>
			{/if}
		</div>
	</header>

	<PhaseRail phase={store.phase} />

	{#if bootError}
		<p class="text-spw-red text-sm">{bootError}</p>
	{:else if !booted || store.loading}
		<p class="text-spw-muted text-sm">booting plan actor…</p>
	{:else if view === 'spec' && store.doc}
		<TerminalFrame title={`SPEC.md · v${store.doc.version}`}>
			{#snippet actions()}
				<div class="flex items-center gap-2">
					<button class="spw-btn text-xs" type="button" onclick={copyMd}>copy</button>
					<button class="spw-btn text-xs" type="button" onclick={downloadMd}>export</button>
					<button
						class="spw-btn text-xs"
						type="button"
						disabled={store.prBusy}
						onclick={() => store.createPr()}
					>
						{store.prBusy ? 'opening…' : 'open pr'}
					</button>
				</div>
			{/snippet}
			{#if store.prUrl}
				<p class="text-xs text-spw-green mb-3">
					pr opened ·
					<a class="underline" href={store.prUrl} target="_blank" rel="noreferrer">{store.prUrl}</a>
				</p>
			{/if}
			{#if store.prError}
				<p class="text-xs text-spw-red mb-3">{store.prError}</p>
			{/if}
			{#if store.agents.length > 0}
				<p class="text-xs text-spw-muted mb-4">
					drafted by {store.agents.length} specialists:
					{store.agents.map((a) => a.title).join(' · ')}
				</p>
			{/if}
			<Markdown source={store.doc.markdown} class="prose prose-invert prose-sm max-w-none" />
		</TerminalFrame>
	{:else}
		<div class="space-y-3">
			<InstructionsEditor
				bind:value={store.instructionsDraft}
				busy={store.instructionsBusy}
				saved={store.instructionsSaved}
				dirty={store.instructionsDirty}
				onsave={(next) => store.saveInstructions(next)}
				title={store.isRunning
					? 'instructions · edits apply to the next run'
					: 'instructions · applies to every agent'}
			/>

			<TerminalFrame title="coordinator">
				<pre class="text-xs text-spw-muted whitespace-pre-wrap">{store.statusLine ||
						(store.phase === 'idle' ? 'waiting to start…' : `phase: ${store.phase}`)}</pre>
				{#if store.prompt}
					<details class="mt-2">
						<summary class="text-xs text-spw-muted cursor-pointer">prompt</summary>
						<pre class="text-xs text-spw-fg whitespace-pre-wrap mt-1">{store.prompt}</pre>
					</details>
				{/if}
			</TerminalFrame>

			{#if store.agents.length === 0}
				<p class="text-spw-muted text-sm">
					{store.isRunning ? 'planning the roster…' : 'no workers yet — hit generate.'}
				</p>
			{:else}
				<div class={`grid gap-3 ${gridClass}`}>
					{#each store.agents as agent (agent.roleId)}
						<LogPane
							title={`${agent.roleId} · ${agent.title}`}
							status={agent.status}
							thought={agent.thought}
							lines={store.logs[agent.roleId] ?? []}
							accent={accentFor(agent.status)}
						/>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	{#if store.error}
		<p class="text-spw-red text-sm">{store.error}</p>
	{/if}
</main>
