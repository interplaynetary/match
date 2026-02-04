import { describe, test, expect } from 'bun:test';
import { similarity, findSubstitutes, createSymbolicSpace } from '../operations';
import type { Signifier } from '../core';

describe('Similarity & Paradigmatic Operations', () => {
  const createSignifier = (
    id: string,
    features: Array<[string, any]>,
    negations: Array<[string, any]> = []
  ): Signifier => ({
    id,
    acoustic: id.split(''),
    features: features.map(([dimension, value]) => ({ dimension, value })),
    negations: negations.map(([dimension, value]) => ({ dimension, value })),
  });

  test('identical signifiers have maximum similarity', () => {
    const s1 = createSignifier('dog', [
      ['animal', true],
      ['domestic', true],
      ['size', 'medium'],
    ]);
    
    // Similarity = shared / (f1 + f2) = 3 / 6 = 0.5
    expect(similarity(s1, s1)).toBe(0.5);
  });

  test('differential value: signifiers differ only by position in feature space', () => {
    const father = createSignifier('father', [
      ['gender', 'masculine'],
      ['generation', 'parent'],
      ['authority', true],
    ]);

    const mother = createSignifier('mother', [
      ['gender', 'feminine'],
      ['generation', 'parent'],
      ['nurture', true],
    ]);

    const sim = similarity(father, mother);
    
    // Share 'generation' but differ on gender
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(0.5);
  });

  test('negations create structural opposition', () => {
    const masculine = createSignifier(
      'masculine',
      [['gender', 'masculine']],
      [['gender', 'feminine']]
    );

    const feminine = createSignifier(
      'feminine',
      [['gender', 'feminine']],
      [['gender', 'masculine']]
    );

    const sim = similarity(masculine, feminine);
    
    // High conflict penalty due to negations
    expect(sim).toBeLessThan(0.3);
  });

  test('paradigmatic substitution: high similarity enables replacement', () => {
    const space = createSymbolicSpace([
      createSignifier('cat', [['animal', true], ['domestic', true], ['size', 'small']]),
      createSignifier('dog', [['animal', true], ['domestic', true], ['size', 'medium']]),
      createSignifier('wolf', [['animal', true], ['wild', true], ['size', 'medium']]),
      createSignifier('car', [['vehicle', true], ['transport', true]]),
    ]);

    const dog = space.signifiers.find(s => s.id === 'dog')!;
    const substitutes = findSubstitutes(dog, space, 0.3);

    // Cat and wolf can substitute for dog (paradigmatic axis)
    // Car cannot (different semantic field)
    expect(substitutes.some(s => s.id === 'cat')).toBe(true);
    expect(substitutes.some(s => s.id === 'wolf')).toBe(true);
    expect(substitutes.some(s => s.id === 'car')).toBe(false);
  });

  test('Saussurean differential value: no positive terms', () => {
    // Value = position in system of differences, not intrinsic properties
    const red = createSignifier('red', [['color', 'red']]);
    const blue = createSignifier('blue', [['color', 'blue']]);
    const green = createSignifier('green', [['color', 'green']]);

    // Each color defined by what it is NOT
    expect(similarity(red, blue)).toBeLessThan(similarity(red, red));
    expect(similarity(red, green)).toBeLessThan(similarity(red, red));
    
    // No color is "positive" - all are differential positions
    expect(red.features.length).toBe(blue.features.length);
  });
});
