/**
 * Canonical root categories for taxonomy normalization.
 *
 * All category chains must start with one of these roots.
 * Non-canonical roots are either mapped to their canonical form
 * or nested under the appropriate canonical root.
 */

export const CANONICAL_ROOTS = [
  'services',      // things people do for others
  'goods',         // physical items
  'spaces',        // locations, housing, venues
  'skills',        // teachable abilities, expertise
  'opportunities', // jobs, gigs, events, experiences
] as const

export type CanonicalRoot = typeof CANONICAL_ROOTS[number]

/**
 * Direct mappings: non-canonical root → canonical equivalent
 * These are synonyms or singular/plural variations
 */
export const ROOT_MAPPINGS: Record<string, CanonicalRoot> = {
  // Synonyms for 'services'
  'service': 'services',
  'labor': 'services',
  'employment': 'services',

  // Synonyms for 'goods'
  'product': 'goods',
  'products': 'goods',
  'item': 'goods',
  'items': 'goods',
  'object': 'goods',
  'objects': 'goods',
  'equipment': 'goods',

  // Synonyms for 'spaces'
  'space': 'spaces',
  'housing': 'spaces',
  'real-estate': 'spaces',
  'location': 'spaces',
  'venue': 'spaces',

  // Synonyms for 'skills'
  'skill': 'skills',
  'expertise': 'skills',
  'abilities': 'skills',
  'ability': 'skills',

  // Synonyms for 'opportunities'
  'opportunity': 'opportunities',
  'experience': 'opportunities',
  'experiences': 'opportunities',
  'entertainment': 'opportunities',
  'arts': 'opportunities',
  'activities': 'opportunities',
  'activity': 'opportunities',
  'job': 'opportunities',
  'jobs': 'opportunities',
  'gig': 'opportunities',
  'gigs': 'opportunities',
  'event': 'opportunities',
  'events': 'opportunities',

  // Legacy roots from old taxonomy → map to best fit
  'entities': 'services',      // people/orgs offering services
  'entity': 'services',
  'person': 'services',
  'people': 'services',
  'organization': 'services',
  'resources': 'goods',        // resources → goods or skills depending on context
  'resource': 'goods',
  'investment': 'opportunities',
  'relationships': 'services',
}

/**
 * Nesting rules: non-canonical root → [canonical root, ...intermediate path]
 * These are more specific categories that should be nested
 */
export const ROOT_NESTING: Record<string, string[]> = {
  // Food-related roots nest under goods
  'food': ['goods', 'food'],
  'ingredient': ['goods', 'food', 'ingredients'],
  'ingredients': ['goods', 'food', 'ingredients'],

  // Service-provider maps to services
  'service-provider': ['services', 'professional', 'service-provider'],

  // Specific space types
  'apartment': ['spaces', 'housing', 'apartment'],
  'rental': ['spaces', 'rental'],
}

/**
 * Normalize a category chain to start with a canonical root.
 *
 * @example
 * normalizeChain(['food', 'ingredients', 'flour'])
 * // → ['goods', 'food', 'ingredients', 'flour']
 *
 * @example
 * normalizeChain(['service', 'catering'])
 * // → ['services', 'catering']
 *
 * @example
 * normalizeChain(['services', 'food-services'])
 * // → ['services', 'food-services']  (already canonical)
 */
export function normalizeChain(chain: string[]): string[] {
  if (chain.length === 0) return chain

  const root = chain[0]!

  // Already canonical
  if (CANONICAL_ROOTS.includes(root as CanonicalRoot)) {
    return chain
  }

  // Direct mapping (synonym)
  if (root in ROOT_MAPPINGS) {
    return [ROOT_MAPPINGS[root]!, ...chain.slice(1)]
  }

  // Nesting rule
  if (root in ROOT_NESTING) {
    const prefix = ROOT_NESTING[root]!
    // Avoid duplication if the chain already continues with expected nodes
    const suffix = chain.slice(1)
    return [...prefix, ...suffix]
  }

  // Unknown root - flag it but pass through
  console.warn(`Unknown root category: "${root}"`)
  return chain
}

/**
 * Check if a root is canonical
 */
export function isCanonicalRoot(root: string): root is CanonicalRoot {
  return CANONICAL_ROOTS.includes(root as CanonicalRoot)
}
