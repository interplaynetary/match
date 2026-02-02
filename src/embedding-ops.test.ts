import { describe, test, expect } from 'bun:test'
import type { EmbeddingProvider } from './embeddings'
import type { EnrichedExampleWithId } from './enrichment'
import {
  embeddingText,
  embedSingleItem,
  embedSingleItemCategories,
  embedBatch,
} from './embedding-ops'

// Mock embedding provider that returns deterministic embeddings
function mockProvider(): EmbeddingProvider {
  return {
    embed: async (text: string) => {
      // Return a simple hash-based embedding for testing
      const hash = text.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
      return [hash / 1000, (hash % 100) / 100, 0.5]
    },
    embedBatch: async (texts: string[]) => {
      return texts.map((text) => {
        const hash = text.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
        return [hash / 1000, (hash % 100) / 100, 0.5]
      })
    },
  }
}

function makeExample(overrides: Partial<EnrichedExampleWithId> = {}): EnrichedExampleWithId {
  return {
    id: 'test-id',
    naturalLanguage: 'Test example',
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

describe('embeddingText', () => {
  test('combines expression texts with pipe separator', () => {
    const example = makeExample({
      expressions: [
        { text: 'vegan pizza', categoryChain: ['food'], disjointWith: null },
        { text: 'pizza delivery', categoryChain: ['services'], disjointWith: null },
        { text: 'food', categoryChain: ['goods'], disjointWith: null },
      ],
    })

    expect(embeddingText(example)).toBe('vegan pizza | pizza delivery | food')
  })

  test('handles single expression', () => {
    const example = makeExample({
      expressions: [
        { text: 'solo text', categoryChain: ['cat'], disjointWith: null },
      ],
    })

    expect(embeddingText(example)).toBe('solo text')
  })
})

describe('embedSingleItem', () => {
  test('generates embedding for example', async () => {
    const provider = mockProvider()
    const example = makeExample({
      expressions: [{ text: 'test', categoryChain: ['cat'], disjointWith: null }],
    })

    const embedding = await embedSingleItem(example, provider)

    expect(Array.isArray(embedding)).toBe(true)
    expect(embedding.length).toBe(3)
    expect(typeof embedding[0]).toBe('number')
  })

  test('uses combined expression text', async () => {
    let capturedText = ''
    const provider: EmbeddingProvider = {
      embed: async (text: string) => {
        capturedText = text
        return [0, 0, 0]
      },
      embedBatch: async () => [],
    }

    const example = makeExample({
      expressions: [
        { text: 'first', categoryChain: ['a'], disjointWith: null },
        { text: 'second', categoryChain: ['b'], disjointWith: null },
      ],
    })

    await embedSingleItem(example, provider)

    expect(capturedText).toBe('first | second')
  })
})

describe('embedSingleItemCategories', () => {
  test('generates embeddings for new categories', async () => {
    const provider = mockProvider()
    const example = makeExample({
      expressions: [
        { text: 'test', categoryChain: ['food', 'pizza', 'vegan'], disjointWith: null },
      ],
    })

    const result = await embedSingleItemCategories(example, {}, provider)

    expect(Object.keys(result).sort()).toEqual(['food', 'pizza', 'vegan'])
    expect(Array.isArray(result['food'])).toBe(true)
  })

  test('skips categories that already have embeddings', async () => {
    let batchCalled = false
    const provider: EmbeddingProvider = {
      embed: async () => [0],
      embedBatch: async (texts: string[]) => {
        batchCalled = true
        return texts.map(() => [0])
      },
    }

    const example = makeExample({
      expressions: [
        { text: 'test', categoryChain: ['food', 'pizza'], disjointWith: null },
      ],
    })

    const existing = { food: [0.1], pizza: [0.2] }
    const result = await embedSingleItemCategories(example, existing, provider)

    expect(batchCalled).toBe(false)
    expect(result).toEqual({})
  })

  test('only requests embeddings for missing categories', async () => {
    let requestedTexts: string[] = []
    const provider: EmbeddingProvider = {
      embed: async () => [0],
      embedBatch: async (texts: string[]) => {
        requestedTexts = texts
        return texts.map(() => [0.5])
      },
    }

    const example = makeExample({
      expressions: [
        { text: 'test', categoryChain: ['food', 'pizza', 'vegan'], disjointWith: null },
      ],
    })

    const existing = { food: [0.1] }
    await embedSingleItemCategories(example, existing, provider)

    expect(requestedTexts.sort()).toEqual(['pizza', 'vegan'])
  })

  test('collects categories from multiple expressions', async () => {
    const provider = mockProvider()
    const example = makeExample({
      expressions: [
        { text: 'first', categoryChain: ['food', 'pizza'], disjointWith: null },
        { text: 'second', categoryChain: ['services', 'delivery'], disjointWith: null },
      ],
    })

    const result = await embedSingleItemCategories(example, {}, provider)

    expect(Object.keys(result).sort()).toEqual(['delivery', 'food', 'pizza', 'services'])
  })
})

describe('embedBatch', () => {
  test('generates embeddings for examples without existing embeddings', async () => {
    const provider = mockProvider()
    const examples = [
      makeExample({ id: 'ex1', expressions: [{ text: 'a', categoryChain: ['cat'], disjointWith: null }] }),
      makeExample({ id: 'ex2', expressions: [{ text: 'b', categoryChain: ['cat'], disjointWith: null }] }),
    ]

    const result = await embedBatch(examples, {}, provider)

    expect(result['ex1']).toBeDefined()
    expect(result['ex2']).toBeDefined()
    expect(result['cat']).toBeDefined()
  })

  test('preserves existing embeddings', async () => {
    const provider = mockProvider()
    const examples = [
      makeExample({ id: 'ex1', expressions: [{ text: 'a', categoryChain: ['cat'], disjointWith: null }] }),
    ]

    const existing = { ex1: [1, 2, 3] }
    const result = await embedBatch(examples, existing, provider)

    expect(result['ex1']).toEqual([1, 2, 3])
  })

  test('returns existing store if nothing needs embedding', async () => {
    let providerCalled = false
    const provider: EmbeddingProvider = {
      embed: async () => {
        providerCalled = true
        return []
      },
      embedBatch: async () => {
        providerCalled = true
        return []
      },
    }

    const examples = [
      makeExample({ id: 'ex1', expressions: [{ text: 'a', categoryChain: ['cat'], disjointWith: null }] }),
    ]

    const existing = { ex1: [1], cat: [2] }
    const result = await embedBatch(examples, existing, provider)

    expect(providerCalled).toBe(false)
    expect(result).toBe(existing)
  })

  test('calls progress callback', async () => {
    const provider = mockProvider()
    const examples = [
      makeExample({ id: 'ex1', expressions: [{ text: 'a', categoryChain: ['c1'], disjointWith: null }] }),
      makeExample({ id: 'ex2', expressions: [{ text: 'b', categoryChain: ['c2'], disjointWith: null }] }),
    ]

    const progressCalls: Array<[number, number]> = []
    await embedBatch(examples, {}, provider, {
      batchSize: 2,
      onProgress: (completed, total) => progressCalls.push([completed, total]),
    })

    expect(progressCalls.length).toBeGreaterThan(0)
    const lastCall = progressCalls[progressCalls.length - 1]!
    expect(lastCall[0]).toBe(lastCall[1])
  })

  test('respects batch size', async () => {
    const batchSizes: number[] = []
    const provider: EmbeddingProvider = {
      embed: async () => [0],
      embedBatch: async (texts: string[]) => {
        batchSizes.push(texts.length)
        return texts.map(() => [0])
      },
    }

    const examples = [
      makeExample({ id: 'ex1', expressions: [{ text: 'a', categoryChain: ['c1'], disjointWith: null }] }),
      makeExample({ id: 'ex2', expressions: [{ text: 'b', categoryChain: ['c2'], disjointWith: null }] }),
      makeExample({ id: 'ex3', expressions: [{ text: 'c', categoryChain: ['c3'], disjointWith: null }] }),
    ]

    await embedBatch(examples, {}, provider, { batchSize: 2 })

    // 6 items (3 examples + 3 categories) with batch size 2 = 3 batches
    expect(batchSizes).toEqual([2, 2, 2])
  })
})
