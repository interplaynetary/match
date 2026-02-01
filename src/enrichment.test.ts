/**
 * Tests for the enrichment pipeline
 *
 * Takes user inputs and enriches them with:
 * - Expressions at different abstraction levels
 * - Category chains for matching
 * - Structured constraints
 * - Matching hints
 */

import { describe, test, expect } from 'bun:test'
import { z } from 'zod'
import {
  EnrichedExpression,
  EnrichedExample,
  UserInput,
  ENRICHMENT_PROMPT,
  collectCategoryStats,
} from './enrichment'

describe('EnrichedExpression schema', () => {
  test('validates correct expression', () => {
    const valid = {
      text: 'organic flour',
      categoryChain: ['goods', 'food', 'ingredients', 'flour'],
      disjointWith: null, // nullable field
    }

    const result = EnrichedExpression.safeParse(valid)
    expect(result.success).toBe(true)
  })

  test('requires at least one category in chain', () => {
    const invalid = {
      text: 'flour',
      categoryChain: [],
      disjointWith: null,
    }

    const result = EnrichedExpression.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  test('allows disjointWith array', () => {
    const valid = {
      text: 'vegan catering',
      categoryChain: ['services', 'food-services', 'catering', 'vegan-catering'],
      disjointWith: ['meat-based', 'dairy-based'],
    }

    const result = EnrichedExpression.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disjointWith).toEqual(['meat-based', 'dairy-based'])
    }
  })
})

describe('EnrichedExample schema', () => {
  test('validates complete example', () => {
    const valid: z.infer<typeof EnrichedExample> = {
      naturalLanguage: 'I have 5kg of organic flour available this weekend',
      type: 'capacity',
      expressions: [
        {
          text: '5kg of organic flour',
          categoryChain: ['goods', 'food', 'ingredients', 'flour'],
          disjointWith: null,
        },
        {
          text: 'flour',
          categoryChain: ['goods', 'food', 'ingredients'],
          disjointWith: null,
        },
      ],
      constraints: {
        quantity: { amount: 5, min: null, max: null, unit: 'kg' },
        time: null,
        location: null,
        price: null,
      },
      shouldMatchWith: ['flour needs', 'baking projects'],
      notes: 'Simple capacity with quantity constraint',
    }

    const result = EnrichedExample.safeParse(valid)
    expect(result.success).toBe(true)
  })

  test('requires at least one expression', () => {
    const invalid = {
      naturalLanguage: 'test',
      type: 'capacity',
      expressions: [],
      shouldMatchWith: [],
      constraints: null,
      notes: null,
    }

    const result = EnrichedExample.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  test('type must be capacity or need', () => {
    const invalid = {
      naturalLanguage: 'test',
      type: 'offer', // wrong
      expressions: [{ text: 'test', categoryChain: ['services'], disjointWith: null }],
      shouldMatchWith: [],
      constraints: null,
      notes: null,
    }

    const result = EnrichedExample.safeParse(invalid)
    expect(result.success).toBe(false)
  })
})

describe('UserInput schema', () => {
  test('validates user input', () => {
    const valid = {
      naturalLanguage: 'I need a plumber',
      type: 'need',
    }

    const result = UserInput.safeParse(valid)
    expect(result.success).toBe(true)
  })
})

describe('ENRICHMENT_PROMPT', () => {
  test('emphasizes consistency over hardcoded roots', () => {
    expect(ENRICHMENT_PROMPT).toContain('consistent')
    expect(ENRICHMENT_PROMPT).toContain('same concepts should use same category names')
  })

  test('focuses on matching utility', () => {
    expect(ENRICHMENT_PROMPT).toContain('match')
  })

  test('discourages useless categories', () => {
    expect(ENRICHMENT_PROMPT).toContain('entity')
  })
})

describe('collectCategoryStats', () => {
  const sampleEnriched: z.infer<typeof EnrichedExample>[] = [
    {
      naturalLanguage: 'test 1',
      type: 'capacity',
      expressions: [
        { text: 'piano teacher', categoryChain: ['services', 'education', 'music'], disjointWith: null },
        { text: 'teacher', categoryChain: ['services', 'education'], disjointWith: null },
      ],
      shouldMatchWith: ['students'],
      constraints: null,
      notes: null,
    },
    {
      naturalLanguage: 'test 2',
      type: 'need',
      expressions: [
        { text: 'flour', categoryChain: ['goods', 'food', 'ingredients'], disjointWith: null },
      ],
      shouldMatchWith: ['flour sellers'],
      constraints: null,
      notes: null,
    },
    {
      naturalLanguage: 'test 3',
      type: 'capacity',
      expressions: [
        { text: 'person', categoryChain: ['entity', 'person'], disjointWith: null }, // bad root
      ],
      shouldMatchWith: ['anything'],
      constraints: null,
      notes: null,
    },
  ]

  test('counts root distribution', () => {
    const stats = collectCategoryStats(sampleEnriched)

    expect(stats.rootCounts.get('services')).toBe(2)
    expect(stats.rootCounts.get('goods')).toBe(1)
    expect(stats.rootCounts.get('entity')).toBe(1)
  })

  test('computes depth stats', () => {
    const stats = collectCategoryStats(sampleEnriched)

    expect(stats.depths.min).toBe(2) // ['entity', 'person']
    expect(stats.depths.max).toBe(3) // ['services', 'education', 'music']
    expect(stats.depths.avg).toBeCloseTo(2.5, 1)
  })

  test('counts total expressions', () => {
    const stats = collectCategoryStats(sampleEnriched)

    expect(stats.totalExpressions).toBe(4)
  })
})
