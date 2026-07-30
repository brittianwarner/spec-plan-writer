<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<div class="min-h-full flex flex-col">
	{@render children()}
</div>
