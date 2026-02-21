/**
 * Server-side mutable state for match data.
 * Loads data on startup, rebuilds when entries are added.
 */

import { generateMatchData, type MatchData } from '$lib/core/ai/match-data';
import { buildTaxonomyTree, type TaxonomyNode } from '$lib/core/ai/taxonomy-tree';
import type { EmbeddingsStore } from '$lib/core/ai/example-converter';
import type { PCATransform } from '$lib/core/ai/semantic-colors';
import initialExamplesData from '$lib/data/enriched-full.json';
import initialEmbeddingsData from '$lib/data/embeddings.json';

type EnrichedData = { results: any[]; timestamp?: string };

let enrichedData: EnrichedData = initialExamplesData as unknown as EnrichedData;
let embeddings: EmbeddingsStore = initialEmbeddingsData as unknown as EmbeddingsStore;
let matchData: MatchData;
let taxonomyTree: TaxonomyNode;

function rebuild() {
	const examples = enrichedData.results ?? enrichedData;
	matchData = generateMatchData({ examples, embeddings });

	const examplesWithEmbeddings = (examples as any[]).map((ex) => ({
		...ex,
		embedding: embeddings[String(ex.id)]
	}));
	taxonomyTree = buildTaxonomyTree(examplesWithEmbeddings);
}

// Initial build
rebuild();

export function getMatchData(): MatchData {
	return matchData;
}

export function getTaxonomyData(): { tree: TaxonomyNode; pcaTransform: PCATransform } {
	return { tree: taxonomyTree, pcaTransform: matchData.pcaTransform };
}

export function getEnrichedData(): EnrichedData {
	return enrichedData;
}

export function getEmbeddings(): EmbeddingsStore {
	return embeddings;
}

export function addEntry(
	entry: any,
	embedding: number[],
	categoryEmbeddings: Record<string, number[]>
) {
	const examples = enrichedData.results ?? enrichedData;
	examples.push(entry);
	embeddings[entry.id] = embedding;
	Object.assign(embeddings, categoryEmbeddings);
	rebuild();
}
