import { test, expect, describe } from 'bun:test'
import { Matcher } from '$lib/core/matcher'
import type { Capacity, Need } from '$lib/core/types'
import { cosineSimilarity, generateEmbeddingText } from '$lib/core/embeddings'

describe('Cosine Similarity', () => {
  test('identical vectors have similarity 1', () => {
    const v = [0.1, 0.2, 0.3]
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0)
  })

  test('orthogonal vectors have similarity 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  test('opposite vectors have similarity -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
  })

  test('similar vectors have high similarity', () => {
    const a = [0.5, 0.5, 0.0]
    const b = [0.6, 0.4, 0.1]
    const sim = cosineSimilarity(a, b)
    expect(sim).toBeGreaterThan(0.9)
  })

  test('empty vectors return 0', () => {
    expect(cosineSimilarity([], [])).toBe(0)
  })

  test('throws on dimension mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow('dimension mismatch')
  })
})

describe('Embedding Text Generation', () => {
  test('capacity generates text from expressions', () => {
    const capacity: Capacity = {
      id: 'c1',
      expressions: [
        { text: 'piano teacher' },
        { text: 'music lessons' },
      ],
    }
    const text = generateEmbeddingText(capacity)
    expect(text).toContain('piano teacher')
    expect(text).toContain('music lessons')
  })

  test('need generates text from expressions', () => {
    const need: Need = {
      id: 'n1',
      expressions: [
        { text: 'organic flour' },
        { text: 'flour' },
      ],
    }
    const text = generateEmbeddingText(need)
    expect(text).toContain('organic flour')
    expect(text).toContain('flour')
  })

  test('expressions sorted by priority', () => {
    const need: Need = {
      id: 'n1',
      expressions: [
        { text: 'food', priority: 3 },
        { text: 'pizza', priority: 1 },
        { text: 'Italian food', priority: 2 },
      ],
    }
    const text = generateEmbeddingText(need)
    // Higher priority (lower number) comes first
    expect(text.indexOf('pizza')).toBeLessThan(text.indexOf('Italian food'))
    expect(text.indexOf('Italian food')).toBeLessThan(text.indexOf('food'))
  })
})

describe('Embedding-Based Matching', () => {
  const matcher = new Matcher({ similarityThreshold: 0.5 })

  test('matches when embeddings are similar', () => {
    const need: Need = {
      id: 'n1',
      expressions: [{ text: 'flour' }],
      embedding: [0.8, 0.2, 0.1],
    }
    const capacity: Capacity = {
      id: 'c1',
      expressions: [{ text: 'organic flour' }],
      embedding: [0.7, 0.3, 0.1], // similar
    }

    const matches = matcher.findMatches(need, [capacity])
    expect(matches).toHaveLength(1)
    expect(matches[0]!.breakdown.similarity).toBeGreaterThan(0.9)
  })

  test('no match when embeddings are dissimilar', () => {
    const need: Need = {
      id: 'n1',
      expressions: [{ text: 'flour' }],
      embedding: [1.0, 0.0, 0.0],
    }
    const capacity: Capacity = {
      id: 'c1',
      expressions: [{ text: 'car' }],
      embedding: [0.0, 0.0, 1.0], // orthogonal
    }

    const matches = matcher.findMatches(need, [capacity])
    expect(matches).toHaveLength(0) // below threshold
  })

  test('no match when embeddings are missing', () => {
    const need: Need = {
      id: 'n1',
      expressions: [{ text: 'flour' }],
      // no embedding
    }
    const capacity: Capacity = {
      id: 'c1',
      expressions: [{ text: 'organic flour' }],
      // no embedding
    }

    const matches = matcher.findMatches(need, [capacity])
    expect(matches).toHaveLength(0)
  })

  test('priority weighting affects score', () => {
    const need: Need = {
      id: 'n1',
      expressions: [
        { text: 'pizza', priority: 1 },
        { text: 'food', priority: 2 },
      ],
      embedding: [0.8, 0.2],
    }
    const capacity: Capacity = {
      id: 'c1',
      expressions: [
        { text: 'vegan pizza', priority: 1 },
      ],
      embedding: [0.75, 0.25],
    }

    const matches = matcher.findMatches(need, [capacity])
    expect(matches).toHaveLength(1)
    expect(matches[0]!.breakdown.priorityWeight).toBe(1.0) // both priority 1
  })

  test('lower priority expressions get lower weight', () => {
    const need: Need = {
      id: 'n1',
      expressions: [
        { text: 'food', priority: 3 }, // low priority
      ],
      embedding: [0.8, 0.2],
    }
    const capacity: Capacity = {
      id: 'c1',
      expressions: [
        { text: 'food', priority: 3 }, // low priority
      ],
      embedding: [0.75, 0.25],
    }

    const matches = matcher.findMatches(need, [capacity])
    expect(matches).toHaveLength(1)
    // Priority 3 -> weight 0.8, combined = sqrt(0.8 * 0.8) = 0.8
    expect(matches[0]!.breakdown.priorityWeight).toBeCloseTo(0.8)
  })

  test('negative similarity is clamped to 0', () => {
    const need: Need = {
      id: 'n1',
      expressions: [{ text: 'flour' }],
      embedding: [1.0, 0.0],
    }
    const capacity: Capacity = {
      id: 'c1',
      expressions: [{ text: 'not flour' }],
      embedding: [-1.0, 0.0], // opposite direction
    }

    // With threshold 0.5, this won't match, but let's test with lower threshold
    const lowThresholdMatcher = new Matcher({ similarityThreshold: 0 })
    const matches = lowThresholdMatcher.findMatches(need, [capacity])
    expect(matches[0]!.breakdown.similarity).toBe(0) // clamped
  })
})

