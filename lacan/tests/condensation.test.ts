import { describe, test, expect } from 'bun:test';
import { condense } from '../operations';
import type { Signifier } from '../core';

describe('Condensation - Overdetermination', () => {
  const createSignifier = (
    id: string,
    features: Array<[string, any]> = [],
    acoustic: string[] = []
  ): Signifier => ({
    id,
    acoustic: acoustic.length > 0 ? acoustic : id.split(''),
    features: features.map(([dimension, value]) => ({ dimension, value })),
    negations: [],
  });

  test('condense multiple signifiers into one', () => {
    const s1 = createSignifier('first', [['quality', 'a']]);
    const s2 = createSignifier('second', [['quality', 'b']]);
    const s3 = createSignifier('third', [['quality', 'c']]);

    const condensed = condense([s1, s2, s3]);

    // New signifier contains merged features
    expect(condensed.features.length).toBe(3);
    expect(condensed.features.some(f => f.value === 'a')).toBe(true);
    expect(condensed.features.some(f => f.value === 'b')).toBe(true);
    expect(condensed.features.some(f => f.value === 'c')).toBe(true);
  });

  test('overdetermination: single signifier carries multiple meanings', () => {
    // Dream image condenses multiple day residues
    const mother = createSignifier('mother', [
      ['relation', 'parent'],
      ['gender', 'feminine'],
      ['nurture', true],
    ]);
    const teacher = createSignifier('teacher', [
      ['relation', 'authority'],
      ['education', true],
      ['nurture', true],
    ]);
    const boss = createSignifier('boss', [
      ['relation', 'authority'],
      ['professional', true],
    ]);

    const dreamFigure = condense([mother, teacher, boss]);

    // Single figure overdetermined by multiple sources
    expect(dreamFigure.features.length).toBeGreaterThan(3);
    expect(dreamFigure.features.some(f => f.dimension === 'relation')).toBe(true);
    expect(dreamFigure.features.some(f => f.dimension === 'nurture')).toBe(true);
  });

  test('portmanteau: acoustic blending', () => {
    const breakfast = createSignifier('breakfast', [], ['b', 'r', 'e', 'a', 'k']);
    const lunch = createSignifier('lunch', [], ['l', 'u', 'n', 'c', 'h']);

    const brunch = condense([breakfast, lunch]);

    // Acoustic blend of inputs (simplified)
    expect(brunch.acoustic.length).toBeGreaterThan(0);
    expect(brunch.acoustic).not.toEqual(breakfast.acoustic);
    expect(brunch.acoustic).not.toEqual(lunch.acoustic);
  });

  test('feature conflict resolution', () => {
    const day = createSignifier('day', [
      ['lightness', 'bright'],
      ['time', 'daytime'],
    ]);
    const night = createSignifier('night', [
      ['lightness', 'dark'],
      ['time', 'nighttime'],
    ]);

    const twilight = condense([day, night]);

    // Conflicting features on same dimension
    // Resolution: dominant feature kept, others negated
    expect(twilight.features.some(f => f.dimension === 'lightness')).toBe(true);
    expect(twilight.negations.length).toBeGreaterThan(0);
  });

  test('symptom as condensation of conflicts', () => {
    const desire = createSignifier('desire', [
      ['id', true],
      ['pleasure', true],
      ['forbidden', true],
    ]);
    const prohibition = createSignifier('prohibition', [
      ['superego', true],
      ['morality', true],
      ['forbidden', true],
    ]);
    const compromise = createSignifier('ego_defense', [
      ['compromise', true],
      ['unconscious', true],
    ]);

    const symptom = condense([desire, prohibition, compromise]);

    // Symptom = condensation of multiple psychic forces
    expect(symptom.features.length).toBeGreaterThan(4);
    expect(symptom.features.some(f => f.dimension === 'id')).toBe(true);
    expect(symptom.features.some(f => f.dimension === 'superego')).toBe(true);
    expect(symptom.features.some(f => f.dimension === 'compromise')).toBe(true);
  });

  test('single signifier identity preserved when condensing alone', () => {
    const alone = createSignifier('alone', [['solo', true]]);
    const result = condense([alone]);

    expect(result).toEqual(alone);
  });

  test('word formation through condensation: neologism', () => {
    // Patient creates new word condensing multiple meanings
    const shame = createSignifier('shame', [['affect', 'shame']]);
    const anger = createSignifier('anger', [['affect', 'anger']]);
    const fear = createSignifier('fear', [['affect', 'fear']]);

    const neologism = condense([shame, anger, fear]);

    // New signifier with features from all sources
    expect(neologism.features).toContainEqual({ dimension: 'affect', value: 'shame' });
    expect(neologism.features).toContainEqual({ dimension: 'affect', value: 'anger' });
    expect(neologism.features).toContainEqual({ dimension: 'affect', value: 'fear' });
    
    // Unique identity (not original words)
    expect(neologism.id).not.toBe('shame');
    expect(neologism.id).not.toBe('anger');
    expect(neologism.id).not.toBe('fear');
  });
});
