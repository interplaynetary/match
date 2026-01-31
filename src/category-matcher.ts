/**
 * Category matching logic for taxonomy-based semantic matching.
 * See docs/category-matching.md for specification.
 */

export type CategoryOverlap = {
  category: string      // where chains intersected
  distance: number      // 0 = exact, 1 = sibling, 2+ = ancestor
  depthA: number        // length of first chain
  depthB: number        // length of second chain
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
      return { category, distance, depthA: chainA.length, depthB: chainB.length, matchDepthA, matchDepthB }
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
  // Check if any category in b's chain is in a's disjoint list
  for (const category of b.chain) {
    if (a.disjointWith.includes(category)) {
      return true
    }
  }

  // Check if any category in a's chain is in b's disjoint list
  for (const category of a.chain) {
    if (b.disjointWith.includes(category)) {
      return true
    }
  }

  return false
}

/**
 * Compute category score based on overlap distance.
 * Score decreases by 0.1 for each step away from exact match.
 * Minimum score is 0.5.
 */
export function computeCategoryScore(distance: number): number {
  return Math.max(0.5, 1.0 - distance * 0.1)
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
