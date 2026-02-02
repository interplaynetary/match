<script lang="ts">
	import type { Match, NodeItem } from '$lib/frontend/types';
	import { computeChordPath } from '$lib/frontend/utils';

	let {
		match,
		capacity,
		need,
		capPos,
		needPos,
		color,
		threshold,
		lockedNodeId,
		activeNodeId,
		activeIsCapacity,
		onShowTooltip,
		onHideTooltip
	}: {
		match: Match;
		capacity: NodeItem;
		need: NodeItem;
		capPos: { x: number; y: number };
		needPos: { x: number; y: number };
		color: string;
		threshold: number;
		lockedNodeId: string | null;
		activeNodeId: string | null;
		activeIsCapacity: boolean | undefined;
		onShowTooltip: (e: MouseEvent, data: { type: string; data: any }) => void;
		onHideTooltip: () => void;
	} = $props();

	const similarity = $derived(match.breakdown.similarity ?? 1);
	const isVisible = $derived(similarity >= threshold);
	const specificity = $derived((match.breakdown as any).specificity ?? similarity);

	const isHighlighted = $derived(
		!lockedNodeId ||
			(activeIsCapacity
				? match.capacityId === activeNodeId
				: match.needId === activeNodeId)
	);

	const baseOpacity = $derived(specificity * specificity);
	const opacity = $derived(lockedNodeId && !isHighlighted ? 0 : baseOpacity);

	const path = $derived(computeChordPath(capPos.x, capPos.y, needPos.x, needPos.y));
	const strokeWidth = $derived(Math.max(5, match.score * 12));

	function handleMouseEnter(e: MouseEvent) {
		const exprs = match.matchedExpressions;
		const needText = exprs?.needText || need.expressions[0] || 'Need';
		const capText = exprs?.capacityText || capacity.expressions[0] || 'Capacity';
		onShowTooltip(e, {
			type: 'chord',
			data: { match, needText, capacityText: capText }
		});
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if isVisible}
	<path
		d={path}
		fill="none"
		stroke={color}
		stroke-width={strokeWidth}
		opacity={opacity}
		class="chord"
		data-cap={match.capacityId}
		data-need={match.needId}
		onmouseenter={handleMouseEnter}
		onmouseleave={onHideTooltip}
	/>
{:else}
	<path
		d={path}
		fill="none"
		stroke={color}
		stroke-width={strokeWidth}
		opacity={0}
		class="chord"
		data-cap={match.capacityId}
		data-need={match.needId}
		style="display: none"
	/>
{/if}
