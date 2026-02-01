import { describe, test, expect } from 'bun:test'

/**
 * Taxonomy merge tests
 *
 * A taxonomy is a tree of category chains. When a new chain comes in
 * (from free-form LLM generation), we need to integrate it into the
 * existing structure.
 *
 * Chains are arrays from general to specific:
 *   ["services", "food-services", "catering"]
 */

// Placeholder - will implement based on tests
import {
  TaxonomyTree,
  mergePath,
  compareToTaxonomy,
  resolveConflict,
  type ConflictResult,
} from './taxonomy-merge'

describe('taxonomy tree basics', () => {
  test('empty tree has no paths', () => {
    const tree = new TaxonomyTree()
    expect(tree.getAllPaths()).toEqual([])
  })

  test('can add a single path', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['services', 'food-services', 'catering'])
    expect(tree.getAllPaths()).toEqual([
      ['services', 'food-services', 'catering'],
    ])
  })

  test('can check if path exists', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['services', 'food-services', 'catering'])
    expect(tree.hasPath(['services', 'food-services', 'catering'])).toBe(true)
    expect(tree.hasPath(['services', 'food-services'])).toBe(false) // partial
    expect(tree.hasPath(['goods'])).toBe(false)
  })

  test('can check if prefix exists', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['services', 'food-services', 'catering'])
    expect(tree.hasPrefix(['services'])).toBe(true)
    expect(tree.hasPrefix(['services', 'food-services'])).toBe(true)
    expect(tree.hasPrefix(['goods'])).toBe(false)
  })
})

describe('compareToTaxonomy - classifies new paths', () => {
  test('novel: no overlap with existing taxonomy', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['services', 'food-services', 'catering'])

    const result = compareToTaxonomy(tree, ['goods', 'food', 'produce'])

    expect(result.type).toBe('novel')
    if (result.type === 'novel') {
      expect(result.overlapDepth).toBe(0)
    }
  })

  test('exact-match: path already exists', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['services', 'food-services', 'catering'])

    const result = compareToTaxonomy(tree, ['services', 'food-services', 'catering'])

    expect(result.type).toBe('exact-match')
  })

  test('extension: new path is more specific than existing', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['services', 'food-services'])

    const result = compareToTaxonomy(tree, ['services', 'food-services', 'catering', 'corporate'])

    expect(result.type).toBe('extension')
    if (result.type === 'extension') {
      expect(result.existingPath).toEqual(['services', 'food-services'])
      expect(result.newSegments).toEqual(['catering', 'corporate'])
    }
  })

  test('generalization: new path is more generic (adds ancestor)', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['food-services', 'catering'])

    const result = compareToTaxonomy(tree, ['services', 'food-services', 'catering'])

    expect(result.type).toBe('generalization')
    if (result.type === 'generalization') {
      expect(result.existingPath).toEqual(['food-services', 'catering'])
      expect(result.newAncestors).toEqual(['services'])
    }
  })

  test('sibling: diverges from existing path', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['services', 'food-services', 'catering'])

    const result = compareToTaxonomy(tree, ['services', 'food-services', 'delivery'])

    expect(result.type).toBe('sibling')
    if (result.type === 'sibling') {
      expect(result.commonPrefix).toEqual(['services', 'food-services'])
      expect(result.existingBranch).toBe('catering')
      expect(result.newBranch).toBe('delivery')
    }
  })

  test('partial-overlap: shares some nodes but different structure', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['services', 'professional-services', 'consulting'])

    // Same root, but "food-services" diverges from "professional-services"
    const result = compareToTaxonomy(tree, ['services', 'food-services', 'catering'])

    expect(result.type).toBe('sibling')
    if (result.type === 'sibling') {
      expect(result.commonPrefix).toEqual(['services'])
    }
  })
})

