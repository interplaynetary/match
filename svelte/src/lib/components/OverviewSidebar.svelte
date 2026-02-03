<script lang="ts">
	import type { MatchData, Match } from '$lib/frontend/types';
	import ThresholdSlider from './ThresholdSlider.svelte';

	let {
		data,
		filteredMatches,
		threshold,
		onThresholdChange
	}: {
		data: MatchData;
		filteredMatches: Match[];
		threshold: number;
		onThresholdChange: (value: number) => void;
	} = $props();

	const needsWithMatches = $derived(new Set(filteredMatches.map((m) => m.needId)).size);
</script>

<div class="sidebar-view active">
	<h1>Match Visualization</h1>

	<div class="stats">
		<div class="stat">
			<div class="stat-value">{data.capacities.length}</div>
			<div class="stat-label">Capacities</div>
		</div>
		<div class="stat">
			<div class="stat-value">{data.needs.length}</div>
			<div class="stat-label">Needs</div>
		</div>
		<div class="stat">
			<div class="stat-value">{filteredMatches.length}</div>
			<div class="stat-label">Matches</div>
		</div>
		<div class="stat">
			<div class="stat-value">{needsWithMatches}/{data.needs.length}</div>
			<div class="stat-label">Covered</div>
		</div>
	</div>

	<h2>Filter</h2>
	<ThresholdSlider {threshold} {onThresholdChange} />

	<h2>Legend</h2>
	<div class="legend">
		<div class="legend-item">
			<div class="legend-color" style="background: #4CAF50; border-radius: 50%"></div>
			<span>Capacity</span>
		</div>
		<div class="legend-item">
			<div class="legend-color" style="background: #2196F3"></div>
			<span>Need</span>
		</div>
	</div>
	<p style="font-size: 0.6875rem; color: var(--text-muted); margin-top: 0.5rem;">
		Colors derived from semantic embeddings
	</p>
</div>
