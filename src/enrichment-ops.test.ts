import { describe, test, expect } from 'bun:test'
import { TaxonomyTree } from './taxonomy-merge'
import type { EnrichedExampleType, UserInputType } from './enrichment'
import { enrichSingleItem, enrichBatch, type EnrichmentConfig } from './enrichment-ops'

// Mock AIPipe that returns predetermined results
function mockPipe(response: EnrichedExampleType | null) {
  return {
    generate: async () => {
      if (response === null) {
        return { success: false as const, error: 'Mock error' }
      }
      return { success: true as const, data: response }
    },
  }
}

function makeEnrichedExample(overrides: Partial<EnrichedExampleType> = {}): EnrichedExampleType {
  return {
    naturalLanguage: 'test input',
    type: 'capacity',
    expressions: [
      { text: 'test expression', categoryChain: ['category'], disjointWith: null },
    ],
    constraints: null,
    shouldMatchWith: [],
    notes: null,
    ...overrides,
  }
}

function makeInput(text: string, type: 'capacity' | 'need' = 'capacity'): UserInputType {
  return { naturalLanguage: text, type }
}

describe('enrichSingleItem', () => {
  test('returns success with enriched data', async () => {
    const enriched = makeEnrichedExample({
      expressions: [{ text: 'pizza', categoryChain: ['food', 'italian'], disjointWith: null }],
    })
    const config: EnrichmentConfig = {
      pipe: mockPipe(enriched) as any,
      taxonomy: new TaxonomyTree(),
    }

    const result = await enrichSingleItem(makeInput('pizza delivery'), config)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.expressions[0]!.text).toBe('pizza')
      expect(result.data.id).toBeDefined()
      expect(result.data.naturalLanguage).toBe('pizza delivery')
      expect(result.data.type).toBe('capacity')
    }
  })

  test('returns failure on LLM error', async () => {
    const config: EnrichmentConfig = {
      pipe: mockPipe(null) as any,
      taxonomy: new TaxonomyTree(),
    }

    const result = await enrichSingleItem(makeInput('test'), config)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('Mock error')
      expect(result.input.naturalLanguage).toBe('test')
    }
  })

  test('adds novel path to taxonomy', async () => {
    const enriched = makeEnrichedExample({
      expressions: [{ text: 'pizza', categoryChain: ['food', 'italian', 'pizza'], disjointWith: null }],
    })
    const taxonomy = new TaxonomyTree()
    const config: EnrichmentConfig = {
      pipe: mockPipe(enriched) as any,
      taxonomy,
    }

    const result = await enrichSingleItem(makeInput('pizza'), config)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.taxonomyUpdated).toBe(true)
    }
    expect(taxonomy.hasPath(['food', 'italian', 'pizza'])).toBe(true)
  })

  test('does not update taxonomy for exact match', async () => {
    const enriched = makeEnrichedExample({
      expressions: [{ text: 'pizza', categoryChain: ['food', 'italian'], disjointWith: null }],
    })
    const taxonomy = new TaxonomyTree()
    taxonomy.addPath(['food', 'italian'])

    const config: EnrichmentConfig = {
      pipe: mockPipe(enriched) as any,
      taxonomy,
    }

    const result = await enrichSingleItem(makeInput('pizza'), config)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.taxonomyUpdated).toBe(false)
    }
  })

  test('resolves conflicts using deeper root wins', async () => {
    const enriched = makeEnrichedExample({
      expressions: [{ text: 'catering', categoryChain: ['food', 'catering'], disjointWith: null }],
    })
    const taxonomy = new TaxonomyTree()
    // Existing: deeper ancestry for 'food'
    taxonomy.addPath(['goods', 'food', 'produce'])

    const config: EnrichmentConfig = {
      pipe: mockPipe(enriched) as any,
      taxonomy,
    }

    const result = await enrichSingleItem(makeInput('catering service'), config)

    expect(result.success).toBe(true)
    if (result.success) {
      // The chain should be re-rooted under goods
      expect(result.data.expressions[0]!.categoryChain[0]).toBe('goods')
      expect(result.taxonomyUpdated).toBe(true)
    }
  })

  test('generates content-based id', async () => {
    const enriched = makeEnrichedExample()
    const config: EnrichmentConfig = {
      pipe: mockPipe(enriched) as any,
      taxonomy: new TaxonomyTree(),
    }

    const result1 = await enrichSingleItem(makeInput('same text'), config)
    const result2 = await enrichSingleItem(makeInput('same text'), config)
    const result3 = await enrichSingleItem(makeInput('different text'), config)

    expect(result1.success && result2.success && result3.success).toBe(true)
    if (result1.success && result2.success && result3.success) {
      expect(result1.data.id).toBe(result2.data.id)
      expect(result1.data.id).not.toBe(result3.data.id)
    }
  })
})

