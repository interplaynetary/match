<script lang="ts">
	import type { Match } from '$lib/frontend/types';
	import MatchBadge from './MatchBadge.svelte';
	import ConstraintScores from './ConstraintScores.svelte';

	let {
		match,
		needText,
		capacityText
	}: {
		match: Match;
		needText: string;
		capacityText: string;
	} = $props();

	const catMatch = $derived(match.breakdown.categoryMatch);
	const hasCategory = $derived(catMatch && !catMatch.isBlocked && catMatch.overlapCategory);
</script>

<div>
	<strong>Match</strong>
	{' '}
	<span style="color: #4CAF50">
		{(match.score * 100).toFixed(0)}%
	</span>
	<MatchBadge {match} />
	<div class="match-connection">
		<div class="match-connection-expr">"{needText}"</div>
		<div class="match-connection-link">
			{#if hasCategory && catMatch}
				{#if catMatch.overlapDistance === 0}
					<span class="link-word">{catMatch.overlapCategory}</span>
				{:else}
					<span>both relate to</span>
					<span class="link-word">{catMatch.overlapCategory}</span>
				{/if}
			{:else}
				<span>similar to</span>
			{/if}
		</div>
		<div class="match-connection-expr">"{capacityText}"</div>
	</div>
	<ConstraintScores breakdown={match.breakdown} />
</div>
