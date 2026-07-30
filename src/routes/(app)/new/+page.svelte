<script lang="ts">
	import { goto } from '$app/navigation';
	import { InstructionsEditor, KeyDialog, RepoPicker, TerminalFrame } from '$lib/ui';
	import { DEFAULT_INSTRUCTIONS } from '$lib/protocol';
	import { userStore } from '$lib/stores/user.svelte';

	let prompt = $state('');
	let repoFullName = $state('');
	let instructions = $state(DEFAULT_INSTRUCTIONS);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let showKey = $state(false);

	$effect(() => {
		void userStore.loadRepos();
	});

	const selected = $derived(userStore.repos.find((r) => r.fullName === repoFullName) ?? null);

	async function submit() {
		error = null;
		if (userStore.profile?.keyStatus !== 'valid') {
			showKey = true;
			return;
		}
		if (!prompt.trim()) {
			error = 'write a prompt first';
			return;
		}
		if (!selected) {
			error = 'pick a repository';
			return;
		}
		busy = true;
		try {
			const planId = await userStore.createPlan({
				prompt: prompt.trim(),
				repoFullName: selected.fullName,
				defaultBranch: selected.defaultBranch,
				instructions
			});
			if (!planId) {
				error = 'failed to create plan';
				return;
			}
			await goto(`/plan/${planId}`);
		} catch (err) {
			error = err instanceof Error ? err.message : 'failed to create plan';
		} finally {
			busy = false;
		}
	}

	async function onKeySubmit(key: string) {
		const ok = await userStore.setKey(key);
		if (ok) showKey = false;
	}
</script>

<svelte:head>
	<title>new plan · spec-plan-writer</title>
</svelte:head>

<main class="flex-1 p-6 max-w-3xl mx-auto w-full space-y-6">
	<header class="flex items-end justify-between gap-4">
		<div>
			<p class="text-xs text-spw-muted tracking-widest uppercase">~/plans/new</p>
			<h1 class="text-xl text-spw-fg">build a spec plan</h1>
		</div>
		<a class="spw-btn no-underline" href="/dashboard">← back</a>
	</header>

	<TerminalFrame title="cat > prompt.md <<'EOF'">
		<textarea
			class="spw-input w-full min-h-40 resize-y"
			placeholder="Describe the change you want planned. What should exist when the work is done? Any constraints?"
			bind:value={prompt}
		></textarea>
		<p class="text-xs text-spw-muted mt-2">EOF</p>
	</TerminalFrame>

	<TerminalFrame title="git remote -v · pick a repo">
		<RepoPicker repos={userStore.repos} bind:value={repoFullName} loading={userStore.reposLoading} />
	</TerminalFrame>

	<InstructionsEditor bind:value={instructions} />

	{#if error}
		<p class="text-spw-red text-sm">{error}</p>
	{/if}

	<div class="flex items-center gap-3">
		<button class="spw-btn-primary" type="button" disabled={busy} onclick={submit}>
			{busy ? 'creating…' : 'create plan →'}
		</button>
		<span class="text-xs text-spw-muted">
			clones the repo into a shared agentOS filesystem, then fans specialists out.
		</span>
	</div>
</main>

<KeyDialog
	bind:open={showKey}
	busy={userStore.keyBusy}
	error={userStore.keyError}
	onsubmit={onKeySubmit}
/>