describe('enrichBatch', () => {
  test('enriches multiple items', async () => {
    const enriched = makeEnrichedExample({
      expressions: [{ text: 'item', categoryChain: ['category'], disjointWith: null }],
    })
    const config = {
      pipe: mockPipe(enriched) as any,
      taxonomy: new TaxonomyTree(),
    }

    const inputs = [makeInput('item1'), makeInput('item2'), makeInput('item3')]
    const result = await enrichBatch(inputs, config)

    expect(result.results).toHaveLength(3)
    expect(result.failures).toHaveLength(0)
  })

  test('collects failures separately', async () => {
    let callCount = 0
    const pipe = {
      generate: async () => {
        callCount++
        if (callCount === 2) {
          return { success: false as const, error: 'Failed on second item' }
        }
        return {
          success: true as const,
          data: makeEnrichedExample(),
        }
      },
    }

    const config = {
      pipe: pipe as any,
      taxonomy: new TaxonomyTree(),
    }

    const inputs = [makeInput('item1'), makeInput('item2'), makeInput('item3')]
    const result = await enrichBatch(inputs, config)

    expect(result.results).toHaveLength(2)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]!.error).toBe('Failed on second item')
  })

  test('tracks extension stats', async () => {
    const enriched = makeEnrichedExample({
      expressions: [{ text: 'item', categoryChain: ['food', 'italian', 'pizza'], disjointWith: null }],
    })
    const taxonomy = new TaxonomyTree()
    taxonomy.addPath(['food', 'italian'])

    const config = {
      pipe: mockPipe(enriched) as any,
      taxonomy,
    }

    const result = await enrichBatch([makeInput('item')], config)

    expect(result.stats.extensions).toBeGreaterThanOrEqual(1)
  })

  test('respects concurrency limit', async () => {
    let concurrent = 0
    let maxConcurrent = 0

    const pipe = {
      generate: async () => {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await new Promise((r) => setTimeout(r, 10))
        concurrent--
        return { success: true as const, data: makeEnrichedExample() }
      },
    }

    const config = {
      pipe: pipe as any,
      taxonomy: new TaxonomyTree(),
      concurrency: 3,
    }

    const inputs = Array.from({ length: 10 }, (_, i) => makeInput(`item${i}`))
    await enrichBatch(inputs, config)

    expect(maxConcurrent).toBeLessThanOrEqual(3)
  })

  test('integrates all results with taxonomy sequentially', async () => {
    // Different items with overlapping category chains
    let callIndex = 0
    const pipe = {
      generate: async () => {
        const idx = callIndex++
        return {
          success: true as const,
          data: makeEnrichedExample({
            expressions: [
              {
                text: `item${idx}`,
                categoryChain: ['food', `subcategory${idx}`],
                disjointWith: null,
              },
            ],
          }),
        }
      },
    }

    const taxonomy = new TaxonomyTree()
    const config = {
      pipe: pipe as any,
      taxonomy,
      concurrency: 5,
    }

    const inputs = [makeInput('a'), makeInput('b'), makeInput('c')]
    await enrichBatch(inputs, config)

    // All subcategories should be added to taxonomy
    expect(taxonomy.hasPrefix(['food'])).toBe(true)
    expect(taxonomy.getAllPaths().length).toBe(3)
  })
})
