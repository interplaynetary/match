import { describe, test, expect } from 'bun:test';
import { metonymicSlide, createSymbolicSpace } from '../operations';
import type { Signifier } from '../core';

describe('Metonymy - The Horizontal Axis', () => {
  const createSignifier = (
    id: string,
    features: Array<[string, any]> = []
  ): Signifier => ({
    id,
    acoustic: id.split(''),
    features: features.map(([dimension, value]) => ({ dimension, value })),
    negations: [],
  });

  test('metonymic slide follows contiguity chains', () => {
    // "The crown" → monarchy (part for whole)
    const space = createSymbolicSpace(
      [
        createSignifier('crown'),
        createSignifier('king'),
        createSignifier('throne'),
        createSignifier('palace'),
        createSignifier('kingdom'),
      ],
      [
        ['crown', 'king'],
        ['king', 'throne'],
        ['throne', 'palace'],
        ['palace', 'kingdom'],
      ]
    );

    const crown = space.signifiers.find(s => s.id === 'crown')!;
    const path = metonymicSlide(crown, space, 3);

    // Path follows syntagmatic associations
    expect(path.length).toBeGreaterThan(1);
    expect(path[0].id).toBe('crown');
    // Each step is contiguous with previous
    expect(path.every((s, i) => {
      if (i === 0) return true;
      const prevId = path[i - 1].id;
      return space.syntagmatic[prevId]?.includes(s.id);
    })).toBe(true);
  });

  test('desire slides along metonymic chain: perpetual deferral', () => {
    // Desire for object → substitute → substitute → ... (never satisfied)
    const space = createSymbolicSpace(
      [
        createSignifier('desire', [['lack', true]]),
        createSignifier('object_a', [['desired', true]]),
        createSignifier('substitute_1', [['partial', true]]),
        createSignifier('substitute_2', [['partial', true]]),
        createSignifier('substitute_3', [['partial', true]]),
      ],
      [
        ['desire', 'object_a'],
        ['object_a', 'substitute_1'],
        ['substitute_1', 'substitute_2'],
        ['substitute_2', 'substitute_3'],
        ['substitute_3', 'desire'], // Circular - desire returns to itself
      ]
    );

    const desire = space.signifiers.find(s => s.id === 'desire')!;
    const path = metonymicSlide(desire, space, 5);

    // Desire slides through substitutes, never reaching final satisfaction
    expect(path.length).toBeGreaterThan(3);
    expect(path[0].id).toBe('desire');
    
    // Meaning perpetually deferred through chain
    const hasCircled = path.slice(1).some(s => s.id === 'desire');
    expect(hasCircled).toBe(true); // Returns to itself - the circuit of desire
  });

  test('contiguity vs similarity: syntagmatic horizontal axis', () => {
    // "White House" - metonymic for US presidency (spatial contiguity)
    const space = createSymbolicSpace(
      [
        createSignifier('white_house', [['building', true]]),
        createSignifier('president', [['authority', true]]),
        createSignifier('executive_power', [['political', true]]),
      ],
      [
        ['white_house', 'president'],
        ['president', 'executive_power'],
      ]
    );

    const whiteHouse = space.signifiers.find(s => s.id === 'white_house')!;
    const path = metonymicSlide(whiteHouse, space, 2);

    // Building → President → Power (metonymic chain through contiguity)
    expect(path.length).toBe(3);
    expect(path.map(s => s.id)).toEqual(['white_house', 'president', 'executive_power']);
  });

  test('chain terminates at dead end (no further associations)', () => {
    const space = createSymbolicSpace(
      [
        createSignifier('start'),
        createSignifier('middle'),
        createSignifier('end'),
      ],
      [
        ['start', 'middle'],
        ['middle', 'end'],
        // 'end' has no outgoing edges
      ]
    );

    const start = space.signifiers.find(s => s.id === 'start')!;
    const path = metonymicSlide(start, space, 10); // Request 10 steps

    // Terminates early at 'end' (no further contiguity)
    expect(path.length).toBe(3);
    expect(path[path.length - 1].id).toBe('end');
  });

  test('metonymy in language: "sail" for "ship"', () => {
    const space = createSymbolicSpace(
      [
        createSignifier('sail', [['part', true]]),
        createSignifier('ship', [['whole', true], ['vehicle', true]]),
        createSignifier('ocean', [['location', true]]),
        createSignifier('voyage', [['journey', true]]),
      ],
      [
        ['sail', 'ship'],     // Part → whole
        ['ship', 'ocean'],    // Vehicle → location
        ['ocean', 'voyage'],  // Location → activity
      ]
    );

    const sail = space.signifiers.find(s => s.id === 'sail')!;
    const path = metonymicSlide(sail, space, 3);

    // Classic metonymic sequence: part → whole → context → action
    expect(path.length).toBe(4);
    expect(path.map(s => s.id)).toEqual(['sail', 'ship', 'ocean', 'voyage']);
  });
});
