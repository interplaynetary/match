/**
 * Semantic search functionality using the Matcher.
 */

import { Matcher } from './matcher'
import type { Need, Capacity } from './types'
import type { EmbeddingsStore } from './example-converter'
import type { EnrichedExampleWithId } from './enrichment'

export type SearchResult = {
  id: string
  score: number
  type: 'capacity' | 'need'
}

export type SearchInput = {
  query: string
  queryEmbedding: number[]
  threshold: number
  items: EnrichedExampleWithId[]
  embeddings: EmbeddingsStore
}

/**
 * Search items using the Matcher's semantic matching logic.
 * Creates a pseudo-Need from the query and matches against all items.
 */
export function search({ query, queryEmbedding, threshold, items, embeddings }: SearchInput): SearchResult[] {
  // Add query embedding to store so category matching can find semantic matches
  // between the query and category names (e.g., "bicycle" query vs "bicycles" category)
  const embeddingsWithQuery = { ...embeddings, [query]: queryEmbedding }

  // Create a pseudo-Need from the search query
  const searchNeed: Need = {
    id: 'search-query',
    expressions: [{ text: query, categoryChain: [query] }],
    embedding: queryEmbedding,
  }

  // Use Matcher with embeddings for semantic category matching
  // Lower semantic threshold (0.5) to catch synonyms like bike/bicycle
  const matcher = new Matcher({ similarityThreshold: threshold, embeddings: embeddingsWithQuery, semanticThreshold: 0.5 })

  // Convert items to Capacity format (Matcher.findMatches compares Need vs Capacities)
  const capacities: Capacity[] = items.map((item) => ({
    id: item.id,
    expressions: item.expressions.map((e) => ({
      ...e,
      disjointWith: e.disjointWith ?? undefined,
    })),
    embedding: embeddings[item.id],
  }))

  // Use Matcher.findMatches - same code path as regular matching
  const matches = matcher.findMatches(searchNeed, capacities)

  // Build type lookup
  const typeById = new Map<string, 'capacity' | 'need'>()
  for (const item of items) {
    typeById.set(item.id, item.type)
  }

  // Convert to search results
  return matches.map((m) => ({
    id: m.capacityId,
    score: m.feasibilityScore,
    type: typeById.get(m.capacityId) ?? 'capacity',
  }))
}
