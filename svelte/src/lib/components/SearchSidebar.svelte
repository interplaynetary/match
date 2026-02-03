<script lang="ts">
	import type { PCATransform } from '$lib/core/semantic-colors';
	import type { MatchData } from '$lib/frontend/types';
	import type { SearchResult } from './SearchBar.svelte';
	import ItemCard from './ItemCard.svelte';
	import ThresholdSlider from './ThresholdSlider.svelte';

	let {
		searchResults,
		data,
		transform,
		threshold,
		onThresholdChange,
		onClear
	}: {
		searchResults: SearchResult[];
		data: MatchData;
		transform: PCATransform;
		threshold: number;
		onThresholdChange: (value: number) => void;
		onClear: () => void;
	} = $props();
</script>

<div class="sidebar-view active">
	<div style="display: flex; justify-content: space-between; align-items: center;">
		<h1>Results ({searchResults.length})</h1>
		<button
			onclick={onClear}
			style="background: none; border: none; color: var(--text-muted); font-size: 1.25rem; cursor: pointer; padding: 0.25rem;"
		>
			&times;
		</button>
	</div>

	<h2>Filter</h2>
	<ThresholdSlider {threshold} {onThresholdChange} />

	<div class="match-list" style="margin-top: 1rem;">
		{#if searchResults.length === 0}
			<p style="color: var(--text-muted); font-size: 0.875rem;">No results found</p>
		{/if}
		{#each searchResults as result (result.id)}
			{@const isCapacity = result.type === 'capacity'}
			{@const item = isCapacity
				? data.capacities.find((c) => c.id === result.id)
				: data.needs.find((n) => n.id === result.id)}
			{#if item}
				<ItemCard {item} {isCapacity} {transform} score={result.score} />
			{/if}
		{/each}
	</div>
</div>
