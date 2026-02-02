/**
 * Enhanced Lacanian FCA - Temporal & Quilting Tests
 * 
 * Tests for temporal dynamics, Bayesian updates, and quilting
 */

import { describe, test, expect } from 'bun:test';
import type { Signifier } from '../core';
import {
  createTemporalContext,
  addSignifierTemporal,
  quilt,
  isQuilted,
  distributionEntropy,
  getQuiltRelativeConcepts,
  metonymicSlide,
  addSyntagmaticEdge,
} from '../enhanced-operations';

function createSignifier(
  id: string,
  features: Array<[string, any]>
): Signifier {
  return {
    id,
    acoustic: id.split(''),
    features: features.map(([dimension, value]) => ({ dimension, value })),
    negations: [],
  };
}

describe('Temporal Operations', () => {
  test('adding signifier increments time', () => {
    const s1 = createSignifier('s1', [['a', 1]]);
    const s2 = createSignifier('s2', [['b', 2]]);
    
    let context = createTemporalContext([s1], []);
    expect(context.t).toBe(0);
    expect(context.signifiers.length).toBe(1);
    
    context = addSignifierTemporal(context, s2);
    expect(context.t).toBe(1);
    expect(context.signifiers.length).toBe(2);
  });
  
  test('signifiers accumulate over time', () => {
    const s1 = createSignifier('s1', [['a', 1]]);
    const s2 = createSignifier('s2', [['b', 2]]);
    const s3 = createSignifier('s3', [['c', 3]]);
    
    let context = createTemporalContext([s1], []);
    
    context = addSignifierTemporal(context, s2);
    expect(context.signifiers.map(s => s.id)).toEqual(['s1', 's2']);
    
    context = addSignifierTemporal(context, s3);
    expect(context.signifiers.map(s => s.id)).toEqual(['s1', 's2', 's3']);
  });
  
  test('distributions are created for new signifiers', () => {
    const s1 = createSignifier('s1', [['a', 1]]);
    const s2 = createSignifier('s2', [['b', 2]]);
    
    let context = createTemporalContext([s1], []);
    expect(context.distributions['s1']).toBeTruthy();
    
    context = addSignifierTemporal(context, s2);
    expect(context.distributions['s2']).toBeTruthy();
    expect(Object.keys(context.distributions)).toEqual(['s1', 's2']);
  });
});

describe('Quilting Operations', () => {
  test('quilting adds to quilting points', () => {
    const s1 = createSignifier('s1', [['a', 1]]);
    const s2 = createSignifier('s2', [['b', 2]]);
    
    let context = createTemporalContext([s1], []);
    context = addSignifierTemporal(context, s2);
    
    expect(context.quilting).toEqual([]);
    
    context = quilt(context, 1);
    expect(context.quilting).toEqual([1]);
  });
  
  test('quilting collapses distributions', () => {
    const s1 = createSignifier('s1', [['a', 1]]);
    const s2 = createSignifier('s2', [['a', 1]]);
    
    let context = createTemporalContext([s1], []);
    context = addSignifierTemporal(context, s2);
    
    const beforeEntropy = distributionEntropy(context.distributions['s1']);
    
    context = quilt(context, 1);
    
    const afterEntropy = distributionEntropy(context.distributions['s1']);
    
    // Entropy should decrease (or stay same if already collapsed)
    expect(afterEntropy).toBeLessThanOrEqual(beforeEntropy);
  });
  
  test('isQuilted  checks quilting status', () => {
    const s1 = createSignifier('s1', [['a', 1]]);
    let context = createTemporalContext([s1], []);
    
    expect(isQuilted(context, 0)).toBe(false);
    
    context = quilt(context, 0);
    expect(isQuilted(context, 0)).toBe(true);
  });
  
  test('quilt-relative concepts have probabilities', () => {
    const s1 = createSignifier('s1', [['feature', 'A']]);
    const s2 = createSignifier('s2', [['feature', 'A']]);
    
    let context = createTemporalContext([s1, s2], []);
    context = quilt(context, 0);
    
    const concepts = getQuiltRelativeConcepts(context);
    
    expect(concepts.length).toBeGreaterThan(0);
    concepts.forEach(c => {
      expect(c.probability).toBeGreaterThanOrEqual(0);
      expect(c.probability).toBeLessThanOrEqual(1);
      expect(c.t).toBe(context.t);
    });
  });
  
  test('cannot quilt future time', () => {
    const s1 = createSignifier('s1', [['a', 1]]);
    const context = createTemporalContext([s1], []);
    
    expect(() => quilt(context, 5)).toThrow();
  });
});

