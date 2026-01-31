/**
 * Category matching logic for taxonomy-based semantic matching.
 * See docs/category-matching.md for specification.
 */

export type CategoryOverlap = {
  category: string   // where chains intersected
  distance: number   // 0 = exact, 1 = sibling, 2+ = ancestor
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
      return { category, distance }
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
