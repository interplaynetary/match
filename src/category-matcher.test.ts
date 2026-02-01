import { describe, it, expect } from 'bun:test'
import {
  findCategoryOverlap,
  findSemanticOverlap,
  computeCategoryScore,
} from './category-matcher'

describe('findCategoryOverlap', () => {
  it('finds exact match at leaf', () => {
    const result = findCategoryOverlap(
      ['goods', 'food', 'bread'],
      ['goods', 'food', 'bread']
    )
    expect(result).toEqual({
      category: 'bread',
      distance: 0,
      matchDepthA: 3,
      matchDepthB: 3,
    })
  })

  it('finds match at ancestor when leaves differ', () => {
    const result = findCategoryOverlap(
      ['goods', 'food', 'bread'],
      ['goods', 'food', 'cheese']
    )
    expect(result).toEqual({
      category: 'food',
      distance: 1,
      matchDepthA: 2,
      matchDepthB: 2,
    })
  })

  it('returns null when no overlap', () => {
    const result = findCategoryOverlap(
      ['goods', 'food'],
      ['services', 'education']
    )
    expect(result).toBeNull()
  })
})

describe('findSemanticOverlap', () => {
  // Mock embeddings: just use simple vectors where similar words have high dot product
  const embed = (id: number): number[] => {
    const vec = new Array(10).fill(0)
    vec[id % 10] = 1
    return vec
  }

  // Create embeddings where "egg" and "eggs" are nearly identical
  const eggEmb = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  const eggsEmb = [0.99, 0.14, 0, 0, 0, 0, 0, 0, 0, 0] // ~0.99 similarity to egg

  it('finds wormhole match between similar nodes', () => {
    const chainA = ['products', 'grocery', 'egg']
    const chainB = ['goods', 'food', 'groceries', 'eggs', 'organic-eggs']

    // Different embeddings for each node, but egg ≈ eggs
    const embA = [embed(1), embed(2), eggEmb]
    const embB = [embed(3), embed(4), embed(5), eggsEmb, embed(6)]

    const result = findSemanticOverlap(chainA, chainB, embA, embB, 0.9)

    expect(result).not.toBeNull()
    expect(result!.nodeA).toBe('egg')
    expect(result!.nodeB).toBe('eggs')
    expect(result!.blurDistance).toBe(0) // matched at leaf
    expect(result!.similarity).toBeGreaterThan(0.9)
  })

  it('blurs upward when leaf does not match', () => {
    const chainA = ['services', 'education', 'music']
    const chainB = ['service', 'teaching', 'music-lessons']

    // music ≈ music-lessons (0.95), but education ≉ teaching
    const musicEmb = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const musicLessonsEmb = [0.95, 0.31, 0, 0, 0, 0, 0, 0, 0, 0]

    const embA = [embed(1), embed(2), musicEmb]
    const embB = [embed(3), embed(4), musicLessonsEmb]

    const result = findSemanticOverlap(chainA, chainB, embA, embB, 0.9)

    expect(result).not.toBeNull()
    expect(result!.nodeA).toBe('music')
    expect(result!.nodeB).toBe('music-lessons')
    expect(result!.blurDistance).toBe(0) // still at leaf since music matches
  })

  it('returns null when nothing matches above threshold', () => {
    const chainA = ['x', 'y', 'z']
    const chainB = ['a', 'b', 'c']

    // All different embeddings
    const embA = [embed(1), embed(2), embed(3)]
    const embB = [embed(4), embed(5), embed(6)]

    const result = findSemanticOverlap(chainA, chainB, embA, embB, 0.9)

    expect(result).toBeNull()
  })

  it('handles missing embeddings gracefully', () => {
    const chainA = ['a', 'b', 'c']
    const chainB = ['x', 'y', 'c']

    // c has same embedding in both
    const cEmb = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const embA = [undefined, undefined, cEmb]
    const embB = [undefined, undefined, cEmb]

    const result = findSemanticOverlap(chainA, chainB, embA, embB, 0.9)

    expect(result).not.toBeNull()
    expect(result!.nodeA).toBe('c')
    expect(result!.nodeB).toBe('c')
    expect(result!.similarity).toBe(1)
  })
})

describe('computeCategoryScore', () => {
  it('returns 1.0 for exact match (distance 0)', () => {
    expect(computeCategoryScore(0)).toBe(1.0)
  })

  it('returns 0.8 for distance 1', () => {
    expect(computeCategoryScore(1)).toBe(0.8)
  })

  it('returns null for distance > MAX_CATEGORY_DISTANCE (too generic)', () => {
    expect(computeCategoryScore(2)).toBeNull()
    expect(computeCategoryScore(3)).toBeNull()
    expect(computeCategoryScore(5)).toBeNull()
  })
})
