<script lang="ts">
	import { DEFAULT_INSTRUCTIONS, LIMITS } from '$lib/protocol';
	import TerminalFrame from './TerminalFrame.svelte';

	let {
		value = $bindable(DEFAULT_INSTRUCTIONS),
		title = 'instructions · applies to every agent',
		collapsed = true,
		busy = false,
		saved = false,
		dirty = false,
		onsave
	}: {
		value?: string;
		title?: string;
		collapsed?: boolean;
		busy?: boolean;
		saved?: boolean;
		dirty?: boolean;
		onsave?: (instructions: string) => void;
	} = $props();

	/* svelte-ignore state_referenced_locally -- initial disclosure state only */
	let open = $state(!collapsed);

	const remaining = $derived(LIMITS.maxInstructionsChars - value.length);
	const over = $derived(remaining < 0);
</script>

<TerminalFrame {title}>
	{#snippet actions()}
		<div class="flex items-center gap-2">
			{#if onsave && dirty}
				<span class="text-spw-amber text-[11px]">unsaved</span>
			{:else if onsave && saved}
				<span class="text-spw-green text-[11px]">saved</span>
			{/if}
			<button class="spw-btn text-xs" type="button" onclick={() => (open = !open)}>
				{open ? 'hide' : 'edit'}
			</button>
		</div>
	{/snippet}

	{#if open}
		<div class="space-y-2">
			<p class="text-xs text-spw-muted">
				Injected into the roster planner, every specialist, and the synthesizer. Voice, standards,
				project rules — anything the whole team should follow.
			</p>
			<textarea
				class="spw-input w-full min-h-44 resize-y"
				spellcheck="false"
				bind:value
				aria-label="run instructions"
			></textarea>
			<div class="flex items-center justify-between gap-3">
				<span class="text-[11px]" class:text-spw-red={over} class:text-spw-faint={!over}>
					{remaining} chars left
				</span>
				<div class="flex items-center gap-2">
					<button
						class="spw-btn text-xs"
						type="button"
						onclick={() => (value = DEFAULT_INSTRUCTIONS)}
					>
						reset
					</button>
					{#if onsave}
						<button
							class="spw-btn-primary text-xs"
							type="button"
							disabled={busy || over || !dirty}
							onclick={() => onsave?.(value)}
						>
							{busy ? 'saving…' : 'save'}
						</button>
					{/if}
				</div>
			</div>
		</div>
	{:else}
		<pre class="text-xs text-spw-muted whitespace-pre-wrap line-clamp-3">{value.trim() ||
				'(none)'}</pre>
	{/if}
</TerminalFrame>