describe('mergePath - integrates new paths', () => {
  test('merge novel path adds it directly', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['services', 'food-services'])

    mergePath(tree, ['goods', 'food', 'produce'])

    expect(tree.getAllPaths()).toContainEqual(['services', 'food-services'])
    expect(tree.getAllPaths()).toContainEqual(['goods', 'food', 'produce'])
  })

  test('merge exact-match is a no-op', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['services', 'food-services', 'catering'])

    mergePath(tree, ['services', 'food-services', 'catering'])

    expect(tree.getAllPaths()).toEqual([
      ['services', 'food-services', 'catering'],
    ])
  })

  test('merge extension extends existing path', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['services', 'food-services'])

    mergePath(tree, ['services', 'food-services', 'catering'])

    // The existing path is replaced by the more specific one
    expect(tree.getAllPaths()).toEqual([
      ['services', 'food-services', 'catering'],
    ])
  })

  test('merge sibling adds as separate leaf', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['services', 'food-services', 'catering'])

    mergePath(tree, ['services', 'food-services', 'delivery'])

    // Both paths exist as separate branches
    expect(tree.getAllPaths()).toContainEqual(['services', 'food-services', 'catering'])
    expect(tree.getAllPaths()).toContainEqual(['services', 'food-services', 'delivery'])
  })

  test('merge generalization re-roots existing path', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['food-services', 'catering'])

    mergePath(tree, ['services', 'food-services', 'catering'])

    // The existing path should now have the new ancestor
    expect(tree.getAllPaths()).toEqual([
      ['services', 'food-services', 'catering'],
    ])
  })
})

describe('real-world scenarios from treemap', () => {
  test('food-services appearing in multiple places', () => {
    // Current problem: "food-services" appears under both "services" and "creative-services"
    const tree = new TaxonomyTree()
    tree.addPath(['services', 'professional-services', 'food-services', 'catering'])

    // New path places food-services differently
    const result = compareToTaxonomy(tree, ['creative-services', 'food-services', 'catering'])

    // This should be detected as a conflict or require disambiguation
    expect(result.type).toBe('conflict')
    if (result.type === 'conflict') {
      expect(result.conflictingNode).toBe('food-services')
      expect(result.existingLocation).toEqual(['services', 'professional-services', 'food-services'])
      expect(result.proposedLocation).toEqual(['creative-services', 'food-services'])
    }
  })

  test('same leaf, different intermediate categories', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['goods', 'food', 'baked-goods'])

    // New path: same leaf but via different intermediate
    const result = compareToTaxonomy(tree, ['services', 'food-services', 'baked-goods'])

    // "baked-goods" appears in both - might be legitimate (goods vs services)
    // or might be a naming collision
    expect(result.type).toBe('ambiguous')
    if (result.type === 'ambiguous') {
      expect(result.sharedNode).toBe('baked-goods')
    }
  })

  test('consolidating fragmented creative-services', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['creative-services', 'music'])
    tree.addPath(['services', 'creative-services', 'audio-production'])

    // Both have creative-services but at different depths
    // This IS a conflict - "creative-services" is at depth 1 in one path, depth 2 in another
    const result = compareToTaxonomy(tree, ['creative-services', 'photography'])

    // The new path matches the first existing path's structure (creative-services at root)
    // So it should be a sibling of 'music', not a conflict
    expect(result.type).toBe('sibling')
    if (result.type === 'sibling') {
      expect(result.commonPrefix).toEqual(['creative-services'])
    }
  })
})

