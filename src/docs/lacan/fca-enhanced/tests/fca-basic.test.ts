/**
 * Enhanced Lacanian FCA - Basic FCA Tests
 * 
 * Tests for standard Formal Concept Analysis operations
 */

import { describe, test, expect } from 'bun:test';
import type { Signifier, Feature, TemporalContext } from '../core';
import { featureKey } from '../core';
import {
  extent,
  intent,
  isConcept,
  conceptFromFeatures,
  computeAllConcepts,
  computeConceptLattice,
  meet,
  join,
  conceptOrder,
} from '../fca-operations';
import { createTemporalContext } from '../enhanced-operations';

// Helper: Create test signifiers
function createSignifier(
  id: string,
  features: Array<[string, any]>,
  negations: Array<[string, any]> = []
): Signifier {
  return {
    id,
    acoustic: id.split(''),
    features: features.map(([dimension, value]) => ({ dimension, value })),
    negations: negations.map(([dimension, value]) => ({ dimension, value })),
  };
}

describe('FCA Basic Operations', () => {
  test('extent operator returns signifiers with all features', () => {
    const mammal: Feature = { dimension: 'class', value: 'mammal' };
    const flies: Feature = { dimension: 'ability', value: 'flies' };
    
    const bat = createSignifier('bat', [['class', 'mammal'], ['ability', 'flies']]);
    const bird = createSignifier('bird', [['class', 'bird'], ['ability', 'flies']]);
    const dog = createSignifier('dog', [['class', 'mammal']]);
    
    const context = createTemporalContext(
      [bat, bird, dog],
      [mammal, flies]
    );
    
    // extent({mammal}) should return {bat, dog}
    const ext = extent([mammal], context);
    expect(ext).toContain('bat');
    expect(ext).toContain('dog');
    expect(ext).not.toContain('bird');
    
    // extent({flies}) should return {bat, bird}
    const extFlies = extent([flies], context);
    expect(extFlies).toContain('bat');
    expect(extFlies).toContain('bird');
    expect(extFlies).not.toContain('dog');
    
    // extent({mammal, flies}) should return {bat}
    const extBoth = extent([mammal, flies], context);
    expect(extBoth).toEqual(['bat']);
  });
  
  test('intent operator returns features shared by all signifiers', () => {
    const bat = createSignifier('bat', [
      ['class', 'mammal'],
      ['ability', 'flies'],
      ['warm_blooded', true],
    ]);
    const dog = createSignifier('dog', [
      ['class', 'mammal'],
      ['warm_blooded', true],
    ]);
    
    const context = createTemporalContext([bat, dog], []);
    
    const int = intent(['bat', 'dog'], context);
    
    // Should have mammal and warm_blooded (shared)
    expect(int.some(f => f.dimension === 'class' && f.value === 'mammal')).toBe(true);
    expect(int.some(f => f.dimension === 'warm_blooded' && f.value === true)).toBe(true);
    
    // Should NOT have 'flies' (not shared)
    expect(int.some(f => f.dimension === 'ability' && f.value === 'flies')).toBe(false);
  });
  
  test('Galois connection: extent -> intent -> extent is closure', () => {
    const s1 = createSignifier('s1', [['a', 1], ['b', 2]]);
    const s2 = createSignifier('s2', [['a', 1]]);
    const s3 = createSignifier('s3', [['b', 2]]);
    
    const context = createTemporalContext([s1, s2, s3], []);
    
    // Start with {s1}
    const int1 = intent(['s1'], context);
    const ext2 = extent(int1, context);
    
    // Should close to {s1} (only s1 has both a and b)
    expect(ext2).toEqual(['s1']);
    
    // Start with {s1, s2}
    const int2 = intent(['s1', 's2'], context);
    const ext3 = extent(int2, context);
    
    // Should close to {s1, s2} (both have 'a')
    expect(ext3).toContain('s1');
    expect(ext3).toContain('s2');
    expect(ext3.length).toBe(2);
  });
  
  test('formal concept satisfies closure property', () => {
    const s1 = createSignifier('s1', [['feature', 'A']]);
    const s2 = createSignifier('s2', [['feature', 'A']]);
    const s3 = createSignifier('s3', [['feature', 'B']]);
    
    const context = createTemporalContext([s1, s2, s3], []);
    
    const concept = conceptFromFeatures([{ dimension: 'feature', value: 'A' }], context);
    
    // Check closure: A' = B and B' = A
    expect(isConcept(concept.extent, concept.intent, context)).toBe(true);
  });
  
  test('compute all concepts generates complete lattice', () => {
    const s1 = createSignifier('s1', [['f', 'a']]);
    const s2 = createSignifier('s2', [['f', 'b']]);
    
    const context = createTemporalContext([s1, s2], []);
    
    const concepts = computeAllConcepts(context);
    
    // Should have at least: top (all objects, no features), bottom (no objects, all features)
    // and concepts for each feature
    expect(concepts.length).toBeGreaterThanOrEqual(2);
  });
  
  test('concept lattice has top and bottom elements', () => {
    const s1 = createSignifier('s1', [['a', 1]]);
    const s2 = createSignifier('s2', [['b', 2]]);
    
    const context = createTemporalContext([s1, s2], []);
    
    const lattice = computeConceptLattice(context);
    
    expect(lattice.top).toBeTruthy();
    expect(lattice.bottom).toBeTruthy();
    
    // Top should have largest extent
    const topConcept = lattice.concepts.find(c => 
      `[${c.extent.join(',')}]` === lattice.top
    );
    expect(topConcept).toBeTruthy();
  });
  
  test('meet operation produces greatest lower bound', () => {
    const s1 = createSignifier('s1', [['a', 1], ['b', 2]]);
    const s2 = createSignifier('s2', [['a', 1]]);
    const s3 = createSignifier('s3', [['b', 2]]);
    
    const context = createTemporalContext([s1, s2, s3], []);
    
    const c1 = conceptFromFeatures([{ dimension: 'a', value: 1 }], context);
    const c2 = conceptFromFeatures([{ dimension: 'b', value: 2 }], context);
    
    const meetResult = meet(c1, c2, context);
    
    // Meet should have intersection of extents
    expect(meetResult.extent).toContain('s1');
    expect(meetResult.extent.length).toBe(1); // Only s1 has both features
  });
  
  test('join operation produces least upper bound', () => {
    const s1 = createSignifier('s1', [['a', 1]]);
    const s2 = createSignifier('s2', [['b', 2]]);
    
    const context = createTemporalContext([s1, s2], []);
    
    const c1 = conceptFromFeatures([{ dimension: 'a', value: 1 }], context);
    const c2 = conceptFromFeatures([{ dimension: 'b', value: 2 }], context);
    
    const joinResult = join(c1, c2, context);
    
    // Join should have union of extents (closed)
    expect(joinResult.extent.length).toBeGreaterThanOrEqual(c1.extent.length);
    expect(joinResult.extent.length).toBeGreaterThanOrEqual(c2.extent.length);
  });
  
  test('concept order is transitive', () => {
    const s1 = createSignifier('s1', [['a', 1], ['b', 2], ['c', 3]]);
    const s2 = createSignifier('s2', [['a', 1], ['b', 2]]);
    const s3 = createSignifier('s3', [['a', 1]]);
    
    const context = createTemporalContext([s1, s2, s3], []);
    
    const c1 = conceptFromFeatures([{ dimension: 'a', value: 1 }], context);
    const c2 = conceptFromFeatures([{ dimension: 'a', value: 1 }, { dimension: 'b', value: 2 }], context);
    const c3 = conceptFromFeatures([
      { dimension: 'a', value: 1 },
      { dimension: 'b', value: 2 },
      { dimension: 'c', value: 3 }
    ], context);
    
    // c3 ≤ c2 ≤ c1 (more features = smaller extent = lower in lattice)
    expect(conceptOrder(c3, c2)).toBe(true);
    expect(conceptOrder(c2, c1)).toBe(true);
    expect(conceptOrder(c3, c1)).toBe(true); // Transitivity
  });
});
