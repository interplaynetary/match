import { describe, test, expect } from 'bun:test';
import {
  representSubject,
  findSubjectPositions,
  isSubjectPositionQuilted,
  createStreamingChain,
  quilt,
} from '../operations';
import type { Signifier } from '../core';

describe('Subject Structure - $ (Barred Subject)', () => {
  const createSignifier = (
    id: string,
    features: Array<[string, any]> = []
  ): Signifier => ({
    id,
    acoustic: id.split(''),
    features: features.map(([dimension, value]) => ({ dimension, value })),
    negations: [],
  });

  test('subject is not a signifier but gap between signifiers', () => {
    const s1 = createSignifier('S1');
    const s2 = createSignifier('S2');
    const s3 = createSignifier('S3');

    const chain = quilt(createStreamingChain([s1, s2, s3]), 1);
    const positions = findSubjectPositions(chain);

    // Subject appears in gaps, not in signifiers themselves
    expect(positions.length).toBe(2); // Two gaps: S1-S2, S2-S3
    expect(positions.every(p => p.value === null)).toBe(true); // ⊥ (bottom)
  });

  test('S1 represents subject for S2', () => {
    const S1 = createSignifier('S1', [['master', true]]);
    const S2 = createSignifier('S2', [['knowledge', true]]);

    const chain = quilt(createStreamingChain([S1, S2]), 0);
    const subjectPos = representSubject(S1, chain);

    // Subject emerges in gap between S1 and S2
    expect(subjectPos).not.toBeNull();
    expect(subjectPos!.between).toEqual([0, 1]);
    expect(subjectPos!.value).toBeNull(); // Structural void
  });

  test('subject position has no content: bottom type ⊥', () => {
    const s1 = createSignifier('s1');
    const s2 = createSignifier('s2');

    const chain = quilt(createStreamingChain([s1, s2]), 0);
    const position = representSubject(s1, chain);

    // Subject = void, not representable content
    expect(position).not.toBeNull();
    expect(position!.value).toBeNull();
    
    // TypeScript type system: value is always null (⊥)
    const val: null = position!.value;
    expect(val).toBeNull();
  });

  test('multiple subject positions in longer chains', () => {
    const signifiers = Array.from({ length: 5 }, (_, i) =>
      createSignifier(`S${i}`)
    );

    const chain = quilt(createStreamingChain(signifiers), 2);
    const positions = findSubjectPositions(chain);

    // n signifiers → n-1 gaps (subject positions)
    expect(positions.length).toBe(4);
    expect(positions[0].between).toEqual([0, 1]);
    expect(positions[1].between).toEqual([1, 2]);
    expect(positions[2].between).toEqual([2, 3]);
    expect(positions[3].between).toEqual([3, 4]);
  });

  test('quilted vs unquilted subject positions', () => {
    const s1 = createSignifier('s1');
    const s2 = createSignifier('s2');
    const anchor = createSignifier('anchor');
    const s3 = createSignifier('s3');

    const chain = quilt(createStreamingChain([s1, s2, anchor, s3]), 2);
    const positions = findSubjectPositions(chain);

    // Positions before anchor are quilted (meaning fixed)
    const pos1 = positions[0]; // Between s1-s2
    const pos2 = positions[1]; // Between s2-anchor
    const pos3 = positions[2]; // Between anchor-s3

    expect(isSubjectPositionQuilted(pos1, chain)).toBe(true);
    expect(isSubjectPositionQuilted(pos2, chain)).toBe(true);
    expect(isSubjectPositionQuilted(pos3, chain)).toBe(false); // After anchor
  });

  test('subject caused by signifier, never fully represented', () => {
    // Subject emerges as effect of signification but remains unrepresentable
    const S1 = createSignifier('I', [['pronoun', true]]);
    const S2 = createSignifier('am', [['being', true]]);

    const chain = quilt(createStreamingChain([S1, S2]), 1);
    
    // "I" attempts to represent subject but fails
    // Subject is in the gap, not in "I"
    const subjectPos = representSubject(S1, chain);
    
    expect(subjectPos).not.toBeNull();
    expect(subjectPos!.value).toBeNull(); // Can't be captured
  });

  test('alienation: subject represented but misrecognized', () => {
    // Subject identifies with signifier but is not identical to it
    const idealEgo = createSignifier('ideal_image', [['imaginary', true]]);
    const subject = createSignifier('subject', [['lack', true]]);

    const chain = quilt(createStreamingChain([idealEgo, subject]), 0);
    const gap = representSubject(idealEgo, chain);

    // Subject in gap between ideal and reality
    expect(gap).not.toBeNull();
    expect(gap!.between[0]).toBe(0); // After ideal_image
    
    // Subject ≠ ideal_image (alienation)
    expect(gap!.value).toBeNull(); // Subject as lack
  });

  test('no subject position at chain boundary', () => {
    const last = createSignifier('last');
    const chain = quilt(createStreamingChain([last]), 0);

    // No S2 to represent subject for
    const position = representSubject(last, chain);
    expect(position).toBeNull();
  });

  test('division of subject: $ between S1 and S2', () => {
    // Subject divided by entry into language
    const preLinguistic = createSignifier('pre_symbolic', [['real', true]]);
    const linguistic = createSignifier('symbolic', [['language', true]]);

    const chain = quilt(createStreamingChain([preLinguistic, linguistic]), 1);
    const division = representSubject(preLinguistic, chain);

    // Subject split between Real and Symbolic
    expect(division).not.toBeNull();
    expect(division!.between).toEqual([0, 1]);
    
    // Division = structural void (barred subject $)
    expect(division!.value).toBeNull();
  });

  test('fading of subject: aphanisis', () => {
    // Subject appears only to disappear (fading under signification)
    const S1 = createSignifier('S1');
    const S2 = createSignifier('S2');
    const S3 = createSignifier('S3');

    const chain = quilt(createStreamingChain([S1, S2, S3]), 1);
    
    // Subject emerges between signifiers
    const pos1 = representSubject(S1, chain);
    const pos2 = representSubject(S2, chain);
    
    expect(pos1).not.toBeNull();
    expect(pos2).not.toBeNull();
    
    // But always as void (fading/aphanisis)
    expect(pos1!.value).toBeNull();
    expect(pos2!.value).toBeNull();
  });
});
