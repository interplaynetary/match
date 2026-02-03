<script lang="ts">
	let {
		threshold,
		onThresholdChange,
		label = 'Threshold'
	}: {
		threshold: number;
		onThresholdChange: (value: number) => void;
		label?: string;
	} = $props();
</script>

<div class="slider-container">
	<label>
		<span>{label}</span>
		<span class="slider-value">{Math.round(threshold * 100)}%</span>
	</label>
	<input
		type="range"
		min="0"
		max="100"
		value={threshold * 100}
		oninput={(e) => onThresholdChange(parseInt(e.currentTarget.value) / 100)}
	/>
</div>
