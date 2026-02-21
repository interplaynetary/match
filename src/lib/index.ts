// Re-export everything from core modules for convenient $lib imports

// Types and schemas (primary definitions)
export * from './core/types'
export * from './core/plan/time'
export * from './core/plan/desire'
export * from './core/plan/process'

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
} from './core/enrichment'
export * from './core/enrichment-ops'

// Embeddings
export * from './core/embeddings'
export * from './core/embedding-ops'
export * from './core/semantic-colors'

// Category/Taxonomy
export * from './core/category-matcher'
export * from './core/taxonomy-tree'
export * from './core/taxonomy-merge'
export * from './core/taxonomy-store'
export * from './core/canonical-roots'

// Matching (primary matcher - exclude duplicates from eligibility)
export * from './core/matcher'
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
export * from './core/match-data'
export * from './core/plan/feasibility'
// Eligibility - exclude types that conflict with types.ts
export {
  EligibilityFilters,
  evaluateEligibilityFilter,
} from './core/eligibility'

// Spatial
export * from './core/plan/space'

// Search
export * from './core/search'

// Skills
export * from './core/plan/skills'

// AI
export * from './core/ai-pipe'

// Utilities
export * from './core/example-converter'
export * from './core/repulsion'
