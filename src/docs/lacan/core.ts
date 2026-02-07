import { z } from 'zod';

// ============================================================================
// I. Atomic Units
// ============================================================================

/**
 * Dimension - axis of variation in feature space
 */
export const DimensionSchema = z.string();
export type Dimension = z.infer<typeof DimensionSchema>;

/**
 * Value - position on a dimensional axis
 */
export const ValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type Value = z.infer<typeof ValueSchema>;

/**
 * Feature - dimension of distinction
 * Represents what a signifier IS along a specific axis
 */
export const FeatureSchema = z.object({
  dimension: DimensionSchema,
  value: ValueSchema,
});
export type Feature = z.infer<typeof FeatureSchema>;

/**
 * PhonemeSequence - acoustic representation
 */
export const PhonemeSequenceSchema = z.array(z.string());
export type PhonemeSequence = z.infer<typeof PhonemeSequenceSchema>;

/**
 * Signifier - minimal distinguishable unit
 * The fundamental atom of the symbolic order
 */
export const SignifierSchema = z.object({
  id: z.string(), // Using string instead of Symbol for serialization
  acoustic: PhonemeSequenceSchema,
  features: z.array(FeatureSchema), // what it IS
  negations: z.array(FeatureSchema), // what it is NOT (finite, domain-specific)
});
export type Signifier = z.infer<typeof SignifierSchema>;

// ============================================================================
// II. Relational Structure
// ============================================================================

/**
 * SparseGraph - horizontal axis of signification
 * Represents syntagmatic relations (what can follow what)
 */
export const SparseGraphSchema = z.record(
  z.string(), // signifier id
  z.array(z.string()) // adjacent signifier ids
);
export type SparseGraph = z.infer<typeof SparseGraphSchema>;

/**
 * FeatureIndex - vertical axis of signification
 * Maps features to signifiers for paradigmatic operations
 */
export const FeatureIndexSchema = z.record(
  z.string(), // feature key (dimension:value)
  z.array(z.string()) // signifier ids with this feature
);
export type FeatureIndex = z.infer<typeof FeatureIndexSchema>;

/**
 * SymbolicSpace - the totality of the symbolic order
 * Contains all signifiers and their relational structure
 */
export const SymbolicSpaceSchema = z.object({
  signifiers: z.array(SignifierSchema),
  syntagmatic: SparseGraphSchema, // horizontal: combination
  paradigmatic: FeatureIndexSchema, // vertical: substitution
});
export type SymbolicSpace = z.infer<typeof SymbolicSpaceSchema>;

// ============================================================================
// III. Signifying Chains
// ============================================================================

/**
 * FeatureBundle - contextually determined meaning
 */
export const FeatureBundleSchema = z.array(FeatureSchema);
export type FeatureBundle = z.infer<typeof FeatureBundleSchema>;

/**
 * Meaning - contextually determined bundle with metadata
 */
export const MeaningSchema = z.object({
  features: FeatureBundleSchema,
  context_signature: z.string(), // Hash of context
  confidence: z.number(), // Real number [0, 1]
});
export type Meaning = z.infer<typeof MeaningSchema>;

/**
 * Distribution - probability distribution over meanings
 */
export const DistributionSchema = z.record(
  z.string(), // meaning id or hash
  z.number() // probability weight
);
export type Distribution<T = Meaning> = z.infer<typeof DistributionSchema>;

/**
 * Chain - ordered sequence with deferred meaning
 * Represents a signifying chain with quilting points
 */
export const ChainSchema = z.object({
  signifiers: z.array(SignifierSchema),
  interpretations: z.array(z.union([
    MeaningSchema,
    z.null(), // null represents unquilted positions
  ])),
  quilting_indices: z.array(z.number()), // indices where meaning crystallizes
});
export type Chain = z.infer<typeof ChainSchema>;

/**
 * StreamingChain - chain before fixation
 * All interpretations remain as probability distributions
 */
export const StreamingChainSchema = z.object({
  signifiers: z.array(SignifierSchema),
  interpretations: z.array(DistributionSchema),
});
export type StreamingChain = z.infer<typeof StreamingChainSchema>;

// ============================================================================
// IV. Core Operations (Type Definitions)
// ============================================================================

/**
 * Path - result of metonymic slide
 */
export const PathSchema = z.array(SignifierSchema);
export type Path = z.infer<typeof PathSchema>;

/**
 * SubstitutionCost - semantic cost of substitution
 */
export const SubstitutionCostSchema = z.enum(['SUBSTITUTION', 'METAPHORIC']);
export type SubstitutionCost = z.infer<typeof SubstitutionCostSchema>;

/**
 * SubstitutionResult - result of metaphorical substitution
 */
export const SubstitutionResultSchema = z.object({
  chain: ChainSchema,
  cost: SubstitutionCostSchema,
});
export type SubstitutionResult = z.infer<typeof SubstitutionResultSchema>;

// ============================================================================
// V. Retroactive Determination (Additional Types)
// ============================================================================

/**
 * Index - position in a chain
 */
export const IndexSchema = z.number().int().nonnegative();
export type Index = z.infer<typeof IndexSchema>;

// ============================================================================
// VI. Subject Structure
// ============================================================================

/**
 * SubjectPosition - structural void
 * The subject as gap between signifiers
 */
