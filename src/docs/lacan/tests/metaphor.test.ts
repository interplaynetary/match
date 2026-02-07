import { describe, test, expect } from 'bun:test';
import { substitute, createSymbolicSpace, createStreamingChain, quilt } from '../operations';
import type { Signifier } from '../core';

describe('Metaphor - The Vertical Axis', () => {
  const createSignifier = (
    id: string,
    features: Array<[string, any]> = []
  ): Signifier => ({
    id,
    acoustic: id.split(''),
    features: features.map(([dimension, value]) => ({ dimension, value })),
    negations: [],
  });

  test('substitution within similarity threshold: normal replacement', () => {
    const dog = createSignifier('dog', [['animal', true], ['domestic', true]]);
    const cat = createSignifier('cat', [['animal', true], ['domestic', true]]);
    
    const streamingChain = createStreamingChain([dog, dog, dog]);
    const chain = quilt(streamingChain, 1);

    const result = substitute(dog, cat, chain, 0, 0.4);

    // High similarity = SUBSTITUTION cost (not metaphoric)
    expect(result.cost).toBe('SUBSTITUTION');
    expect(result.chain.signifiers[0].id).toBe('cat');
  });

  test('substitution violating similarity: metaphor creation', () => {
    const man = createSignifier('man', [['human', true], ['gender', 'masculine']]);
    const lion = createSignifier('lion', [['animal', true], ['fierce', true]]);
    
    const streamingChain = createStreamingChain([man, man, man]);
    const chain = quilt(streamingChain, 1);

    const result = substitute(man, lion, chain, 0, 0.6);

    // Low similarity = METAPHORIC cost ("Achilles is a lion")
    expect(result.cost).toBe('METAPHORIC');
    expect(result.chain.signifiers[0].id).toBe('lion');
  });

  test('metaphor creates new meaning: semantic condensation', () => {
    // "Juliet is the sun" - metaphoric substitution
    const juliet = createSignifier('juliet', [
      ['human', true],
      ['beloved', true],
      ['female', true],
    ]);
    const sun = createSignifier('sun', [
      ['celestial', true],
      ['bright', true],
      ['life-giving', true],
    ]);

    const streamingChain = createStreamingChain([juliet]);
    const chain = quilt(streamingChain, 0);

    const result = substitute(juliet, sun, chain, 0, 0.5);

    // Creates new meaning through violation of semantic field
    expect(result.cost).toBe('METAPHORIC');
    
    // Transfer of features: Juliet inherits sun's luminosity
    expect(result.chain.signifiers[0].id).toBe('sun');
  });

  test('context determines metaphoric vs literal reading', () => {
    const night = createSignifier('night', [['darkness', true], ['time', true]]);
    const day = createSignifier('day', [['light', true], ['time', true]]);
    const lamp = createSignifier('lamp', [['light', true], ['object', true]]);

    // Context: temporal sequence
    const temporalChain = quilt(createStreamingChain([night, day, night]), 1);
    
    // Substitute day with lamp
    const result = substitute(day, lamp, temporalChain, 1, 0.5);

    // Semantic violation in temporal context
    expect(result.cost).toBe('METAPHORIC');
  });

  test('poetic metaphor: semantic distance creates meaning', () => {
    // "My love is a red red rose" - cross-domain mapping
    const love = createSignifier('love', [
      ['emotion', true],
      ['abstract', true],
      ['intense', true],
    ]);
    const rose = createSignifier('rose', [
      ['plant', true],
      ['concrete', true],
      ['red', true],
      ['beautiful', true],
    ]);

    const chain = quilt(createStreamingChain([love, love]), 1);
    const result = substitute(love, rose, chain, 0, 0.5);

    // Metaphoric leap across semantic domains
    expect(result.cost).toBe('METAPHORIC');
    
    // Creates new compound meaning (love + rose features)
    expect(result.chain.signifiers[0].features.some(
      f => f.dimension === 'concrete' && f.value === true
    )).toBe(true);
  });

  test('symptom as metaphor: body speaks unconscious', () => {
    // Physical symptom metaphorically represents psychic conflict
    const anxiety = createSignifier('anxiety', [
      ['psychic', true],
      ['conflict', true],
    ]);
    const paralysis = createSignifier('paralysis', [
      ['somatic', true],
      ['immobility', true],
    ]);

    const chain = quilt(createStreamingChain([anxiety]), 0);
    const result = substitute(anxiety, paralysis, chain, 0, 0.5);

    // Metaphoric conversion: psyche → soma
    expect(result.cost).toBe('METAPHORIC');
    
    // Symptom = metaphor of the unconscious
    expect(result.chain.signifiers[0].id).toBe('paralysis');
  });
});