describe('Constraint Feasibility', () => {
  const matcher = new Matcher({ similarityThreshold: 0.5 })

  test('quantity feasibility: sufficient capacity', () => {
    const need: Need = {
      id: 'n1',
      expressions: [{ text: 'flour' }],
      constraints: { quantity: { amount: 2, unit: 'kg' } },
      embedding: [0.8, 0.2],
    }
    const capacity: Capacity = {
      id: 'c1',
      expressions: [{ text: 'flour' }],
      constraints: { quantity: { amount: 5, unit: 'kg' } },
      embedding: [0.8, 0.2],
    }

    const matches = matcher.findMatches(need, [capacity])
    expect(matches[0]!.breakdown.quantity).toBe(1.0)
  })

  test('quantity feasibility: insufficient capacity', () => {
    const need: Need = {
      id: 'n1',
      expressions: [{ text: 'flour' }],
      constraints: { quantity: { amount: 10, unit: 'kg' } },
      embedding: [0.8, 0.2],
    }
    const capacity: Capacity = {
      id: 'c1',
      expressions: [{ text: 'flour' }],
      constraints: { quantity: { amount: 5, unit: 'kg' } },
      embedding: [0.8, 0.2],
    }

    const matches = matcher.findMatches(need, [capacity])
    expect(matches[0]!.breakdown.quantity).toBe(0.5) // 5/10
  })

  test('quantity feasibility: unit mismatch', () => {
    const need: Need = {
      id: 'n1',
      expressions: [{ text: 'flour' }],
      constraints: { quantity: { amount: 2, unit: 'kg' } },
      embedding: [0.8, 0.2],
    }
    const capacity: Capacity = {
      id: 'c1',
      expressions: [{ text: 'flour' }],
      constraints: { quantity: { amount: 5, unit: 'lbs' } },
      embedding: [0.8, 0.2],
    }

    // Use zero threshold to see the actual quantity score
    const noThresholdMatcher = new Matcher({ similarityThreshold: 0 })
    const matches = noThresholdMatcher.findMatches(need, [capacity])
    expect(matches[0]!.breakdown.quantity).toBe(0.0)
  })
})

// Test against the dataset
import { convertExamples, type EmbeddingsStore } from '../src/lib/core/example-converter'
import embeddingsData from '../src/lib/data/embeddings.json'

// Try to load enriched examples (with category chains), fall back to original
let examples: unknown[]
try {
  examples = await Bun.file('./src/lib/data/enriched-examples.json').json()
} catch {
  examples = (await import('../src/lib/data/matching-examples.json')).default
}

const embeddings = embeddingsData as EmbeddingsStore

describe('Dataset Examples', () => {
  const { capacities, needs } = convertExamples(examples as any, embeddings)
  const matcher = new Matcher()

  test('converts all examples', () => {
    expect(capacities.length).toBeGreaterThan(0)
    expect(needs.length).toBeGreaterThan(0)
    console.log(`Converted ${capacities.length} capacities, ${needs.length} needs`)
  })

  test('all items have expressions', () => {
    for (const cap of capacities) {
      expect(cap.expressions.length).toBeGreaterThan(0)
    }
    for (const need of needs) {
      expect(need.expressions.length).toBeGreaterThan(0)
    }
  })

  test('all items have embeddings', () => {
    for (const cap of capacities) {
      expect(cap.embedding).toBeDefined()
      expect(cap.embedding!.length).toBe(1536)
    }
    for (const need of needs) {
      expect(need.embedding).toBeDefined()
      expect(need.embedding!.length).toBe(1536)
    }
  })

  test('finds matches across dataset', () => {
    let totalMatches = 0
    for (const need of needs) {
      const matches = matcher.findMatches(need, capacities)
      totalMatches += matches.length
    }
    console.log(`Found ${totalMatches} matches across ${needs.length} needs`)
    expect(totalMatches).toBeGreaterThan(0)
  })
})
