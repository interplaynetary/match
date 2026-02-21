// Re-export everything from core modules for convenient $lib imports

// Types and schemas (primary definitions)
export * from './core/ai/types'
export * from './core/commons/primitives/time'
export * from './core/commons/matching/desire'
export * from './core/commons/matching/slot'

// Enrichment (exclude Constraints which conflicts with types.ts)
export {
  contentId,
  EnrichedExpression,
  EnrichedExample,
  UserInput,
  ENRICHMENT_PROMPT,
  type EnrichedExpressionType,
  type EnrichedExampleType,
  type UserInputType,
  type ConstraintsType,
  type EnrichedExampleWithId,
  type CategoryStats,
  extractCategoryNames,
  collectCategoryStats,
} from './core/ai/enrichment'
export * from './core/ai/enrichment-ops'

// Embeddings
export * from './core/ai/embeddings'
export * from './core/ai/embedding-ops'
export * from './core/ai/semantic-colors'

// Category/Taxonomy
export * from './core/ai/category-matcher'
export * from './core/ai/taxonomy-tree'
export * from './core/ai/taxonomy-merge'
export * from './core/ai/taxonomy-store'
export * from './core/ai/canonical-roots'

// Matching (primary matcher - exclude duplicates from eligibility)
export * from './core/ai/matcher'
export {
  slotsCompatible,
  skillsCompatible,
  locationsCompatible,
  checkFlowConstraints,
  timeRangesOverlap,
  getRecurrenceTrack,
  availabilityWindowsOverlapWithTimezone,
  convertTimeToUTC,
  anyTimeRangesOverlap,
  calculateMaxContiguousDuration,
  calculateAvailabilityIntersection,
  intersectTimeRanges,
  type FilterRule,
  passesSlotFilters,
  getSpaceTimeSignature,
  groupSlotsBySpaceTime,
} from './core/matching'
export * from './core/ai/match-data'
export * from './core/commons/matching/feasibility'
// Eligibility - exclude types that conflict with types.ts
export {
  EligibilityFilters,
  evaluateEligibilityFilter,
} from './core/ai/eligibility'

// Spatial
export * from './core/commons/primitives/space'

// Search
export * from './core/ai/search'

// Skills
export * from './core/commons/skills'

// AI
export * from './core/ai/ai-pipe'

// Utilities
export * from './core/ai/example-converter'
export * from './core/ai/repulsion'
