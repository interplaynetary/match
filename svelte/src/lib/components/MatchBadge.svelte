<script lang="ts">
	import type { Match } from '$lib/frontend/types';

	let { match }: { match: Match } = $props();

	const cat = $derived(match.breakdown.categoryMatch);
	const hasCat = $derived(cat && !cat.isBlocked && cat.overlapCategory);
</script>

{#if hasCat && cat}
	{#if cat.overlapDistance === 0}
		<span class="match-level-badge match-level-exact">Both: {cat.overlapCategory}</span>
	{:else}
		<span class="match-level-badge match-level-related">Via: {cat.overlapCategory}</span>
	{/if}
{:else}
	<span class="match-level-badge match-level-embedding">Similar meaning</span>
{/if}
