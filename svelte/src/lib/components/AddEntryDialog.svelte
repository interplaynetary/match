<script lang="ts">
	let {
		onSubmit
	}: {
		onSubmit: (entry: { naturalLanguage: string; type: 'capacity' | 'need' }) => Promise<void>;
	} = $props();

	let isOpen = $state(false);
	let text = $state('');
	let type = $state<'capacity' | 'need'>('need');
	let isSubmitting = $state(false);
	let error = $state<string | null>(null);

	const needPatterns = /\b(i need|looking for|seeking|want|help me)\b/i;
	const capacityPatterns = /\b(i offer|i can|i have|i'm a|i am a|providing|for sale)\b/i;

	function detectType(inputText: string): 'capacity' | 'need' {
		if (capacityPatterns.test(inputText)) return 'capacity';
		if (needPatterns.test(inputText)) return 'need';
		return 'need'; // default
	}

	function handleTextChange(value: string) {
		text = value;
		type = detectType(value);
	}

	async function handleSubmit() {
		if (!text.trim()) return;

		isSubmitting = true;
		error = null;

		try {
			await onSubmit({ naturalLanguage: text.trim(), type });
			text = '';
			type = 'need';
			isOpen = false;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to add entry';
		} finally {
			isSubmitting = false;
		}
	}

	function handleClose() {
		if (!isSubmitting) {
			isOpen = false;
			error = null;
		}
	}
</script>

<!-- Floating + Button -->
<button class="add-entry-fab" onclick={() => (isOpen = true)}>+</button>

<!-- Dialog Overlay -->
{#if isOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="dialog-overlay" onclick={handleClose}>
		<!-- Dialog Box -->
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="dialog-box" onclick={(e) => e.stopPropagation()}>
			<!-- Header -->
			<div class="dialog-header">
				<h2>Add Entry</h2>
				<button class="dialog-close-btn" onclick={handleClose} disabled={isSubmitting}>x</button>
			</div>

			<!-- Text Input -->
			<textarea
				value={text}
				oninput={(e) => handleTextChange(e.currentTarget.value)}
				placeholder="Describe what you need or can offer..."
				disabled={isSubmitting}
				class="dialog-textarea"
			></textarea>

			<!-- Type Toggle -->
			<div class="dialog-type-toggle">
				<button
					class="type-btn"
					class:active={type === 'need'}
					onclick={() => (type = 'need')}
					disabled={isSubmitting}
				>
					Need
				</button>
				<button
					class="type-btn"
					class:active={type === 'capacity'}
					onclick={() => (type = 'capacity')}
					disabled={isSubmitting}
				>
					Capacity
				</button>
			</div>

			<!-- Error Message -->
			{#if error}
				<div class="dialog-error">{error}</div>
			{/if}

			<!-- Submit Button -->
			<button
				class="dialog-submit-btn"
				onclick={handleSubmit}
				disabled={isSubmitting || !text.trim()}
			>
				{isSubmitting ? 'Adding...' : 'Add Entry'}
			</button>
		</div>
	</div>
{/if}

<style>
	.add-entry-fab {
		position: fixed;
		top: 20px;
		left: 20px;
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: #0f3460;
		border: none;
		color: #fff;
		font-size: 28px;
		font-weight: bold;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		transition: background 0.2s;
	}

	.add-entry-fab:hover {
		background: #1a1a2e;
	}

	.dialog-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 2000;
	}

	.dialog-box {
		background: #16213e;
		border: 1px solid #0f3460;
		border-radius: 12px;
		padding: 24px;
		width: 90%;
		max-width: 480px;
	}

	.dialog-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 20px;
	}

	.dialog-header h2 {
		margin: 0;
		font-size: 1.2em;
		color: #eee;
	}

	.dialog-close-btn {
		background: none;
		border: none;
		color: #888;
		font-size: 24px;
		cursor: pointer;
		padding: 4px;
	}

	.dialog-close-btn:disabled {
		cursor: not-allowed;
	}

	.dialog-textarea {
		width: 100%;
		min-height: 100px;
		padding: 12px;
		background: #0f3460;
		border: 1px solid #333;
		border-radius: 8px;
		color: #eee;
		font-size: 14px;
		resize: vertical;
		font-family: inherit;
	}

	.dialog-type-toggle {
		display: flex;
		gap: 8px;
		margin-top: 16px;
	}

	.type-btn {
		flex: 1;
		padding: 10px 16px;
		background: #0f3460;
		border: 1px solid #333;
		border-radius: 6px;
		color: #ccc;
		cursor: pointer;
		transition: background 0.2s;
		font-size: 14px;
	}

	.type-btn.active {
		background: #4caf50;
		border-color: #4caf50;
		color: #fff;
	}

	.type-btn:disabled {
		cursor: not-allowed;
	}

	.dialog-error {
		margin-top: 12px;
		padding: 10px;
		background: rgba(255, 107, 107, 0.2);
		border-radius: 6px;
		color: #ff6b6b;
		font-size: 13px;
	}

	.dialog-submit-btn {
		width: 100%;
		margin-top: 16px;
		padding: 12px 20px;
		background: #4caf50;
		border: none;
		border-radius: 8px;
		color: #fff;
		font-size: 15px;
		font-weight: bold;
		cursor: pointer;
		transition: background 0.2s;
	}

	.dialog-submit-btn:disabled {
		background: #2d5a3d;
		cursor: not-allowed;
	}
</style>
