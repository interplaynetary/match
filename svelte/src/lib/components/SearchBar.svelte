<script lang="ts">
	export interface SearchResult {
		id: string;
		score: number;
		type: 'capacity' | 'need';
	}

	export type TypeFilter = 'all' | 'capacity' | 'need';

	let {
		threshold,
		onResults,
		onClear
	}: {
		threshold: number;
		onResults: (results: SearchResult[]) => void;
		onClear: () => void;
	} = $props();

	let query = $state('');
	let isSearching = $state(false);
	let typeFilter = $state<TypeFilter>('all');
	let rawResults = $state<SearchResult[]>([]);
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	function applyFilter(results: SearchResult[], filter: TypeFilter) {
		const filtered = filter === 'all' ? results : results.filter((r) => r.type === filter);
		onResults(filtered);
	}

	async function doSearch(searchQuery: string) {
		if (!searchQuery.trim()) {
			rawResults = [];
			onClear();
			return;
		}

		isSearching = true;
		try {
			const res = await fetch('/api/search', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ query: searchQuery, threshold })
			});
			const data = await res.json();
			if (!res.ok) {
				console.error('Search failed:', data.error || res.statusText);
				return;
			}
			if (data.results) {
				rawResults = data.results;
				applyFilter(data.results, typeFilter);
			}
		} catch (err) {
			console.error('Search failed:', err);
		} finally {
			isSearching = false;
		}
	}

	// Re-apply filter when typeFilter changes
	$effect(() => {
		if (rawResults.length > 0) {
			applyFilter(rawResults, typeFilter);
		}
	});

	function handleChange(value: string) {
		query = value;

		// Clear previous debounce
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}

		if (!value.trim()) {
			onClear();
			return;
		}

		// Debounce search by 300ms
		debounceTimer = setTimeout(() => {
			doSearch(value);
		}, 300);
	}

	function handleClear() {
		query = '';
		rawResults = [];
		onClear();
	}

	// Re-run search when threshold changes (if there's an active query)
	$effect(() => {
		// Read threshold to track it
		const _ = threshold;
		if (query.trim()) {
			doSearch(query);
		}
	});

	// Cleanup on unmount
	$effect(() => {
		return () => {
			if (debounceTimer) {
				clearTimeout(debounceTimer);
			}
		};
	});
</script>

<div class="search-bar">
	<div class="search-input-wrapper">
		<input
			type="text"
			value={query}
			oninput={(e) => handleChange(e.currentTarget.value)}
			placeholder="Search by meaning..."
			class="search-input"
		/>
		{#if query}
			<button class="search-clear-btn" onclick={handleClear}>x</button>
		{/if}
		{#if isSearching}
			<span class="search-loading">...</span>
		{/if}
	</div>
	{#if query}
		<div class="search-filters">
			{#each ['all', 'capacity', 'need'] as filter}
				<button
					class="search-filter-btn"
					class:active={typeFilter === filter}
					onclick={() => (typeFilter = filter as TypeFilter)}
				>
					{filter === 'all' ? 'All' : filter === 'capacity' ? 'Offers' : 'Needs'}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.search-bar {
		position: absolute;
		top: 20px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 100;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.search-input-wrapper {
		position: relative;
	}

	.search-input {
		width: 280px;
		padding: 10px 36px 10px 14px;
		background: rgba(15, 52, 96, 0.9);
		border: 1px solid #333;
		border-radius: 20px;
		color: #eee;
		font-size: 14px;
		outline: none;
		backdrop-filter: blur(8px);
	}

	.search-clear-btn {
		position: absolute;
		right: 10px;
		top: 50%;
		transform: translateY(-50%);
		background: none;
		border: none;
		color: #888;
		font-size: 16px;
		cursor: pointer;
		padding: 4px;
		line-height: 1;
	}

	.search-loading {
		position: absolute;
		right: 32px;
		top: 50%;
		transform: translateY(-50%);
		color: #888;
		font-size: 12px;
	}

	.search-filters {
		display: flex;
		gap: 4px;
	}

	.search-filter-btn {
		padding: 6px 10px;
		background: rgba(15, 52, 96, 0.7);
		border: 1px solid #444;
		border-radius: 12px;
		color: #aaa;
		font-size: 11px;
		cursor: pointer;
		text-transform: capitalize;
	}

	.search-filter-btn.active {
		background: rgba(100, 150, 200, 0.8);
		color: #fff;
	}
</style>
