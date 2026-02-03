<script lang="ts">
	import type { PCATransform } from '$lib/core/semantic-colors';
	import type { NodeItem, MatchWithOther } from '$lib/frontend/types';
	import { getNodeColor } from '$lib/frontend/utils';
	import MatchBadge from './MatchBadge.svelte';
	import ConstraintScores from './ConstraintScores.svelte';
	import ItemCard from './ItemCard.svelte';

	let {
		activeItem,
		activeIsCapacity,
		activeMatches,
		transform,
		onBack
	}: {
		activeItem: NodeItem;
		activeIsCapacity: boolean;
		activeMatches: MatchWithOther[];
		transform: PCATransform;
		onBack: () => void;
	} = $props();

	const color = $derived(getNodeColor(activeItem.embedding, transform, activeIsCapacity));

	const constraintEntries = $derived.by(() => {
		if (!activeItem.constraints) return [];
		return Object.entries(activeItem.constraints).filter(([_, v]) => v);
	});
</script>

<div class="sidebar-view active">
	<button class="back-button" onclick={onBack}>
		<span>&#8592;</span> Back to Overview
	</button>

	<div class="node-header">
		<div
			class="node-header-icon {activeIsCapacity ? 'capacity' : ''}"
			style="background: {color}"
		></div>
		<div>
			<div class="node-title">
				{activeIsCapacity ? 'Capacity' : 'Need'} #{activeItem.id}
			</div>
		</div>
	</div>
	<p style="font-size: 0.9em; color: #ccc; margin-bottom: 15px;">
		{activeItem.label}
	</p>

	{#if constraintEntries.length > 0}
		<div class="active-constraints">
			{#each constraintEntries as [key, value]}
				<div class="constraint-row">
					<span class="constraint-label">{key}:</span>
					<span>{value}</span>
				</div>
			{/each}
		</div>
	{/if}

	<h2 style="margin-top: 20px;">Top Matches ({activeMatches.length})</h2>
	<div class="match-list">
		{#if activeMatches.length === 0}
			<p style="color: #888">No matches above threshold</p>
		{/if}
		{#each activeMatches.slice(0, 20) as m (`${m.capacityId}-${m.needId}`)}
			{#if m.other}
				<ItemCard
					item={m.other}
					isCapacity={m.otherType === 'Capacity'}
					{transform}
					score={m.score}
				>
					{#snippet children()}
						<div style="margin-top: 6px;">
							<MatchBadge match={m} />
						</div>
						<ConstraintScores
							breakdown={m.breakdown}
							compact
							showSide={activeIsCapacity ? 'need' : 'capacity'}
						/>
					{/snippet}
				</ItemCard>
			{/if}
		{/each}
		{#if activeMatches.length > 20}
			<p style="color: #888; text-align: center;">
				... and {activeMatches.length - 20} more
			</p>
		{/if}
	</div>
</div>
