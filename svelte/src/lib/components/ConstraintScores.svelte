<script lang="ts">
	import type { Match, ConstraintDetail } from '$lib/frontend/types';

	let {
		breakdown,
		compact = false,
		showSide
	}: {
		breakdown: Match['breakdown'];
		compact?: boolean;
		showSide?: 'need' | 'capacity';
	} = $props();

	function getScoreColor(score: number): string {
		if (score >= 0.8) return '#4CAF50';
		if (score >= 0.5) return '#FFC107';
		return '#f44336';
	}

	function getDescription(
		detail: ConstraintDetail | undefined,
		side?: 'need' | 'capacity'
	): string | undefined {
		if (!detail) return undefined;
		if (side === 'need' && detail.needDesc) return detail.needDesc;
		if (side === 'capacity' && detail.capacityDesc) return detail.capacityDesc;
		return detail.reason;
	}

	const constraints = $derived.by(() => {
		const result: Array<{ key: string; score: number; description?: string }> = [];

		if (breakdown.timeDetail) {
			result.push({
				key: 'time',
				score: breakdown.timeDetail.score,
				description: getDescription(breakdown.timeDetail, showSide)
			});
		} else if (breakdown.time !== undefined) {
			result.push({ key: 'time', score: breakdown.time });
		}

		if (breakdown.spaceDetail) {
			result.push({
				key: 'space',
				score: breakdown.spaceDetail.score,
				description: getDescription(breakdown.spaceDetail, showSide)
			});
		} else if (breakdown.space !== undefined) {
			result.push({ key: 'space', score: breakdown.space });
		}

		if (breakdown.quantityDetail) {
			result.push({
				key: 'quantity',
				score: breakdown.quantityDetail.score,
				description: getDescription(breakdown.quantityDetail, showSide)
			});
		} else if (breakdown.quantity !== undefined) {
			result.push({ key: 'quantity', score: breakdown.quantity });
		}

		return result;
	});
</script>

{#snippet constraintIcon(key: string)}
	{#if key === 'time'}
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
		>
			<circle cx="12" cy="12" r="10" />
			<polyline points="12,6 12,12 16,14" />
		</svg>
	{:else if key === 'space'}
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
		>
			<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
			<circle cx="12" cy="10" r="3" />
		</svg>
	{:else if key === 'quantity'}
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
		>
			<rect x="3" y="3" width="7" height="7" />
			<rect x="14" y="3" width="7" height="7" />
			<rect x="3" y="14" width="7" height="7" />
			<rect x="14" y="14" width="7" height="7" />
		</svg>
	{/if}
{/snippet}

{#if constraints.length > 0}
	{#if compact}
		<div class="constraint-scores-compact">
			{#each constraints as { key, score, description } (key)}
				<div class="constraint-pill-row">
					<span
						class="constraint-pill"
						style="color: {getScoreColor(score)}; display: flex; align-items: center; gap: 4px;"
					>
						{@render constraintIcon(key)}
						<span>{description || key}</span>
					</span>
				</div>
			{/each}
		</div>
	{:else}
		<div class="constraint-scores" style="margin-top: 8px; font-size: 0.85em;">
			{#each constraints as { key, score, description } (key)}
				<div
					style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px; color: {getScoreColor(score)};"
				>
					{@render constraintIcon(key)}
					<span>{description || key}</span>
				</div>
			{/each}
		</div>
	{/if}
{/if}
