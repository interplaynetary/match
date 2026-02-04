import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { search } from '$lib/core/search';
import { OpenAIEmbeddingProvider } from '$lib/core/embeddings';
import { getEnrichedData, getEmbeddings } from '$lib/server/state';

let embeddingProvider: OpenAIEmbeddingProvider | null = null;

function getEmbeddingProvider() {
	if (!embeddingProvider) embeddingProvider = new OpenAIEmbeddingProvider();
	return embeddingProvider;
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { query, threshold = 0.3 } = body as { query: string; threshold?: number };

		if (!query || typeof query !== 'string' || query.trim().length === 0) {
			return json({ results: [] });
		}

		const provider = getEmbeddingProvider();
		const queryEmbedding = await provider.embed(query.trim());

		const enrichedData = getEnrichedData();
		const embeddings = getEmbeddings();
		const items = enrichedData.results ?? enrichedData;

		const results = search({
			query: query.trim(),
			queryEmbedding,
			threshold,
			items,
			embeddings
		});

		return json({ results });
	} catch (err) {
		console.error('Search error:', err);
		return json(
			{ error: err instanceof Error ? err.message : 'Search failed' },
			{ status: 500 }
		);
	}
};