export const SubjectPositionSchema = z.object({
  between: z.tuple([IndexSchema, IndexSchema]), // gap between S_i and S_{i+1}
  value: z.null(), // bottom type—structurally empty (⊥)
});
export type SubjectPosition = z.infer<typeof SubjectPositionSchema>;

// ============================================================================
// VII. Clinical Structures
// ============================================================================

/**
 * DisavowalMechanism - mechanism for split quilting in perverse structure
 */
export const DisavowalMechanismSchema = z.object({
  type: z.literal('DISAVOWAL'),
  quilted_aspects: z.array(FeatureSchema),
  disavowed_aspects: z.array(FeatureSchema),
});
export type DisavowalMechanism = z.infer<typeof DisavowalMechanismSchema>;

/**
 * SplitChain - perverse structure with simultaneous quilting and non-quilting
 * "I know but nevertheless"
 */
export const SplitChainSchema = z.object({
  chain: ChainSchema,
  disavowal: DisavowalMechanismSchema,
  split_quilting_index: IndexSchema,
});
export type SplitChain = z.infer<typeof SplitChainSchema>;

/**
 * ClinicalStructure - discriminated union of three clinical structures
 */
export const ClinicalStructureSchema = z.discriminatedUnion('structure', [
  z.object({
    structure: z.literal('NEUROTIC'),
    chain: ChainSchema,
    master_signifier: SignifierSchema,
  }),
  z.object({
    structure: z.literal('PSYCHOTIC'),
    chain: StreamingChainSchema,
  }),
  z.object({
    structure: z.literal('PERVERSE'),
    chain: SplitChainSchema,
  }),
]);
export type ClinicalStructure = z.infer<typeof ClinicalStructureSchema>;

// ============================================================================
// VIII. Complexity Metadata
// ============================================================================

/**
 * ComplexityMetrics - computational complexity for operations
 */
export const ComplexityMetricsSchema = z.object({
  time: z.string(), // O(n), O(1), etc.
  space: z.string(),
  effect: z.string(),
});
export type ComplexityMetrics = z.infer<typeof ComplexityMetricsSchema>;

/**
 * OperationMetadata - metadata for each operation type
 */
export const OperationMetadataSchema = z.object({
  name: z.string(),
  complexity: ComplexityMetricsSchema,
  description: z.string(),
});
export type OperationMetadata = z.infer<typeof OperationMetadataSchema>;

// ============================================================================
// IX. Validation Helpers
// ============================================================================

/**
 * Validates that a chain's interpretations match its signifiers length
 */
export const validateChain = (chain: Chain): boolean => {
  return chain.signifiers.length === chain.interpretations.length;
};

/**
 * Validates that quilting indices are within chain bounds
 */
export const validateQuiltingIndices = (chain: Chain): boolean => {
  return chain.quilting_indices.every(
    idx => idx >= 0 && idx < chain.signifiers.length
  );
};

/**
 * Validates that a subject position represents a valid gap
 */
export const validateSubjectPosition = (
  position: SubjectPosition,
  chainLength: number
): boolean => {
  const [i, j] = position.between;
  return i >= 0 && j <= chainLength && i < j;
};

/**
 * Validates streaming chain consistency
 */
export const validateStreamingChain = (chain: StreamingChain): boolean => {
  return chain.signifiers.length === chain.interpretations.length;
};

// ============================================================================
// Exports
// ============================================================================

export const schemas = {
  // I. Atomic Units
  Dimension: DimensionSchema,
  Value: ValueSchema,
  Feature: FeatureSchema,
  PhonemeSequence: PhonemeSequenceSchema,
  Signifier: SignifierSchema,

  // II. Relational Structure
  SparseGraph: SparseGraphSchema,
  FeatureIndex: FeatureIndexSchema,
  SymbolicSpace: SymbolicSpaceSchema,

  // III. Signifying Chains
  FeatureBundle: FeatureBundleSchema,
  Meaning: MeaningSchema,
  Distribution: DistributionSchema,
  Chain: ChainSchema,
  StreamingChain: StreamingChainSchema,

  // IV. Core Operations
  Path: PathSchema,
  SubstitutionCost: SubstitutionCostSchema,
  SubstitutionResult: SubstitutionResultSchema,

  // V. Retroactive Determination
  Index: IndexSchema,

  // VI. Subject Structure
  SubjectPosition: SubjectPositionSchema,

  // VII. Clinical Structures
  DisavowalMechanism: DisavowalMechanismSchema,
  SplitChain: SplitChainSchema,
  ClinicalStructure: ClinicalStructureSchema,

  // VIII. Complexity Metadata
  ComplexityMetrics: ComplexityMetricsSchema,
  OperationMetadata: OperationMetadataSchema,
} as const;

// ============================================================================
// Type Guards
// ============================================================================

export const isNeurotic = (
  structure: ClinicalStructure
): structure is Extract<ClinicalStructure, { structure: 'NEUROTIC' }> => {
  return structure.structure === 'NEUROTIC';
};

export const isPsychotic = (
  structure: ClinicalStructure
): structure is Extract<ClinicalStructure, { structure: 'PSYCHOTIC' }> => {
  return structure.structure === 'PSYCHOTIC';
};

export const isPerverse = (
  structure: ClinicalStructure
): structure is Extract<ClinicalStructure, { structure: 'PERVERSE' }> => {
  return structure.structure === 'PERVERSE';
};
