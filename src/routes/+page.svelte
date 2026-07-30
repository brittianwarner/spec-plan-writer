<script lang="ts">
	import { page } from '$app/state';
	import { TerminalFrame } from '$lib/ui';

	const error = $derived(page.url.searchParams.get('error'));
</script>

<svelte:head>
	<title>spec-plan-writer · multi-agent specs with Rivet + agentOS</title>
	<meta
		name="description"
		content="A public multi-agent spec writer. GitHub OAuth, your OpenRouter key, a shared agentOS filesystem, and a grid of specialist workers that draft a real plan."
	/>
</svelte:head>

<main class="min-h-full flex items-center justify-center p-6">
	<div class="w-full max-w-2xl space-y-6">
		<header class="space-y-2">
			<p class="text-spw-muted text-xs tracking-widest uppercase">open source · rivet · agentos · s3</p>
			<h1 class="text-2xl text-spw-fg font-semibold tracking-tight">
				<span class="text-spw-green">$</span> spec-plan-writer
			</h1>
			<p class="text-spw-muted leading-relaxed">
				Describe a change. A team of specialist agents clones your repo into a shared filesystem,
				divides the work, and drafts a grounded spec plan you can open as a PR.
			</p>
		</header>

		<TerminalFrame title="~/spec-plan-writer · login">
			<div class="space-y-4 text-sm leading-relaxed">
				<pre class="text-spw-muted whitespace-pre-wrap">{`# What this is
A public showcase of Rivet Actors + agentOS + S3-mounted filesystems.

# What happens after you sign in
1. paste your OpenRouter API key (verified live)
2. pick a GitHub repo + write a prompt
3. watch a grid of workers draft the plan together
4. read the finished Markdown · open a PR`}</pre>

				{#if error}
					<p class="text-spw-red text-xs">
						auth failed{error !== 'auth_failed' ? ` (${error})` : ''}. try again.
					</p>
				{/if}

				<a
					href="/auth/github"
					class="spw-btn-primary inline-flex items-center gap-2 no-underline"
				>
					<span class="text-spw-bg">→</span> login --github
				</a>

				<p class="text-spw-muted text-xs">
					Scopes: <code class="text-spw-fg">read:user</code> (profile) ·
					<code class="text-spw-fg">repo</code> (read files, open PRs). Your OpenRouter key never
					leaves your user actor.
				</p>
			</div>
		</TerminalFrame>

		<footer class="text-xs text-spw-muted flex flex-wrap gap-x-4 gap-y-1">
			<a class="hover:text-spw-fg" href="https://rivet.dev/docs/actors/crash-course/" target="_blank" rel="noreferrer"
				>Rivet actors</a
			>
			<a class="hover:text-spw-fg" href="https://agentos-sdk.dev/docs/crash-course/" target="_blank" rel="noreferrer"
				>agentOS</a
			>
			<a class="hover:text-spw-fg" href="https://github.com" target="_blank" rel="noreferrer">source</a>
		</footer>
	</div>
</main>
