<script lang="ts">
	let {
		status = 'idle'
	}: {
		status?: 'idle' | 'ok' | 'warn' | 'err' | 'busy';
	} = $props();

	const cls = $derived(
		status === 'ok'
			? 'spw-dot-green'
			: status === 'warn'
				? 'spw-dot-amber'
				: status === 'err'
					? 'spw-dot-red'
					: status === 'busy'
						? 'spw-dot-blue spw-pulse'
						: 'spw-dot-muted'
	);

	const label = $derived(
		status === 'ok'
			? 'ok'
			: status === 'warn'
				? 'warn'
				: status === 'err'
					? 'error'
					: status === 'busy'
						? 'busy'
						: 'idle'
	);
</script>

<span class={cls} title={label} role="status" aria-label={label}></span>
