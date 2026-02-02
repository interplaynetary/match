/**
 * Category matching logic for taxonomy-based semantic matching.
 * See docs/category-matching.md for specification.
 */

import { cosineSimilarity } from './embeddings'

export type CategoryOverlap = {
  category: string      // where chains intersected
  distance: number      // 0 = exact, 1 = sibling, 2+ = ancestor
  matchDepthA: number   // depth of match point in first chain (1-indexed)
  matchDepthB: number   // depth of match point in second chain (1-indexed)
}

export type CategoryInfo = {
  chain: string[]
  disjointWith: string[]
}

/**
 * Find the overlap point between two category chains.
 * Returns the deepest common category and the distance from the first chain's leaf.
 *
 * Distance is calculated as the number of steps from the first chain's leaf
 * to the overlap point.
 */
export function findCategoryOverlap(
  chainA: string[],
  chainB: string[]
): CategoryOverlap | null {
  if (chainA.length === 0 || chainB.length === 0) {
    return null
  }

  const setB = new Set(chainB)

  // Find the deepest category in chainA that exists in chainB
  // Start from the end (most specific) and work backwards
  for (let i = chainA.length - 1; i >= 0; i--) {
    const category = chainA[i]!
    if (setB.has(category)) {
      // Distance is how far from the leaf of chainA this match is
      const distance = chainA.length - 1 - i
      // Match depth = position of match point in each chain (1-indexed)
      const matchDepthA = i + 1
      const matchDepthB = chainB.indexOf(category) + 1
      return { category, distance, matchDepthA, matchDepthB }
    }
  }

  return null
}

/**
 * Check if two category expressions have a disjoint conflict.
 * A conflict exists if either chain contains a category that the other
 * declares as disjoint.
 */
export function hasDisjointConflict(a: CategoryInfo, b: CategoryInfo): boolean {
  return b.chain.some(cat => a.disjointWith.includes(cat)) ||
         a.chain.some(cat => b.disjointWith.includes(cat))
}

/**
 * Maximum distance to consider for category matching.
 * Distance 2+ typically means matching at a generic root like "services"
 * which provides little signal.
 */
export const MAX_CATEGORY_DISTANCE = 1

/**
 * Compute category score based on overlap distance.
 * Score decreases by 0.2 for each step away from exact match.
 * Returns null if distance exceeds MAX_CATEGORY_DISTANCE.
 */
export function computeCategoryScore(distance: number): number | null {
  if (distance > MAX_CATEGORY_DISTANCE) {
    return null  // too generic, don't use category matching
  }
  return Math.max(0.5, 1.0 - distance * 0.2)
}

const MAX_DEPTH = 6

/**
 * Compute specificity of a category match based on where the match occurred.
 *
 * Specificity reflects how precise/tight a match is:
 * - Deeper match points = more specific (matching at "sourdough" vs "food")
 * - Balanced match depths = stronger than asymmetric
 *
 * Uses the MATCH POINT depths (where in each chain the overlap occurred),
 * NOT the total chain lengths. Two long chains matching at a generic
 * root should have LOW specificity.
 *
 * Formula: (minMatchDepth / MAX_DEPTH) * balance
 * - First term: how deep is the match point (deeper = more specific)
 * - Second term: how balanced is the match (1.0 when equal depths)
 *
 * Examples (using match depths, not chain lengths):
 * - Match at depth 1↔1: (1/6) * 1.0 = 0.17 (generic root match)
 * - Match at depth 1↔3: (1/6) * 0.33 = 0.06 (one side generic)
 * - Match at depth 3↔3: (3/6) * 1.0 = 0.50 (moderately deep match)
 * - Match at depth 5↔5: (5/6) * 1.0 = 0.83 (very specific match)
 */
export function computeSpecificity(matchDepthA: number, matchDepthB: number): number {
  if (matchDepthA <= 0 || matchDepthB <= 0) return 0

  const minDepth = Math.min(matchDepthA, matchDepthB)
  const maxDepth = Math.max(matchDepthA, matchDepthB)
  const balance = minDepth / maxDepth

  return (minDepth / MAX_DEPTH) * balance
}

export type SemanticOverlap = {
  nodeA: string           // node from chain A that matched
  nodeB: string           // node from chain B that matched (the wormhole target)
  similarity: number      // embedding similarity between the nodes
  blurDistance: number    // how far we blurred from A's leaf (0 = leaf match)
  matchDepthA: number     // depth of match in chain A (1-indexed)
  matchDepthB: number     // depth of match in chain B (1-indexed)
}

/**
 * Find semantic overlap between two category chains using embedding similarity.
 *
 * This is the "wormhole" algorithm: instead of requiring exact string matches,
 * we blur upward from chain A's leaf and look for similar-enough nodes anywhere
 * in chain B.
 *
 * @param chainA - First category chain (e.g., ["products", "grocery", "egg"])
 * @param chainB - Second category chain
 * @param embeddingsA - Embeddings for each node in chainA (same order)
 * @param embeddingsB - Embeddings for each node in chainB (same order)
 * @param threshold - Minimum similarity to count as a match (default 0.8)
 */
export function findSemanticOverlap(
  chainA: string[],
  chainB: string[],
  embeddingsA: (number[] | undefined)[],
  embeddingsB: (number[] | undefined)[],
  threshold = 0.8
): SemanticOverlap | null {
  if (chainA.length === 0 || chainB.length === 0) {
    return null
  }

  // Start from most specific (leaf), blur upward
  for (let blurDistance = 0; blurDistance < chainA.length; blurDistance++) {
    const i = chainA.length - 1 - blurDistance
    const nodeA = chainA[i]!
    const embA = embeddingsA[i]

    if (!embA) continue

    // Find best matching node in chain B
    let bestSim = 0
    let bestJ = -1

    for (let j = 0; j < chainB.length; j++) {
      const embB = embeddingsB[j]
      if (!embB) continue

      const sim = cosineSimilarity(embA, embB)
      if (sim > bestSim) {
        bestSim = sim
        bestJ = j
      }
    }

    if (bestSim >= threshold && bestJ >= 0) {
      return {
        nodeA,
        nodeB: chainB[bestJ]!,
        similarity: bestSim,
        blurDistance,
        matchDepthA: i + 1,
        matchDepthB: bestJ + 1,
      }
    }
  }

  return null
}
