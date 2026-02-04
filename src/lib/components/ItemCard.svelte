<script lang="ts">
	import type { PCATransform } from '$lib/core/semantic-colors';
	import type { NodeItem } from '$lib/frontend/types';
	import { getNodeColor } from '$lib/frontend/utils';
	import type { Snippet } from 'svelte';

	let {
		item,
		isCapacity,
		transform,
		score,
		children
	}: {
		item: NodeItem;
		isCapacity: boolean;
		transform: PCATransform;
		score?: number;
		children?: Snippet;
	} = $props();

	const color = $derived(getNodeColor(item.embedding, transform, isCapacity));
</script>

<div class="match-item">
	<div class="match-item-header">
		<div style="display: flex; align-items: center; gap: 6px;">
			<div
				class="node-header-icon {isCapacity ? 'capacity' : ''}"
				style="background: {color}; width: 12px; height: 12px;"
			></div>
			<span>{item.label}</span>
		</div>
		{#if score !== undefined}
			<span class="match-item-score">
				{(score * 100).toFixed(0)}%
			</span>
		{/if}
	</div>
	<div style="font-size: 0.8em; color: #888; margin-top: 2px;">
		{isCapacity ? 'Capacity' : 'Need'}
	</div>
	{#if children}
		{@render children()}
	{/if}
</div>
