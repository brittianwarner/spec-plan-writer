<script lang="ts">
	import TerminalFrame from './TerminalFrame.svelte';

	let {
		open = $bindable(false),
		busy = false,
		error = null,
		onsubmit
	}: {
		open?: boolean;
		busy?: boolean;
		error?: string | null;
		onsubmit: (key: string) => void;
	} = $props();

	let key = $state('');
	let inputEl: HTMLInputElement | undefined = $state();

	$effect(() => {
		if (!open) return;
		key = '';
		const t = setTimeout(() => inputEl?.focus(), 30);
		return () => clearTimeout(t);
	});

	function close() {
		if (busy) return;
		open = false;
	}

	function submit(e?: Event) {
		e?.preventDefault();
		const v = key.trim();
		if (!v || busy) return;
		onsubmit(v);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			close();
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-[2px]"
		role="dialog"
		aria-modal="true"
		aria-label="OpenRouter API key"
		tabindex="-1"
		onkeydown={onKeydown}
		onclick={(e) => {
			if (e.target === e.currentTarget) close();
		}}
	>
		<div class="w-full max-w-md">
			<TerminalFrame title="openrouter · api key">
				{#snippet actions()}
					<button type="button" class="spw-btn text-[11px]" onclick={close} disabled={busy}>esc</button>
				{/snippet}
				<form class="p-4 flex flex-col gap-3" onsubmit={submit}>
					<p class="text-[11px] text-spw-muted leading-relaxed">
						Your key stays on your user actor. We only verify it with
						<span class="text-spw-text">openai/gpt-oss-120b:nitro</span>.
					</p>
					<label class="flex flex-col gap-1.5">
						<span class="text-[10px] uppercase tracking-wider text-spw-faint">api key</span>
						<input
							bind:this={inputEl}
							class="spw-input font-mono"
							type="password"
							name="openrouter-key"
							autocomplete="off"
							spellcheck="false"
							placeholder="sk-or-…"
							bind:value={key}
							disabled={busy}
						/>
					</label>
					{#if error}
						<p class="text-[11px] text-spw-red">{error}</p>
					{/if}
					<div class="flex items-center justify-end gap-2 pt-1">
						<button type="button" class="spw-btn" onclick={close} disabled={busy}>cancel</button>
						<button type="submit" class="spw-btn-primary" disabled={busy || !key.trim()}>
							{busy ? 'verifying…' : 'save key'}
						</button>
					</div>
				</form>
			</TerminalFrame>
		</div>
	</div>
{/if}
