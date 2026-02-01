import { test, expect, describe } from 'bun:test'
import {
  findCategoryOverlap,
  hasDisjointConflict,
  computeCategoryScore,
  computeSpecificity,
} from '../src/category-matcher'

describe('findCategoryOverlap', () => {
  test('exact match returns distance 0', () => {
    const overlap = findCategoryOverlap(
      ['food', 'meat', 'pork-belly'],
      ['food', 'meat', 'pork-belly']
    )
    expect(overlap).toEqual({ category: 'pork-belly', distance: 0, matchDepthA: 3, matchDepthB: 3 })
  })

  test('sibling match returns distance 1', () => {
    const overlap = findCategoryOverlap(
      ['instruction', 'piano-instruction', 'piano-lessons'],
      ['instruction', 'piano-instruction', 'piano-teaching']
    )
    expect(overlap).toEqual({ category: 'piano-instruction', distance: 1, matchDepthA: 2, matchDepthB: 2 })
  })

  test('ancestor match returns correct distance', () => {
    const overlap = findCategoryOverlap(
      ['food'],
      ['food', 'meat', 'pork', 'pork-belly']
    )
    expect(overlap).toEqual({ category: 'food', distance: 0, matchDepthA: 1, matchDepthB: 1 })
  })

  test('descendant match returns distance from need leaf', () => {
    // Need is more specific than offer
    const overlap = findCategoryOverlap(
      ['food', 'vegetables'],
      ['food', 'vegetables', 'potatoes']
    )
    expect(overlap).toEqual({ category: 'vegetables', distance: 0, matchDepthA: 2, matchDepthB: 2 })
  })

  test('weak ancestor match returns higher distance', () => {
    // "bicycle" vs "unicycle" - overlap at "human-powered" (1 step from bicycle leaf)
    const overlap = findCategoryOverlap(
      ['vehicle', 'human-powered', 'bicycle'],
      ['vehicle', 'human-powered', 'unicycle']
    )
    expect(overlap).toEqual({ category: 'human-powered', distance: 1, matchDepthA: 2, matchDepthB: 2 })
  })

  test('no overlap returns null', () => {
    const overlap = findCategoryOverlap(
      ['service', 'moving-help'],
      ['vehicle', 'truck']
    )
    expect(overlap).toBeNull()
  })

  test('empty chain returns null', () => {
    expect(findCategoryOverlap([], ['food'])).toBeNull()
    expect(findCategoryOverlap(['food'], [])).toBeNull()
    expect(findCategoryOverlap([], [])).toBeNull()
  })
})

describe('hasDisjointConflict', () => {
  test('vegan vs meat is disjoint', () => {
    const conflict = hasDisjointConflict(
      { chain: ['food', 'vegan'], disjointWith: ['meat'] },
      { chain: ['food', 'meat', 'pork'], disjointWith: [] }
    )
    expect(conflict).toBe(true)
  })

  test('meat vs vegan is disjoint (symmetric)', () => {
    const conflict = hasDisjointConflict(
      { chain: ['food', 'meat', 'pork'], disjointWith: ['vegan'] },
      { chain: ['food', 'vegan'], disjointWith: [] }
    )
    expect(conflict).toBe(true)
  })

  test('pork vs kosher is disjoint', () => {
    const conflict = hasDisjointConflict(
      { chain: ['food', 'meat', 'pork'], disjointWith: ['kosher', 'halal'] },
      { chain: ['food', 'kosher'], disjointWith: ['pork'] }
    )
    expect(conflict).toBe(true)
  })

  test('vegetables vs fruit is not disjoint', () => {
    const conflict = hasDisjointConflict(
      { chain: ['food', 'vegetables'], disjointWith: [] },
      { chain: ['food', 'fruit'], disjointWith: [] }
    )
    expect(conflict).toBe(false)
  })

  test('same chain is not disjoint', () => {
    const conflict = hasDisjointConflict(
      { chain: ['food', 'meat', 'pork'], disjointWith: ['vegan'] },
      { chain: ['food', 'meat', 'pork'], disjointWith: ['vegan'] }
    )
    expect(conflict).toBe(false)
  })

  test('empty disjointWith is not disjoint', () => {
    const conflict = hasDisjointConflict(
      { chain: ['food', 'meat'], disjointWith: [] },
      { chain: ['food', 'vegan'], disjointWith: [] }
    )
    expect(conflict).toBe(false)
  })
})

describe('computeCategoryScore', () => {
  test('exact match (distance 0) returns 1.0', () => {
    expect(computeCategoryScore(0)).toBe(1.0)
  })

  test('distance 1 returns 0.8', () => {
    expect(computeCategoryScore(1)).toBe(0.8)
  })

  test('distance > 1 returns null (too generic)', () => {
    expect(computeCategoryScore(2)).toBeNull()
    expect(computeCategoryScore(3)).toBeNull()
    expect(computeCategoryScore(10)).toBeNull()
  })
})

describe('computeSpecificity', () => {
  test('equal shallow depths have low specificity', () => {
    // 1 <> 1: generic but balanced
    const spec = computeSpecificity(1, 1)
    expect(spec).toBeCloseTo(1/6 * 1.0, 5) // ~0.167
  })

  test('asymmetric depths have lower specificity', () => {
    // 1 <> 3: generic and unbalanced
    const spec = computeSpecificity(1, 3)
    expect(spec).toBeCloseTo(1/6 * (1/3), 5) // ~0.056
  })

  test('equal medium depths have moderate specificity', () => {
    // 3 <> 3: moderately specific
    const spec = computeSpecificity(3, 3)
    expect(spec).toBeCloseTo(3/6 * 1.0, 5) // 0.5
  })

  test('equal deep depths have high specificity', () => {
    // 5 <> 5: highly specific
    const spec = computeSpecificity(5, 5)
    expect(spec).toBeCloseTo(5/6 * 1.0, 5) // ~0.833
  })

  test('moderate asymmetric depths', () => {
    // 3 <> 5: moderate depth, somewhat unbalanced
    const spec = computeSpecificity(3, 5)
    expect(spec).toBeCloseTo(3/6 * (3/5), 5) // 0.3
  })

  test('is commutative', () => {
    expect(computeSpecificity(1, 3)).toBe(computeSpecificity(3, 1))
    expect(computeSpecificity(2, 5)).toBe(computeSpecificity(5, 2))
  })

  test('zero or negative depth returns 0', () => {
    expect(computeSpecificity(0, 3)).toBe(0)
    expect(computeSpecificity(3, 0)).toBe(0)
    expect(computeSpecificity(-1, 3)).toBe(0)
  })
})