describe('Syntagmatic Operations', () => {
  test('metonymic slide traverses graph', () => {
    const s1 = createSignifier('s1', [['a', 1]]);
    const s2 = createSignifier('s2', [['b', 2]]);
    const s3 = createSignifier('s3', [['c', 3]]);
    
    let context = createTemporalContext([s1, s2, s3], []);
    
    // Create chain: s1 -> s2 -> s3
    context = addSyntagmaticEdge(context, 's1', 's2');
    context = addSyntagmaticEdge(context, 's2', 's3');
    
    const path = metonymicSlide(context, 's1', 5);
    
    expect(path[0]).toBe('s1');
    expect(path[1]).toBe('s2');
    expect(path[2]).toBe('s3');
  });
  
  test('metonymic slide stops at dead end', () => {
    const s1 = createSignifier('s1', [['a', 1]]);
    const s2 = createSignifier('s2', [['b', 2]]);
    
    let context = createTemporalContext([s1, s2], []);
    context = addSyntagmaticEdge(context, 's1', 's2');
    // s2 has no outgoing edges
    
    const path = metonymicSlide(context, 's1', 10);
    
    expect(path.length).toBe(2); // Stops at s2
    expect(path).toEqual(['s1', 's2']);
  });
  
  test('syntagmatic edges can be added', () => {
    const s1 = createSignifier('s1', [['a', 1]]);
    const s2 = createSignifier('s2', [['b', 2]]);
    
    let context = createTemporalContext([s1, s2], []);
    
    expect(context.syntagmatic['s1']).toBeUndefined();
    
    context = addSyntagmaticEdge(context, 's1', 's2');
    
    expect(context.syntagmatic['s1']).toContain('s2');
  });
});

describe('Integration: Temporal + Quilting + Syntagmatic', () => {
  test('complete workflow: build chain, quilt, analyze', () => {
    const dog = createSignifier('dog', [['animal', true]]);
    const bit = createSignifier('bit', [['action', 'bite']]);
    const the = createSignifier('the', [['determiner', true]]);
    const dust = createSignifier('dust', [['matter', true]]);
    
    // Start chain
    let context = createTemporalContext([dog], []);
    expect(context.t).toBe(0);
    
    // Add signifiers over time
    context = addSignifierTemporal(context, bit);
    context = addSignifierTemporal(context, the);
    context = addSignifierTemporal(context, dust);
    
    expect(context.t).toBe(3);
    expect(context.signifiers.length).toBe(4);
    
    // Add syntagmatic structure (linear chain)
    context = addSyntagmaticEdge(context, 'dog', 'bit');
    context = addSyntagmaticEdge(context, 'bit', 'the');
    context = addSyntagmaticEdge(context, 'the', 'dust');
    
    // Quilt at "dust" (end of phrase)
    context = quilt(context, 3);
    
    expect(isQuilted(context, 3)).toBe(true);
    
    // Get quilt-relative concepts
    const concepts = getQuiltRelativeConcepts(context);
    expect(concepts.length).toBeGreaterThan(0);
    
    // All concepts should have quilting point
    concepts.forEach(c => {
      expect(c.quiltingPoint).toBe(3);
    });
    
    // Traverse syntagmatic chain
    const path = metonymicSlide(context, 'dog', 10);
    expect(path).toEqual(['dog', 'bit', 'the', 'dust']);
  });
});
