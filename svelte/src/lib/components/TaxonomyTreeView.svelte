<script lang="ts">
	import * as d3 from 'd3';
	import { SvelteSet } from 'svelte/reactivity';
	import { getNodesAtDepth, type TaxonomyNode, type CohesionScore } from '$lib/core/taxonomy-tree';
	import { embeddingToColor, type PCATransform } from '$lib/core/semantic-colors';

	let {
		tree,
		pcaTransform
	}: {
		tree: TaxonomyNode;
		pcaTransform: PCATransform;
	} = $props();

	const WIDTH = 900;
	const HEIGHT = 600;
	const INITIAL_DEPTH = 3;

	const DEPTH_COLORS = ['#1a1a2e', '#16213e', '#0f3460', '#1a4a7a'];

	type ColorMode = 'semantic' | 'cohesion';

	type TreemapRect = {
		id: string;
		name: string;
		x0: number;
		y0: number;
		x1: number;
		y1: number;
		depth: number;
		hasChildren: boolean;
		expressionCount: number;
		parent: string | null;
		embedding?: number[];
		cohesion?: CohesionScore;
	};

	let colorMode = $state<ColorMode>('semantic');

	function cohesionToColor(score: number): string {
		const s = Math.max(0, Math.min(1, score));
		const hue = s * 120; // 0 = red, 120 = green
		const saturation = 60;
		const lightness = 25 + s * 15;
		return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
	}

	const initialExpanded = getNodesAtDepth(tree, INITIAL_DEPTH);
	let expandedIds = new SvelteSet(initialExpanded);
	let hoveredId = $state<string | null>(null);

	const rects = $derived.by((): TreemapRect[] => {
		function filterTree(node: TaxonomyNode): TaxonomyNode {
			const isExpanded = expandedIds.has(node.id);
			return {
				...node,
				children: isExpanded ? node.children.map(filterTree) : []
			};
		}

		const filteredRoot = filterTree(tree);

		const hierarchy = d3
			.hierarchy(filteredRoot)
			.sum((d) => (d.children.length === 0 ? Math.max(d.expressionCount, 1) : 0))
			.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

		const treemap = d3
			.treemap<TaxonomyNode>()
			.size([WIDTH, HEIGHT])
			.paddingOuter(3)
			.paddingTop(19)
			.paddingInner(2)
			.round(true);

		const treemapRoot = treemap(hierarchy);

		return treemapRoot.descendants().map((node) => ({
			id: node.data.id,
			name: node.data.name,
			x0: node.x0,
			y0: node.y0,
			x1: node.x1,
			y1: node.y1,
			depth: node.depth,
			hasChildren: node.data.children.length > 0,
			expressionCount: node.data.expressionCount,
			parent: node.parent?.data.id ?? null,
			embedding: node.data.embedding,
			cohesion: node.data.cohesion
		}));
	});

	function getColor(rect: TreemapRect): string {
		if (colorMode === 'cohesion') {
			if (rect.cohesion) {
				return cohesionToColor(rect.cohesion.combined);
			}
			return '#2a2a3e';
		}
		// Semantic mode: use embedding color
		if (rect.embedding && pcaTransform) {
			return embeddingToColor(rect.embedding, pcaTransform);
		}
		return DEPTH_COLORS[Math.min(rect.depth, DEPTH_COLORS.length - 1)];
	}

	function toggleNode(nodeId: string) {
		if (expandedIds.has(nodeId)) {
			expandedIds.delete(nodeId);
			for (const id of [...expandedIds]) {
				if (id.startsWith(nodeId + '/')) {
					expandedIds.delete(id);
				}
			}
		} else {
			expandedIds.add(nodeId);
		}
	}

	const breadcrumb = $derived(hoveredId ? hoveredId.split('/').slice(1).join(' > ') : null);

	const hoveredRect = $derived(hoveredId ? rects.find((r) => r.id === hoveredId) : null);

	const cohesionInfo = $derived.by(() => {
		if (!hoveredRect?.cohesion) return null;
		const c = hoveredRect.cohesion;
		return `P-C: ${(c.parentChildSim * 100).toFixed(0)}% | Sib: ${(c.siblingCohesion * 100).toFixed(0)}%`;
	});
</script>

<div class="treemap-container">
	<div class="treemap-controls">
		<button
			class="mode-toggle"
			class:active={colorMode === 'semantic'}
			onclick={() => (colorMode = 'semantic')}
		>
			Semantic
		</button>
		<button
			class="mode-toggle"
			class:active={colorMode === 'cohesion'}
			onclick={() => (colorMode = 'cohesion')}
		>
			Cohesion
		</button>
	</div>
	<div class="treemap-breadcrumb">
		{breadcrumb || 'Hover over a category to see its path'}
		{#if cohesionInfo}
			<span class="cohesion-info"> | {cohesionInfo}</span>
		{/if}
	</div>
	<svg
		class="taxonomy-treemap"
		viewBox="0 0 {WIDTH} {HEIGHT}"
		preserveAspectRatio="xMidYMid meet"
	>
		{#each rects as rect (rect.id)}
			{@const width = rect.x1 - rect.x0}
			{@const height = rect.y1 - rect.y0}
			{@const isExpanded = expandedIds.has(rect.id)}
			{@const isHovered = hoveredId === rect.id}
			{@const showLabel = width > 30 && height > 14}
			{#if rect.depth > 0}
				<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
				<g
					class="treemap-cell {rect.hasChildren ? 'has-children' : 'leaf'} {isHovered
						? 'hovered'
						: ''}"
					onclick={(e) => {
						e.stopPropagation();
						if (rect.hasChildren) toggleNode(rect.id);
					}}
					onmouseenter={() => (hoveredId = rect.id)}
					onmouseleave={() => (hoveredId = null)}
					style="cursor: {rect.hasChildren ? 'pointer' : 'default'}"
				>
					<rect
						x={rect.x0}
						y={rect.y0}
						{width}
						{height}
						fill={getColor(rect)}
						stroke={isHovered ? '#fff' : '#222'}
						stroke-width={isHovered ? 2 : 1}
					/>
					{#if showLabel}
						<text x={rect.x0 + 4} y={rect.y0 + 13} class="treemap-label">
							{rect.name}{rect.hasChildren && !isExpanded ? ' +' : ''}
						</text>
					{/if}
				</g>
			{/if}
		{/each}
	</svg>
</div>
