import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateMatchData } from '$lib/core/match-data';
import { buildTaxonomyTree } from '$lib/core/taxonomy-tree';
import examples from '$lib/data/enriched-examples.json';
import embeddingsData from '$lib/data/embeddings.json';

export const prerender = true;

export const GET: RequestHandler = async () => {
	const matchData = generateMatchData();
	const embeddings = embeddingsData as Record<string, number[]>;
	const examplesWithEmbeddings = (examples as any[]).map((ex) => ({
		...ex,
		embedding: embeddings[String(ex.id)]
	}));
	const taxonomyTree = buildTaxonomyTree(examplesWithEmbeddings);
	return json({ tree: taxonomyTree, pcaTransform: matchData.pcaTransform });
};
