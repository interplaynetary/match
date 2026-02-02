/**
 * Enhanced Lacanian FCA - Core Schemas
 * 
 * Temporal Probabilistic Formal Context combining:
 * - FCA (Formal Concept Analysis)
 * - Temporal dynamics (streaming signifiers)
 * - Probabilistic semantics (distributions)
 * - Syntagmatic structure (graph)
 * - Quilting mechanism (collapse)
 */

import { z } from 'zod';

// ============================================================================
// Basic Types
// ============================================================================

/**
 * Feature: Atomic attribute in FCA sense
 * (dimension, value) pair representing an attribute
 */
export const FeatureSchema = z.object({
  dimension: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export type Feature = z.infer<typeof FeatureSchema>;

/**
 * Signifier: Object in FCA sense (Gegenstand)
 * Has positive features (I) and negations (I^-)
 */
export const SignifierSchema = z.object({
  id: z.string(),
  acoustic: z.array(z.string()),
  features: z.array(FeatureSchema),
  negations: z.array(FeatureSchema),
});

export type Signifier = z.infer<typeof SignifierSchema>;

// ============================================================================
// Temporal Probabilistic Formal Context
// ============================================================================

/**
 * Fuzzy Incidence: I_t: G_t × M → [0,1]
 * Maps (signifier, feature) pairs to probability in [0,1]
 */
export const FuzzyIncidenceSchema = z.record(
  z.string(), // signifier_id:feature_key
  z.number().min(0).max(1)
);

export type FuzzyIncidence = z.infer<typeof FuzzyIncidenceSchema>;

/**
 * Crisp Incidence: I^-: G_t × M → {0,1}
 * Negations are crisp (not fuzzy)
 */
export const CrispIncidenceSchema = z.record(
  z.string(), // signifier_id:feature_key
  z.boolean()
);

export type CrispIncidence = z.infer<typeof CrispIncidenceSchema>;

/**
 * Syntagmatic Graph: E ⊆ G_t × G_t
 * Directed edges representing "can follow" relation
 */
export const SyntagmaticGraphSchema = z.record(
  z.string(), // from signifier_id
  z.array(z.string()) // to signifier_ids
);

export type SyntagmaticGraph = z.infer<typeof SyntagmaticGraphSchema>;

/**
 * Meaning Distribution: P_t: G_t → Δ(M)
 * Maps signifiers to probability distributions over meanings
 */
export const MeaningDistributionSchema = z.record(
  z.string(), // meaning_id
  z.number().min(0).max(1)
);

export type MeaningDistribution = z.infer<typeof MeaningDistributionSchema>;

/**
 * Quilting Points: Q_t ⊆ ℕ
 * Temporal indices where meaning crystallizes
 */
export const QuiltingPointsSchema = z.array(z.number().int().nonnegative());

export type QuiltingPoints = z.infer<typeof QuiltingPointsSchema>;

/**
 * Temporal Probabilistic Formal Context
 * 
 * K = (G_t, M, I_t, I^-, E, P_t, Q_t)
 * 
 * This is the complete enhanced structure combining FCA with temporal,
 * probabilistic, and syntagmatic dimensions.
 */
export const TemporalContextSchema = z.object({
  /** Time index */
  t: z.number().int().nonnegative(),
  
  /** G_t: Signifiers at time t (growing set) */
  signifiers: z.array(SignifierSchema),
  
  /** M: Feature space (stable) */
  features: z.array(FeatureSchema),
  
  /** I_t: Fuzzy incidence (signifier × feature → [0,1]) */
  incidence: FuzzyIncidenceSchema,
  
  /** I^-: Crisp negations (signifier × feature → {0,1}) */
  negations: CrispIncidenceSchema,
  
  /** E: Syntagmatic edges (signifier → signifier[]) */
  syntagmatic: SyntagmaticGraphSchema,
  
  /** P_t: Meaning distributions (signifier → Distribution) */
  distributions: z.record(z.string(), MeaningDistributionSchema),
  
  /** Q_t: Quilting points (temporal indices) */
  quilting: QuiltingPointsSchema,
});

export type TemporalContext = z.infer<typeof TemporalContextSchema>;

// ============================================================================
// FCA Concepts
// ============================================================================

/**
 * Formal Concept: (A, B) where A' = B and B' = A
 * 
 * - A (extent): Set of signifiers
 * - B (intent): Set of features
 */
export const FormalConceptSchema = z.object({
  extent: z.array(z.string()), // signifier ids
  intent: z.array(FeatureSchema),
});

export type FormalConcept = z.infer<typeof FormalConceptSchema>;

/**
 * Quilt-Relative Concept: C_q^t = (A, B, p)
 * 
 * A formal concept enhanced with:
 * - Temporal index (t)
 * - Quilting context (q)
 * - Probability (p)
 */
export const QuiltRelativeConceptSchema = z.object({
  /** Time index */
  t: z.number().int().nonnegative(),
  
  /** Quilting point (null if unquilted) */
  quiltingPoint: z.number().int().nonnegative().nullable(),
  
  /** Extent (signifier ids) */
  extent: z.array(z.string()),
  
  /** Intent (features) */
  intent: z.array(FeatureSchema),
  
  /** Probability given quilting */
  probability: z.number().min(0).max(1),
});

export type QuiltRelativeConcept = z.infer<typeof QuiltRelativeConceptSchema>;

/**
 * Concept Lattice: Complete lattice of formal concepts
 * 
 * Ordered by extent inclusion (or dually, intent inclusion)
 */
export const ConceptLatticeSchema = z.object({
  /** All formal concepts */
  concepts: z.array(FormalConceptSchema),
  
  /** Partial order: concept_id → subconcept_ids */
  order: z.record(z.string(), z.array(z.string())),
  
  /** Top element (⊤) */
  top: z.string(),
  
  /** Bottom element (⊥) */
  bottom: z.string(),
});

export type ConceptLattice = z.infer<typeof ConceptLatticeSchema>;

// ============================================================================
// Temporal Sequence
// ============================================================================

/**
 * Temporal Sequence: History of contexts over time
 * 
 * Tracks evolution of formal context as signifiers arrive
 */
export const TemporalSequenceSchema = z.object({
  /** Sequence of contexts indexed by time */
  contexts: z.array(TemporalContextSchema),
  
  /** Current time */
  currentTime: z.number().int().nonnegative(),
});

export type TemporalSequence = z.infer<typeof TemporalSequenceSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create feature key for indexing
 */
export function featureKey(f: Feature): string {
  return `${f.dimension}:${f.value}`;
}

/**
 * Create incidence key for (signifier, feature) pair
 */
export function incidenceKey(signifierId: string, feature: Feature): string {
  return `${signifierId}:${featureKey(feature)}`;
}

/**
 * Compare features for equality
 */
export function featuresEqual(f1: Feature, f2: Feature): boolean {
  return f1.dimension === f2.dimension && f1.value === f2.value;
}

/**
 * Check if feature set contains feature
 */
export function hasFeature(features: Feature[], target: Feature): boolean {
  return features.some(f => featuresEqual(f, target));
}

/**
 * Deduplicate feature array
 */
export function deduplicateFeatures(features: Feature[]): Feature[] {
  const seen = new Set<string>();
  return features.filter(f => {
    const key = featureKey(f);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Intersection of feature arrays
 */
export function intersectFeatures(f1: Feature[], f2: Feature[]): Feature[] {
  return f1.filter(f => hasFeature(f2, f));
}

/**
 * Union of feature arrays
 */
export function unionFeatures(f1: Feature[], f2: Feature[]): Feature[] {
  return deduplicateFeatures([...f1, ...f2]);
}

/**
 * Check if f1 is subset of f2
 */
export function isSubsetFeatures(f1: Feature[], f2: Feature[]): boolean {
  return f1.every(f => hasFeature(f2, f));
}
