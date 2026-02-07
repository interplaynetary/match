<script lang="ts">
	import type { NodeItem } from '$lib/frontend/types';

	let {
		item,
		isCapacity,
		color
	}: {
		item: NodeItem;
		isCapacity: boolean;
		color: string;
	} = $props();
</script>

<div>
	<strong style="color: {color}">
		{isCapacity ? 'Capacity' : 'Need'} #{item.id}
	</strong>
	<br />
	{item.label}
</div>
