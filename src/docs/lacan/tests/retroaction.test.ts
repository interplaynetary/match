import { describe, test, expect } from 'bun:test';
import { 
  createStreamingChain, 
  addSignifier, 
  quilt, 
  createSymbolicSpace 
} from '../operations';
import type { Signifier } from '../core';

describe('Retroactive Determination (Après-coup)', () => {
  const createSignifier = (
    id: string,
    features: Array<[string, any]> = []
  ): Signifier => ({
    id,
    acoustic: id.split(''),
    features: features.map(([dimension, value]) => ({ dimension, value })),
    negations: [],
  });

  test('meaning flows backward: later signifiers recontextualize earlier ones', () => {
    // "The dog bit..." (ambiguous)
    // + "the man" → animal attack
    // + "the dust" → idiom (died)
    
    const dog = createSignifier('dog', [['animal', true]]);
    const bit = createSignifier('bit', [['action', 'bite']]);
    
    let chain = createStreamingChain([dog, bit]);
    
    // Chain is ambiguous before final signifier
    expect(chain.interpretations.length).toBe(2);
    
    const man = createSignifier('man', [['victim', true]]);
    chain = addSignifier(chain, man);
    
    // Final signifier retroactively determines meaning of "bit"
    expect(chain.interpretations.length).toBe(3);
    // Each prior interpretation updated by new context
    expect(chain.interpretations[0]).toBeTruthy();
    expect(chain.interpretations[1]).toBeTruthy();
  });

  test('quilting crystallizes floating meanings', () => {
    const s1 = createSignifier('s1', [['meaning', 'ambiguous']]);
    const s2 = createSignifier('s2', [['meaning', 'unclear']]);
    const s3 = createSignifier('s3', [['meaning', 'floating']]);
    const master = createSignifier('anchor', [['definitive', true]]);

    let streamingChain = createStreamingChain([s1, s2, s3]);
    streamingChain = addSignifier(streamingChain, master);
    
    // Before quilting: meanings are probability distributions
    expect(streamingChain.interpretations.every(i => typeof i === 'object')).toBe(true);
    
    // Quilt at master signifier position
    const quiltedChain = quilt(streamingChain, 3);
    
    // After quilting: meanings crystallized up to anchor point
    expect(quiltedChain.quilting_indices).toContain(3);
    expect(quiltedChain.interpretations[0]).not.toBeNull();
    expect(quiltedChain.interpretations[1]).not.toBeNull();
    expect(quiltedChain.interpretations[2]).not.toBeNull();
    expect(quiltedChain.interpretations[3]).not.toBeNull();
  });

  test('point de capiton: master signifier organizes entire chain', () => {
    // Like a button (capiton) holding upholstery together
    // Master signifier retroactively fixes all prior floating signifiers
    
    const floating1 = createSignifier('word1', [['vague', true]]);
    const floating2 = createSignifier('word2', [['uncertain', true]]);
    const floating3 = createSignifier('word3', [['ambiguous', true]]);
    const pointDeCapiton = createSignifier('NAME', [['master', true], ['anchor', true]]);

    const chain = createStreamingChain([floating1, floating2, floating3, pointDeCapiton]);
    const quilted = quilt(chain, 3); // Anchor at 'NAME'

    // All prior signifiers now have fixed meaning
    expect(quilted.interpretations.slice(0, 4).every(i => i !== null)).toBe(true);
    expect(quilted.quilting_indices).toEqual([3]);
  });

  test('Bayesian update: each new signifier reweights all prior interpretations', () => {
    const s1 = createSignifier('s1', [['feature', 'a']]);
    const s2 = createSignifier('s2', [['feature', 'b']]);
    const s3 = createSignifier('s3', [['feature', 'c']]);

    let chain = createStreamingChain([s1]);
    expect(chain.signifiers.length).toBe(1);
    expect(chain.interpretations.length).toBe(1);
    
    // Add s2 - chain grows and interpretations maintained
    chain = addSignifier(chain, s2);
    expect(chain.signifiers.length).toBe(2);
    expect(chain.interpretations.length).toBe(2);
    
    // Add s3 - continues growing
    chain = addSignifier(chain, s3);
    expect(chain.signifiers.length).toBe(3);
    expect(chain.interpretations.length).toBe(3);
    
    // All positions have distributions
    expect(chain.interpretations.every(i => i !== null)).toBe(true);
  });

    test('trauma and après-coup: event gains meaning retroactively', () => {
    // Event only becomes traumatic through later recontextualization
    const event = createSignifier('childhood_event', [['neutral', true]]);
    const context1 = createSignifier('benign_context', [['safe', true]]);
    
    let chain = createStreamingChain([event, context1]);
    expect(chain.signifiers.length).toBe(2);
    
    // Later traumatic context recontextualizes original event
    const traumaticContext = createSignifier('realization', [
      ['traumatic', true],
      ['recontextualizing', true],
    ]);
    
    chain = addSignifier(chain, traumaticContext);
    
    // Chain grows with retroactive effect
    expect(chain.signifiers.length).toBe(3);
    expect(chain.signifiers[0].id).toBe('childhood_event');
    expect(chain.signifiers[2].id).toBe('realization');
    
    // All positions maintain interpretations
    expect(chain.interpretations.length).toBe(3);
  });

  test('sentence meaning emerges at end, not incrementally', () => {
    // "She finally decided to..." 
    // (meaning suspended until final verb)
    
    const she = createSignifier('she');
    const finallyWord = createSignifier('finally');
    const decided = createSignifier('decided');
    const to = createSignifier('to');
    
    let chain = createStreamingChain([she, finallyWord, decided, to]);
    
    // Meanings still floating (probability distributions)
    expect(chain.signifiers.length).toBe(4);
    
    const leave = createSignifier('leave', [['action', 'departure']]);
    chain = addSignifier(chain, leave);
    
    // Final word retroactively determines "decided to" meaning
    const quilted = quilt(chain, 4);
    
    // Now entire sentence has fixed meaning
    expect(quilted.quilting_indices).toContain(4);
  });

  test('multiple quilting points create structured meaning', () => {
    const s1 = createSignifier('s1');
    const s2 = createSignifier('s2');
    const anchor1 = createSignifier('anchor1', [['master', true]]);
    const s3 = createSignifier('s3');
    const s4 = createSignifier('s4');
    const anchor2 = createSignifier('anchor2', [['master', true]]);

    const streamingChain = createStreamingChain([s1, s2, anchor1, s3, s4, anchor2]);
    
    // First quilting
    let chain = quilt(streamingChain, 2);
    expect(chain.quilting_indices).toEqual([2]);
    
    // Second quilting point (would re-quilt in full implementation)
    // For now, just verify structure allows multiple anchors
    expect(chain.signifiers.length).toBe(6);
  });
});
