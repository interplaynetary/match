<script lang="ts">
	import type { NodeItem } from '$lib/frontend/types';
	import { getPosition } from '$lib/frontend/utils';

	let {
		item,
		index,
		total,
		radius,
		isCapacity,
		color,
		isConnected,
		lockedNodeId,
		onSelect,
		onHover,
		onLeave,
		onShowTooltip,
		onHideTooltip,
		onShowConnectedTooltips,
		onHideConnectedTooltips
	}: {
		item: NodeItem;
		index: number;
		total: number;
		radius: number;
		isCapacity: boolean;
		color: string;
		isConnected: boolean;
		lockedNodeId: string | null;
		onSelect: (id: string) => void;
		onHover: (id: string, isCapacity: boolean) => void;
		onLeave: () => void;
		onShowTooltip: (e: MouseEvent, data: { type: string; data: any }) => void;
		onHideTooltip: () => void;
		onShowConnectedTooltips: (nodeId: string) => void;
		onHideConnectedTooltips: () => void;
	} = $props();

	const pos = $derived(getPosition(index, total, radius));
	const opacity = $derived(lockedNodeId && !isConnected ? 0.3 : 1);

	function handleClick(e: MouseEvent) {
		e.stopPropagation();
		onSelect(item.id);
	}

	function handleMouseEnter(e: MouseEvent) {
		if (!lockedNodeId) {
			onHover(item.id, isCapacity);
		}
		onShowTooltip(e, { type: 'node', data: { item, isCapacity, color } });
		onShowConnectedTooltips(item.id);
	}

	function handleMouseLeave() {
		if (!lockedNodeId) onLeave();
		onHideTooltip();
		onHideConnectedTooltips();
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<g
	class="node {isCapacity ? 'capacity' : 'need'}"
	data-id={item.id}
	style="opacity: {opacity}"
	onclick={handleClick}
	onmouseenter={handleMouseEnter}
	onmouseleave={handleMouseLeave}
>
	{#if isCapacity}
		<circle cx={pos.x} cy={pos.y} r={8} fill={color} stroke="#fff" stroke-width={1} />
	{:else}
		<rect
			x={pos.x - 6}
			y={pos.y - 6}
			width={12}
			height={12}
			fill={color}
			stroke="#fff"
			stroke-width={1}
		/>
	{/if}
</g>