describe('real conflict patterns from enriched-examples', () => {
  test('root inconsistency: food as root vs nested under goods', () => {
    const tree = new TaxonomyTree()
    // First chain roots at "goods"
    tree.addPath(['goods', 'food', 'ingredients', 'flour'])

    // Second chain roots at "food" directly
    const result = compareToTaxonomy(tree, ['food', 'ingredients', 'baking-ingredients', 'flour'])

    // "food" exists at depth 1, but new path has it at depth 0
    expect(result.type).toBe('conflict')
    if (result.type === 'conflict') {
      expect(result.conflictingNode).toBe('food')
      expect(result.existingLocation).toEqual(['goods', 'food'])
      expect(result.proposedLocation).toEqual(['food'])
    }
  })

  test('same item categorized as service vs product', () => {
    const tree = new TaxonomyTree()
    // Lawnmower as equipment (product)
    tree.addPath(['item', 'equipment', 'outdoor-equipment', 'lawnmower'])

    // Lawnmower sharing as a service
    const result = compareToTaxonomy(
      tree,
      ['services', 'equipment-sharing', 'outdoor-equipment', 'lawnmower']
    )

    // outdoor-equipment at different depths
    expect(result.type).toBe('conflict')
    if (result.type === 'conflict') {
      expect(result.conflictingNode).toBe('outdoor-equipment')
    }
  })

  test('entity flattening: service-provider as root vs nested under person', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['person', 'professional', 'service-provider', 'coach'])

    // Flattened version starts at service-provider
    const result = compareToTaxonomy(
      tree,
      ['service-provider', 'creative-professional', 'photographer']
    )

    expect(result.type).toBe('conflict')
    if (result.type === 'conflict') {
      expect(result.conflictingNode).toBe('service-provider')
    }
  })

  test('domain crossover: music under services vs under arts', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['services', 'creative-services', 'music', 'lessons'])

    // Music categorized under arts instead of services
    const result = compareToTaxonomy(tree, ['arts', 'music', 'experimental-music'])

    expect(result.type).toBe('conflict')
    if (result.type === 'conflict') {
      expect(result.conflictingNode).toBe('music')
    }
  })
})

describe('conflict resolution: deeper root wins', () => {
  test('re-roots shallow path under deeper existing ancestry', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['goods', 'food', 'ingredients'])

    // New path has "food" at root - shallower
    const newPath = ['food', 'ingredients', 'flour']
    const result = compareToTaxonomy(tree, newPath)

    expect(result.type).toBe('conflict')

    // Resolution: re-root under the deeper ancestry
    const resolved = resolveConflict(tree, newPath, result as ConflictResult)

    // ['food', 'ingredients', 'flour'] becomes ['goods', 'food', 'ingredients', 'flour']
    expect(resolved).toEqual(['goods', 'food', 'ingredients', 'flour'])
  })

  test('keeps new path if it has deeper ancestry than existing', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['food', 'ingredients'])

    // New path has deeper ancestry for "food"
    const newPath = ['goods', 'food', 'ingredients', 'flour']
    const result = compareToTaxonomy(tree, newPath)

    // This should be a generalization, not a conflict
    // But if detected as conflict, the deeper one should win
    if (result.type === 'conflict') {
      const resolved = resolveConflict(tree, newPath, result as ConflictResult)
      expect(resolved).toEqual(['goods', 'food', 'ingredients', 'flour'])
    }
  })

  test('handles multiple ancestors in existing path', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['entity', 'person', 'professional', 'service-provider', 'coach'])

    // Shallow path starting at service-provider
    const newPath = ['service-provider', 'creative-professional', 'photographer']
    const result = compareToTaxonomy(tree, newPath)

    expect(result.type).toBe('conflict')

    const resolved = resolveConflict(tree, newPath, result as ConflictResult)

    // Should re-root under entity > person > professional
    expect(resolved).toEqual([
      'entity', 'person', 'professional', 'service-provider', 'creative-professional', 'photographer'
    ])
  })

  test('merges divergent suffixes after re-rooting', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['services', 'creative-services', 'music', 'lessons'])

    // New path with music at different depth
    const newPath = ['arts', 'music', 'experimental']
    const result = compareToTaxonomy(tree, newPath)

    expect(result.type).toBe('conflict')

    // When the conflicting node has different ancestors in both paths,
    // prefer the one that's already in the tree (existing wins)
    const resolved = resolveConflict(tree, newPath, result as ConflictResult)

    // 'music' exists at services > creative-services > music
    // So ['arts', 'music', 'experimental'] becomes
    // ['services', 'creative-services', 'music', 'experimental']
    expect(resolved).toEqual(['services', 'creative-services', 'music', 'experimental'])
  })
})
