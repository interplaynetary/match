<script lang="ts">
	import '$lib/frontend/styles.css';
	import type { MatchData, MatchWithOther, ConnectedTooltip } from '$lib/frontend/types';
	import { OUTER_RADIUS, NEED_RADIUS } from '$lib/frontend/constants';
	import { getNodeColor, getPosition } from '$lib/frontend/utils';
	import type { TaxonomyNode } from '$lib/core/taxonomy-tree';
	import Chord from '$lib/components/Chord.svelte';
	import Node from '$lib/components/Node.svelte';
	import OverviewSidebar from '$lib/components/OverviewSidebar.svelte';
	import DetailSidebar from '$lib/components/DetailSidebar.svelte';
	import TaxonomyTreeView from '$lib/components/TaxonomyTreeView.svelte';
	import ChordTooltipContent from '$lib/components/ChordTooltipContent.svelte';
	import NodeTooltipContent from '$lib/components/NodeTooltipContent.svelte';

	type ViewMode = 'chord' | 'taxonomy';

	let { data } = $props();
	const matchData = $derived(data.matchData as unknown as MatchData);
	const taxonomyTree = $derived(data.taxonomyTree as TaxonomyNode);

	// UI state
	let viewMode = $state<ViewMode>('chord');
	let threshold = $state(0.75);
	let lockedNodeId = $state<string | null>(null);
	let hoveredNode = $state<{ id: string; isCapacity: boolean } | null>(null);
	let svgEl = $state<SVGSVGElement>();

	// Tooltip state
	let tooltipContent = $state<{ type: string; data: any } | null>(null);
	let tooltipPos = $state({ x: 0, y: 0 });
	let tooltipEl = $state<HTMLDivElement>();

	// Connected tooltips state
	let connectedTooltipData = $state<ConnectedTooltip[]>([]);
	let connectedTooltipsEl = $state<HTMLDivElement>();

	// Speech state
	let isSpeaking = $state(false);

	// Connection map for hover labels
	const connections = $derived.by(() => {
		const map = new Map<string, string[]>();
		for (const match of matchData.matches) {
			if (!map.has(match.capacityId)) map.set(match.capacityId, []);
			if (!map.has(match.needId)) map.set(match.needId, []);
			map.get(match.capacityId)!.push(match.needId);
			map.get(match.needId)!.push(match.capacityId);
		}
		return map;
	});

	// Filtered matches
	const filteredMatches = $derived(
		matchData.matches.filter((m) => (m.breakdown.similarity ?? 1) >= threshold)
	);

	// Active node state
	const activeNodeId = $derived(lockedNodeId ?? hoveredNode?.id ?? null);
	const activeIsCapacity = $derived(
		lockedNodeId
			? matchData.capacities.some((c) => c.id === lockedNodeId)
			: hoveredNode?.isCapacity
	);

	// Get matches for a specific node
	function getNodeMatches(nodeId: string, isCapacity: boolean): MatchWithOther[] {
		if (isCapacity) {
			return filteredMatches
				.filter((m) => m.capacityId === nodeId)
				.map((m) => ({
					...m,
					other: matchData.needs.find((n) => n.id === m.needId),
					otherType: 'Need' as const
				}));
		}
		return filteredMatches
			.filter((m) => m.needId === nodeId)
			.map((m) => ({
				...m,
				other: matchData.capacities.find((c) => c.id === m.capacityId),
				otherType: 'Capacity' as const
			}));
	}

	// Connected node IDs for highlighting
	const connectedIds = $derived.by(() => {
		const ids = new Set<string>();
		if (activeNodeId) {
			ids.add(activeNodeId);
			const matches = getNodeMatches(activeNodeId, activeIsCapacity ?? false);
			for (const m of matches) {
				if (m.other) ids.add(m.other.id);
			}
		}
		return ids;
	});

	// Stats
	const needsWithMatches = $derived(new Set(filteredMatches.map((m) => m.needId)).size);
	const capacitiesWithMatches = $derived(
		new Set(filteredMatches.map((m) => m.capacityId)).size
	);

	const activeItem = $derived(
		activeNodeId
			? activeIsCapacity
				? matchData.capacities.find((c) => c.id === activeNodeId)
				: matchData.needs.find((n) => n.id === activeNodeId)
			: null
	);

	const activeMatches = $derived(
		activeNodeId
			? getNodeMatches(activeNodeId, activeIsCapacity ?? false).sort(
					(a, b) => b.score - a.score
				)
			: []
	);

	// Speech text
	const speechText = $derived.by(() => {
		if (activeItem && activeMatches.length > 0) {
			const type = activeIsCapacity ? 'Capacity' : 'Need';
			const topMatches = activeMatches
				.slice(0, 3)
				.map((m) => m.other?.label ?? m.other?.id)
				.filter(Boolean)
				.join(', ');
			return `${type}: ${activeItem.label}. Top matches: ${topMatches}.`;
		}
		return `${matchData.capacities.length} capacities and ${matchData.needs.length} needs. ${filteredMatches.length} matches above ${Math.round(threshold * 100)}% threshold. ${needsWithMatches} needs and ${capacitiesWithMatches} capacities connected.`;
	});

	// Node interaction handlers
	function handleNodeSelect(id: string) {
		lockedNodeId = lockedNodeId === id ? null : id;
	}

	function handleNodeHover(id: string, isCapacity: boolean) {
		hoveredNode = { id, isCapacity };
	}

	function handleNodeLeave() {
		hoveredNode = null;
	}

	function handleBackToOverview() {
		lockedNodeId = null;
		hoveredNode = null;
	}

	function handleSvgClick(e: MouseEvent) {
		if (e.target === svgEl) {
			lockedNodeId = null;
		}
	}

	// Tooltip handlers
	function showTooltip(e: MouseEvent, content: { type: string; data: any }) {
		tooltipContent = content;
		tooltipPos = { x: e.clientX + 10, y: e.clientY + 10 };
	}

	function hideTooltip() {
		tooltipContent = null;
	}

	// Connected tooltips
	function showConnectedTooltips(nodeId: string) {
		const connectedNodeIds = connections.get(nodeId) || [];
		const newTooltips: ConnectedTooltip[] = [];

		for (const id of connectedNodeIds) {
			const chord = document.querySelector(
				`.chord[data-cap="${nodeId}"][data-need="${id}"], .chord[data-cap="${id}"][data-need="${nodeId}"]`
			) as HTMLElement | null;
			if (!chord || chord.style.display === 'none') continue;

			const cap = matchData.capacities.find((c) => c.id === id);
			const need = matchData.needs.find((n) => n.id === id);
			const item = cap || need;
			if (!item) continue;

			const isCapacity = !!cap;
			const color = getNodeColor(item.embedding, matchData.pcaTransform, isCapacity);

			const nodeEl = document.querySelector(`.node[data-id="${id}"]`);
			if (!nodeEl) continue;

			const rect = nodeEl.getBoundingClientRect();
			const label = item.label || item.expressions?.join(', ');

			newTooltips.push({
				id,
				isCapacity,
				label: label || '',
				color,
				x: rect.left + rect.width / 2,
				y: rect.top
			});
		}

		connectedTooltipData = newTooltips;
	}

	function hideConnectedTooltips() {
		connectedTooltipData = [];
	}

	// Tooltip overlap resolution
	$effect(() => {
		if (connectedTooltipData.length === 0 || !connectedTooltipsEl || !tooltipEl) return;

		const tipEls = Array.from(connectedTooltipsEl.children) as HTMLElement[];
		if (tipEls.length === 0) return;

		const placedRects: Array<{
			el: HTMLElement;
			x: number;
			y: number;
			width: number;
			height: number;
		}> = [];

		tipEls.forEach((el, i) => {
			const tip = connectedTooltipData[i];
			if (!tip) return;
			const rect = el.getBoundingClientRect();
			placedRects.push({
				el,
				x: tip.x - rect.width / 2,
				y: tip.y - rect.height - 10,
				width: rect.width,
				height: rect.height
			});
		});

		const mainTipRect = tooltipEl.getBoundingClientRect();
		const mainTip = {
			x: mainTipRect.left,
			y: mainTipRect.top,
			width: mainTipRect.width,
			height: mainTipRect.height
		};

		const gap = 10;
		for (let iter = 0; iter < 100; iter++) {
			let hasOverlap = false;

			for (const rect of placedRects) {
				const overlapX =
					Math.min(rect.x + rect.width, mainTip.x + mainTip.width) -
					Math.max(rect.x, mainTip.x);
				const overlapY =
					Math.min(rect.y + rect.height, mainTip.y + mainTip.height) -
					Math.max(rect.y, mainTip.y);
				if (overlapX > -gap && overlapY > -gap) {
					const sepX = overlapX + gap;
					const sepY = overlapY + gap;
					if (sepX > 0 && sepY > 0) {
						hasOverlap = true;
						const rectCx = rect.x + rect.width / 2;
						const rectCy = rect.y + rect.height / 2;
						const mainCx = mainTip.x + mainTip.width / 2;
						const mainCy = mainTip.y + mainTip.height / 2;
						if (sepX < sepY) {
							const shift = sepX + 1;
							rect.x += rectCx <= mainCx ? -shift : shift;
						} else {
							const shift = sepY + 1;
							rect.y += rectCy <= mainCy ? -shift : shift;
						}
					}
				}
			}

			for (let i = 0; i < placedRects.length; i++) {
				for (let j = i + 1; j < placedRects.length; j++) {
					const a = placedRects[i]!;
					const b = placedRects[j]!;
					const overlapX =
						Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
					const overlapY =
						Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
					if (overlapX > -gap && overlapY > -gap) {
						const sepX = overlapX + gap;
						const sepY = overlapY + gap;
						if (sepX > 0 && sepY > 0) {
							hasOverlap = true;
							if (sepX < sepY) {
								const shift = sepX / 2 + 0.5;
								if (a.x + a.width / 2 <= b.x + b.width / 2) {
									a.x -= shift;
									b.x += shift;
								} else {
									a.x += shift;
									b.x -= shift;
								}
							} else {
								const shift = sepY / 2 + 0.5;
								if (a.y + a.height / 2 <= b.y + b.height / 2) {
									a.y -= shift;
									b.y += shift;
								} else {
									a.y += shift;
									b.y -= shift;
								}
							}
						}
					}
				}
			}
			if (!hasOverlap) break;
		}

		for (const rect of placedRects) {
			rect.el.style.left = rect.x + 'px';
			rect.el.style.top = rect.y + 'px';
		}
	});

	// Speech handlers
	function handleSpeak() {
		window.speechSynthesis.cancel();
		const utterance = new SpeechSynthesisUtterance(speechText);
		utterance.lang = 'en-US';
		utterance.rate = 1;
		utterance.pitch = 1;
		utterance.onend = () => (isSpeaking = false);
		utterance.onerror = () => (isSpeaking = false);
		window.speechSynthesis.speak(utterance);
		isSpeaking = true;
	}

	function handleStopSpeech() {
		window.speechSynthesis.cancel();
		isSpeaking = false;
	}
