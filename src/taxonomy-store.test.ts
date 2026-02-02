import { describe, test, expect } from 'bun:test'
import { TaxonomyTree } from './taxonomy-merge'
import { serializeTaxonomy, deserializeTaxonomy } from './taxonomy-store'

describe('taxonomy serialization', () => {
  test('serializes empty tree', () => {
    const tree = new TaxonomyTree()
    const data = serializeTaxonomy(tree)

    expect(data.version).toBe(1)
    expect(data.paths).toEqual([])
  })

  test('serializes tree with single path', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['services', 'food-services', 'catering'])

    const data = serializeTaxonomy(tree)

    expect(data.version).toBe(1)
    expect(data.paths).toEqual([['services', 'food-services', 'catering']])
  })

  test('serializes tree with multiple paths', () => {
    const tree = new TaxonomyTree()
    tree.addPath(['services', 'food-services', 'catering'])
    tree.addPath(['goods', 'food', 'produce'])

    const data = serializeTaxonomy(tree)

    expect(data.version).toBe(1)
    expect(data.paths).toHaveLength(2)
    expect(data.paths).toContainEqual(['services', 'food-services', 'catering'])
    expect(data.paths).toContainEqual(['goods', 'food', 'produce'])
  })
})

describe('taxonomy deserialization', () => {
  test('deserializes empty paths', () => {
    const data = { version: 1 as const, paths: [] }
    const tree = deserializeTaxonomy(data)

    expect(tree.getAllPaths()).toEqual([])
  })

  test('deserializes single path', () => {
    const data = {
      version: 1 as const,
      paths: [['services', 'food-services', 'catering']],
    }
    const tree = deserializeTaxonomy(data)

    expect(tree.hasPath(['services', 'food-services', 'catering'])).toBe(true)
    expect(tree.getAllPaths()).toEqual([['services', 'food-services', 'catering']])
  })

  test('deserializes multiple paths', () => {
    const data = {
      version: 1 as const,
      paths: [
        ['services', 'food-services', 'catering'],
        ['goods', 'food', 'produce'],
      ],
    }
    const tree = deserializeTaxonomy(data)

    expect(tree.hasPath(['services', 'food-services', 'catering'])).toBe(true)
    expect(tree.hasPath(['goods', 'food', 'produce'])).toBe(true)
    expect(tree.getAllPaths()).toHaveLength(2)
  })
})

describe('roundtrip serialization', () => {
  test('tree survives serialize/deserialize roundtrip', () => {
    const original = new TaxonomyTree()
    original.addPath(['services', 'food-services', 'catering'])
    original.addPath(['services', 'food-services', 'delivery'])
    original.addPath(['goods', 'food', 'produce'])

    const serialized = serializeTaxonomy(original)
    const restored = deserializeTaxonomy(serialized)

    expect(restored.getAllPaths()).toHaveLength(3)
    expect(restored.hasPath(['services', 'food-services', 'catering'])).toBe(true)
    expect(restored.hasPath(['services', 'food-services', 'delivery'])).toBe(true)
    expect(restored.hasPath(['goods', 'food', 'produce'])).toBe(true)
    expect(restored.hasPrefix(['services', 'food-services'])).toBe(true)
  })

  test('preserves tree structure through roundtrip', () => {
    const original = new TaxonomyTree()
    original.addPath(['a', 'b', 'c', 'd'])

    const restored = deserializeTaxonomy(serializeTaxonomy(original))

    expect(restored.hasPrefix(['a'])).toBe(true)
    expect(restored.hasPrefix(['a', 'b'])).toBe(true)
    expect(restored.hasPrefix(['a', 'b', 'c'])).toBe(true)
    expect(restored.hasPath(['a', 'b', 'c', 'd'])).toBe(true)
  })
})
