import { describe, expect, test } from 'bun:test'
import { search } from './search'
import type { EnrichedExampleWithId } from './enrichment'
import type { EmbeddingsStore } from './example-converter'

// Mock embeddings - simple vectors for testing
const mockEmbedding = (values: number[]): number[] => {
  // Pad to 1536 dimensions (OpenAI embedding size)
  const result = new Array(1536).fill(0)
  values.forEach((v, i) => (result[i] = v))
  return result
}

// Create test items
const createItem = (
  id: string,
  type: 'capacity' | 'need',
  expressions: Array<{ text: string; categoryChain: string[] }>
): EnrichedExampleWithId => ({
  id,
  type,
  naturalLanguage: expressions[0]?.text ?? '',
  expressions: expressions.map((e) => ({
    text: e.text,
    categoryChain: e.categoryChain,
    disjointWith: null,
  })),
  constraints: null,
  shouldMatchWith: [],
  notes: null,
})

describe('search', () => {
  test('returns empty array for no matches above threshold', () => {
    const items: EnrichedExampleWithId[] = [
      createItem('1', 'capacity', [{ text: 'piano lessons', categoryChain: ['services', 'education', 'piano'] }]),
    ]

    // Embeddings that are orthogonal (zero similarity)
    const embeddings: EmbeddingsStore = {
      '1': mockEmbedding([1, 0, 0]),
      services: mockEmbedding([1, 0, 0]),
      education: mockEmbedding([1, 0, 0]),
      piano: mockEmbedding([1, 0, 0]),
    }

    const results = search({
      query: 'cooking',
      queryEmbedding: mockEmbedding([0, 1, 0]), // orthogonal
      threshold: 0.5,
      items,
      embeddings,
    })

    expect(results).toEqual([])
  })

  test('finds items with high embedding similarity', () => {
    const items: EnrichedExampleWithId[] = [
      createItem('1', 'capacity', [{ text: 'piano lessons', categoryChain: ['services', 'education', 'piano'] }]),
      createItem('2', 'need', [{ text: 'cooking class', categoryChain: ['culinary', 'food-prep', 'cooking'] }]),
    ]

    // Item 1 has similar embedding to query (music ≈ piano), item 2 does not (cooking is orthogonal)
    const embeddings: EmbeddingsStore = {
      '1': mockEmbedding([0.9, 0.1, 0]),
      '2': mockEmbedding([0, 0, 1]),
      services: mockEmbedding([0.6, 0.4, 0]),
      education: mockEmbedding([0.7, 0.3, 0]),
      piano: mockEmbedding([0.95, 0.05, 0]),  // very similar to "music" query
      culinary: mockEmbedding([0, 0.1, 0.9]),
      'food-prep': mockEmbedding([0, 0.2, 0.8]),
      cooking: mockEmbedding([0, 0, 1]),  // orthogonal to "music"
    }

    const results = search({
      query: 'music',
      queryEmbedding: mockEmbedding([0.9, 0.1, 0]),
      threshold: 0.3,
      items,
      embeddings,
    })

    expect(results.length).toBe(1)
    expect(results[0]!.id).toBe('1')
    expect(results[0]!.type).toBe('capacity')
    expect(results[0]!.score).toBeGreaterThan(0.5)
  })

  test('boosts score for category chain matches', () => {
    const items: EnrichedExampleWithId[] = [
      createItem('1', 'capacity', [{ text: 'organic vegetables', categoryChain: ['goods', 'food', 'vegetables'] }]),
    ]

    // Query "food" matches the category chain exactly
    const embeddings: EmbeddingsStore = {
      '1': mockEmbedding([0.3, 0.3, 0.3]),
      goods: mockEmbedding([0.1, 0.1, 0]),
      food: mockEmbedding([1, 0, 0]), // exact match to query
      vegetables: mockEmbedding([0.8, 0.1, 0]),
    }

    const results = search({
      query: 'food',
      queryEmbedding: mockEmbedding([1, 0, 0]), // matches "food" category exactly
      threshold: 0.3,
      items,
      embeddings,
    })

    expect(results.length).toBe(1)
    // Score should be boosted by category match (70% category + 30% embedding)
    expect(results[0]!.score).toBeGreaterThan(0.7)
  })

  test('returns correct type for each item', () => {
    const items: EnrichedExampleWithId[] = [
      createItem('cap1', 'capacity', [{ text: 'piano teacher', categoryChain: ['services', 'music'] }]),
      createItem('need1', 'need', [{ text: 'need piano lessons', categoryChain: ['services', 'music'] }]),
    ]

    const embeddings: EmbeddingsStore = {
      cap1: mockEmbedding([0.9, 0.1, 0]),
      need1: mockEmbedding([0.9, 0.1, 0]),
      services: mockEmbedding([0.5, 0.5, 0]),
      music: mockEmbedding([0.9, 0.1, 0]),
    }

    const results = search({
      query: 'piano',
      queryEmbedding: mockEmbedding([0.9, 0.1, 0]),
      threshold: 0.3,
      items,
      embeddings,
    })

    expect(results.length).toBe(2)
    const cap = results.find((r) => r.id === 'cap1')
    const need = results.find((r) => r.id === 'need1')
    expect(cap?.type).toBe('capacity')
    expect(need?.type).toBe('need')
  })

  test('results are sorted by score descending', () => {
    const items: EnrichedExampleWithId[] = [
      createItem('low', 'capacity', [{ text: 'low match', categoryChain: ['a'] }]),
      createItem('high', 'capacity', [{ text: 'high match', categoryChain: ['b'] }]),
      createItem('mid', 'capacity', [{ text: 'mid match', categoryChain: ['c'] }]),
    ]

    const embeddings: EmbeddingsStore = {
      low: mockEmbedding([0.3, 0.3, 0.3]),
      high: mockEmbedding([0.95, 0.05, 0]),
      mid: mockEmbedding([0.6, 0.3, 0.1]),
      a: mockEmbedding([0.3, 0.3, 0.3]),
      b: mockEmbedding([0.9, 0.1, 0]),
      c: mockEmbedding([0.6, 0.3, 0.1]),
    }

    const results = search({
      query: 'test',
      queryEmbedding: mockEmbedding([1, 0, 0]),
      threshold: 0.1,
      items,
      embeddings,
    })

    expect(results.length).toBe(3)
    expect(results[0]!.id).toBe('high')
    expect(results[1]!.id).toBe('mid')
    expect(results[2]!.id).toBe('low')
  })

  test('handles items without embeddings', () => {
    const items: EnrichedExampleWithId[] = [
      createItem('1', 'capacity', [{ text: 'has embedding', categoryChain: ['a'] }]),
      createItem('2', 'capacity', [{ text: 'no embedding', categoryChain: ['a'] }]),
    ]

    const embeddings: EmbeddingsStore = {
      '1': mockEmbedding([0.9, 0.1, 0]),
      // '2' has no embedding
      a: mockEmbedding([0.5, 0.5, 0]),
    }

    const results = search({
      query: 'test',
      queryEmbedding: mockEmbedding([0.9, 0.1, 0]),
      threshold: 0.3,
      items,
      embeddings,
    })

    // Only item with embedding should be returned
    expect(results.length).toBe(1)
    expect(results[0]!.id).toBe('1')
  })
})