</script>

<div
	id="tooltip"
	bind:this={tooltipEl}
	style="opacity: {tooltipContent ? 1 : 0}; left: {tooltipPos.x}px; top: {tooltipPos.y}px;"
>
	{#if tooltipContent?.type === 'chord'}
		<ChordTooltipContent
			match={tooltipContent.data.match}
			needText={tooltipContent.data.needText}
			capacityText={tooltipContent.data.capacityText}
		/>
	{:else if tooltipContent?.type === 'node'}
		<NodeTooltipContent
			item={tooltipContent.data.item}
			isCapacity={tooltipContent.data.isCapacity}
			color={tooltipContent.data.color}
		/>
	{/if}
</div>

<div id="connected-tooltips" bind:this={connectedTooltipsEl}>
	{#each connectedTooltipData as tip (tip.id)}
		<div>
			<strong style="color: {tip.color}">
				{tip.isCapacity ? 'Capacity' : 'Need'} #{tip.id}
			</strong>
			<br />
			{tip.label}
		</div>
	{/each}
</div>

<div class="container">
	<div class="viz">
		{#if viewMode === 'taxonomy'}
			<TaxonomyTreeView tree={taxonomyTree} pcaTransform={matchData.pcaTransform} />
		{:else}
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<svg bind:this={svgEl} id="chart" viewBox="-400 -400 800 800" onclick={handleSvgClick}>
				<g id="chords">
					{#each matchData.matches as match (`${match.capacityId}-${match.needId}`)}
						{@const capIndex = matchData.capacities.findIndex(
							(c) => c.id === match.capacityId
						)}
						{@const needIndex = matchData.needs.findIndex(
							(n) => n.id === match.needId
						)}
						{@const cap = matchData.capacities[capIndex]}
						{@const need = matchData.needs[needIndex]}
						{#if capIndex !== -1 && needIndex !== -1 && cap && need}
							<Chord
								{match}
								capacity={cap}
								{need}
								capPos={getPosition(
									capIndex,
									matchData.capacities.length,
									OUTER_RADIUS
								)}
								needPos={getPosition(
									needIndex,
									matchData.needs.length,
									NEED_RADIUS
								)}
								color={getNodeColor(cap.embedding, matchData.pcaTransform, true)}
								{threshold}
								{lockedNodeId}
								{activeNodeId}
								{activeIsCapacity}
								onShowTooltip={showTooltip}
								onHideTooltip={hideTooltip}
							/>
						{/if}
					{/each}
				</g>

				{#each matchData.capacities as cap, i (cap.id)}
					<Node
						item={cap}
						index={i}
						total={matchData.capacities.length}
						radius={OUTER_RADIUS}
						isCapacity={true}
						color={getNodeColor(cap.embedding, matchData.pcaTransform, true)}
						isConnected={connectedIds.has(cap.id)}
						{lockedNodeId}
						onSelect={handleNodeSelect}
						onHover={handleNodeHover}
						onLeave={handleNodeLeave}
						onShowTooltip={showTooltip}
						onHideTooltip={hideTooltip}
						onShowConnectedTooltips={showConnectedTooltips}
						onHideConnectedTooltips={hideConnectedTooltips}
					/>
				{/each}

				{#each matchData.needs as need, i (need.id)}
					<Node
						item={need}
						index={i}
						total={matchData.needs.length}
						radius={NEED_RADIUS}
						isCapacity={false}
						color={getNodeColor(need.embedding, matchData.pcaTransform, false)}
						isConnected={connectedIds.has(need.id)}
						{lockedNodeId}
						onSelect={handleNodeSelect}
						onHover={handleNodeHover}
						onLeave={handleNodeLeave}
						onShowTooltip={showTooltip}
						onHideTooltip={hideTooltip}
						onShowConnectedTooltips={showConnectedTooltips}
						onHideConnectedTooltips={hideConnectedTooltips}
					/>
				{/each}
			</svg>
		{/if}
	</div>

	<div class="sidebar">
		<div class="speech-controls">
			<button
				class="speech-btn {isSpeaking ? '' : 'active'}"
				onclick={handleSpeak}
				title="Read aloud"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="currentColor"
				>
					<path d="M8 5v14l11-7z" />
				</svg>
			</button>
			<button
				class="speech-btn {isSpeaking ? 'active' : ''}"
				onclick={handleStopSpeech}
				title="Stop"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="currentColor"
				>
					<path d="M6 6h12v12H6z" />
				</svg>
			</button>
		</div>

		<div class="view-toggle">
			<button class={viewMode === 'chord' ? 'active' : ''} onclick={() => (viewMode = 'chord')}>
				Matches
			</button>
			<button
				class={viewMode === 'taxonomy' ? 'active' : ''}
				onclick={() => (viewMode = 'taxonomy')}
			>
				Taxonomy
			</button>
		</div>

		{#if !activeNodeId}
			<OverviewSidebar
				data={matchData}
				{filteredMatches}
				{needsWithMatches}
				{capacitiesWithMatches}
				{threshold}
				onThresholdChange={(v) => (threshold = v)}
			/>
		{:else if activeItem}
			<DetailSidebar
				{activeItem}
				activeIsCapacity={activeIsCapacity ?? false}
				{activeMatches}
				transform={matchData.pcaTransform}
				onBack={handleBackToOverview}
			/>
		{/if}
	</div>
</div>
