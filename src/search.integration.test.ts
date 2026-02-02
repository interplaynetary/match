/**
 * Integration tests for search using actual data from the dataset.
 * These tests verify that search works correctly with real embeddings.
 *
 * Uses pre-computed query embeddings from data/test-query-embeddings.json
 * to avoid API calls during tests. To add new test queries, run:
 *   bun -e "import {OpenAIEmbeddingProvider} from './src/embeddings'; const p = new OpenAIEmbeddingProvider(); console.log(JSON.stringify(await p.embed('your-query')))"
 */

import { describe, expect, test, beforeAll } from 'bun:test'
import { search } from './search'
import type { EnrichedExampleWithId } from './enrichment'
import type { EmbeddingsStore } from './example-converter'

// Load actual data and pre-computed query embeddings
let enrichedData: { results: EnrichedExampleWithId[] }
let embeddings: EmbeddingsStore
let queryEmbeddings: Record<string, number[]>

beforeAll(async () => {
  enrichedData = await Bun.file('data/enriched-full.json').json()
  embeddings = await Bun.file('data/embeddings.json').json()
  queryEmbeddings = await Bun.file('data/test-query-embeddings.json').json()
})

describe('search integration', () => {
  test('bike matches bicycle items with high score', () => {
    const results = search({
      query: 'bike',
      queryEmbedding: queryEmbeddings['bike']!,
      threshold: 0.5,
      items: enrichedData.results,
      embeddings,
    })

    // Should find bicycle items
    const bicycleNeedId = '83b145097447' // "used bicycle"
    const mountainBikeId = '58310471d78a' // "Trek mountain bike"

    const bicycleResult = results.find((r) => r.id === bicycleNeedId)
    const mountainBikeResult = results.find((r) => r.id === mountainBikeId)

    expect(bicycleResult).toBeDefined()
    expect(mountainBikeResult).toBeDefined()

    // Scores should be high (above 0.8) due to category matching
    expect(bicycleResult!.score).toBeGreaterThan(0.8)
    expect(mountainBikeResult!.score).toBeGreaterThan(0.8)
  })

  test('bicycle matches bike items with high score', () => {
    const results = search({
      query: 'bicycle',
      queryEmbedding: queryEmbeddings['bicycle']!,
      threshold: 0.5,
      items: enrichedData.results,
      embeddings,
    })

    // Should find the mountain bike (which says "bike" not "bicycle")
    const mountainBikeId = '58310471d78a'
    const mountainBikeResult = results.find((r) => r.id === mountainBikeId)

    expect(mountainBikeResult).toBeDefined()
    expect(mountainBikeResult!.score).toBeGreaterThan(0.8)
  })

  test('zucchini matches zucchini items, not flour', () => {
    const results = search({
      query: 'zucchini',
      queryEmbedding: queryEmbeddings['zucchini']!,
      threshold: 0.5,
      items: enrichedData.results,
      embeddings,
    })

    const zucchiniId = 'effa91234452' // "excess zucchini"
    const flourId = 'c987a903bcff' // "organic flour"

    const zucchiniResult = results.find((r) => r.id === zucchiniId)
    const flourResult = results.find((r) => r.id === flourId)

    // Zucchini should match with high score
    expect(zucchiniResult).toBeDefined()
    expect(zucchiniResult!.score).toBeGreaterThan(0.8)

    // Flour should NOT be in results at 0.5 threshold (it was ~0.53 which is borderline)
    // If it is present, it should have a much lower score than zucchini
    if (flourResult) {
      expect(flourResult.score).toBeLessThan(zucchiniResult!.score - 0.2)
    }
  })

  test('exact term matches rank highest', () => {
    const results = search({
      query: 'flour',
      queryEmbedding: queryEmbeddings['flour']!,
      threshold: 0.3,
      items: enrichedData.results,
      embeddings,
    })

    // Flour items should be at the top
    const flourCapacityId = 'c987a903bcff' // "organic flour"
    const flourNeedId = '6860875ed6f0' // "2kg of flour"

    // Check that flour items are in top results
    const topIds = results.slice(0, 5).map((r) => r.id)
    expect(topIds).toContain(flourCapacityId)
    expect(topIds).toContain(flourNeedId)

    // Top flour result should have very high score
    const topFlourResult = results.find(
      (r) => r.id === flourCapacityId || r.id === flourNeedId
    )
    expect(topFlourResult!.score).toBeGreaterThan(0.9)
  })

  test('search returns correct types', () => {
    const results = search({
      query: 'bike',
      queryEmbedding: queryEmbeddings['bike']!,
      threshold: 0.5,
      items: enrichedData.results,
      embeddings,
    })

    const bicycleNeed = results.find((r) => r.id === '83b145097447')
    const mountainBikeCapacity = results.find((r) => r.id === '58310471d78a')

    expect(bicycleNeed?.type).toBe('need')
    expect(mountainBikeCapacity?.type).toBe('capacity')
  })

  test('results are sorted by score descending', () => {
    const results = search({
      query: 'food',
      queryEmbedding: queryEmbeddings['food']!,
      threshold: 0.3,
      items: enrichedData.results,
      embeddings,
    })

    // Verify descending order
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.score).toBeLessThanOrEqual(results[i - 1]!.score)
    }
  })

  test('threshold filters out low-scoring results', () => {
    const lowThresholdResults = search({
      query: 'zucchini',
      queryEmbedding: queryEmbeddings['zucchini']!,
      threshold: 0.3,
      items: enrichedData.results,
      embeddings,
    })

    const highThresholdResults = search({
      query: 'zucchini',
      queryEmbedding: queryEmbeddings['zucchini']!,
      threshold: 0.7,
      items: enrichedData.results,
      embeddings,
    })

    // Higher threshold should return fewer results
    expect(highThresholdResults.length).toBeLessThan(lowThresholdResults.length)

    // All high threshold results should have score >= 0.7
    for (const result of highThresholdResults) {
      expect(result.score).toBeGreaterThanOrEqual(0.7)
    }
  })
})
