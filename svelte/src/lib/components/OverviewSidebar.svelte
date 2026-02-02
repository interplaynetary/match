<script lang="ts">
	import type { MatchData, Match } from '$lib/frontend/types';

	let {
		data,
		filteredMatches,
		needsWithMatches,
		capacitiesWithMatches,
		threshold,
		onThresholdChange
	}: {
		data: MatchData;
		filteredMatches: Match[];
		needsWithMatches: number;
		capacitiesWithMatches: number;
		threshold: number;
		onThresholdChange: (value: number) => void;
	} = $props();
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
			<div class="stat-label">Needs Covered</div>
		</div>
	</div>

	<h2>Threshold</h2>
	<div class="slider-container">
		<label>
			<span>Similarity threshold</span>
			<span class="slider-value">{Math.round(threshold * 100)}%</span>
		</label>
		<input
			type="range"
			min="0"
			max="100"
			value={threshold * 100}
			oninput={(e) => onThresholdChange(parseInt(e.currentTarget.value) / 100)}
		/>
		<div
			style="display: flex; justify-content: space-between; font-size: 0.7em; color: #666; margin-top: 4px;"
		>
			<span>0%</span>
			<span>50%</span>
			<span>100%</span>
		</div>
	</div>

	<h2>Legend</h2>
	<div class="legend">
		<div class="legend-item">
			<div class="legend-color" style="background: #4CAF50; border-radius: 50%"></div>
			<span>Capacity (outer ring)</span>
		</div>
		<div class="legend-item">
			<div class="legend-color" style="background: #2196F3; border-radius: 0"></div>
			<span>Need (inner ring)</span>
		</div>
	</div>
	<p style="font-size: 0.75em; color: #666; margin-top: 8px;">
		Node colors derived from semantic embeddings
	</p>

	<h2>Hover for Details</h2>
	<div class="details">
		<p>Hover over nodes or chords to see details</p>
	</div>
</div>
