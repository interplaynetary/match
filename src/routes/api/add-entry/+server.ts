import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createOpenAIPipe } from '$lib/core/ai/ai-pipe';
import { OpenAIEmbeddingProvider } from '$lib/core/ai/embeddings';
import { enrichSingleItem } from '$lib/core/ai/enrichment-ops';
import { embedSingleItem, embedSingleItemCategories } from '$lib/core/ai/embedding-ops';
import { loadTaxonomy, saveTaxonomy } from '$lib/core/ai/taxonomy-store';
import { getEnrichedData, getEmbeddings, addEntry } from '$lib/server/state';
import type { UserInputType } from '$lib/core/ai/enrichment';

let addEntryLock = false;
const MAX_INPUT_LENGTH = 1000;

let pipe: ReturnType<typeof createOpenAIPipe> | null = null;
let embeddingProvider: OpenAIEmbeddingProvider | null = null;

function getPipe() {
	if (!pipe) pipe = createOpenAIPipe({ model: 'gpt-4o-mini' });
	return pipe;
}

function getEmbeddingProvider() {
	if (!embeddingProvider) embeddingProvider = new OpenAIEmbeddingProvider();
	return embeddingProvider;
}

const needPatterns = [
	/\bi need\b/,
	/\blooking for\b/,
	/\bseeking\b/,
	/\bi want\b/,
	/\bhelp me\b/,
	/\bcan someone\b/,
	/\brequire\b/
];

const capacityPatterns = [
	/\bi offer\b/,
	/\bi can\b/,
	/\bi have\b/,
	/\bi'm a\b/,
	/\bi am a\b/,
	/\bproviding\b/,
	/\bfor sale\b/,
	/\boffering\b/
];

function detectType(text: string): 'capacity' | 'need' {
	const lower = text.toLowerCase();
	const needScore = needPatterns.reduce((s, p) => s + (p.test(lower) ? 1 : 0), 0);
	const capScore = capacityPatterns.reduce((s, p) => s + (p.test(lower) ? 1 : 0), 0);
	return capScore > needScore ? 'capacity' : 'need';
}

export const POST: RequestHandler = async ({ request }) => {
	if (addEntryLock) {
		return json(
			{ error: 'Another entry is being processed. Please try again.' },
			{ status: 429 }
		);
	}
	addEntryLock = true;

	try {
		const body = await request.json();
		const { naturalLanguage, type } = body as {
			naturalLanguage: string;
			type?: 'capacity' | 'need';
		};

		if (!naturalLanguage || typeof naturalLanguage !== 'string') {
			return json({ error: 'naturalLanguage is required' }, { status: 400 });
		}

		const trimmed = naturalLanguage.trim();
		if (trimmed.length === 0) {
			return json({ error: 'Input cannot be empty' }, { status: 400 });
		}
		if (trimmed.length > MAX_INPUT_LENGTH) {
			return json(
				{ error: `Input too long. Maximum ${MAX_INPUT_LENGTH} characters allowed.` },
				{ status: 400 }
			);
		}

		// Check duplicates
		const enrichedData = getEnrichedData();
		const items = enrichedData.results ?? enrichedData;
		const lowerTrimmed = trimmed.toLowerCase();
		const isDuplicate = (items as any[]).some((entry: any) =>
			entry.expressions?.some((e: any) => e.text?.toLowerCase() === lowerTrimmed)
		);
		if (isDuplicate) {
			return json({ error: 'An entry with similar text already exists.' }, { status: 409 });
		}

		const detectedType = type ?? detectType(trimmed);
		const input: UserInputType = { naturalLanguage: trimmed, type: detectedType };

		const taxonomy = await loadTaxonomy();

		const enrichResult = await enrichSingleItem(input, {
			pipe: getPipe(),
			taxonomy
		});

		if (!enrichResult.success) {
			return json({ error: enrichResult.error }, { status: 500 });
		}

		const provider = getEmbeddingProvider();
		const embeddings = getEmbeddings();
		const itemEmbedding = await embedSingleItem(enrichResult.data, provider);
		const categoryEmbeddings = await embedSingleItemCategories(
			enrichResult.data,
			embeddings,
			provider
		);

		if (enrichResult.taxonomyUpdated) {
			await saveTaxonomy(taxonomy);
		}

		addEntry(enrichResult.data, itemEmbedding, categoryEmbeddings);

		return json({
			success: true,
			id: enrichResult.data.id,
			type: detectedType,
			expressions: enrichResult.data.expressions.map((e: any) => e.text)
		});
	} catch (err) {
		console.error('Error adding entry:', err);
		return json(
			{ error: err instanceof Error ? err.message : 'Unknown error' },
			{ status: 500 }
		);
	} finally {
		addEntryLock = false;
	}
};
