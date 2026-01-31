// Core types for the matching system

/**
 * An expression describes what a capacity offers or what a need requires.
 * Multiple expressions at different abstraction levels enable flexible matching.
 *
 * Examples:
 * - { text: "Vegan pizza delivery" }
 * - { text: "Pizza", priority: 1 }  // most specific
 * - { text: "Italian food", priority: 2 }  // fallback
 * - { text: "Food", priority: 3 }  // broadest
 */
export type Expression = {
  text: string
  priority?: number  // optional, omit = equal weighting (default priority 1)
  categoryChain?: string[]  // ["food", "meat", "pork-belly"] - path from abstract to concrete
  disjointWith?: string[]   // ["vegan", "kosher"] - mutually exclusive categories
}

export type TimeConstraint = {
  availableFrom?: string
  availableTo?: string
  dayOfWeek?: string
  timeOfDay?: string
  recurring?: string
  minDuration?: number // minutes
}

export type SpaceConstraint = {
  location?: { lat: number; lng: number }
  area?: string
  maxRadius?: number // km
  remote?: boolean
}

export type QuantityConstraint = {
  amount: number
  unit: string
  minAtomic?: number
}

export type Constraints = {
  time?: TimeConstraint
  space?: SpaceConstraint
  quantity?: QuantityConstraint
  [key: string]: unknown // allow additional constraint types
}

/**
 * A capacity represents something someone can offer.
 * Matching is based on semantic similarity of expressions.
 */
export type Capacity = {
  id: string
  expressions: Expression[]  // what this capacity offers
  constraints?: Constraints
  embedding?: number[]  // computed from expressions
}

/**
 * A need represents something someone is looking for.
 * Matching is based on semantic similarity of expressions.
 */
export type Need = {
  id: string
  expressions: Expression[]  // what would satisfy this need
  constraints?: Constraints
  embedding?: number[]  // computed from expressions
}

/**
 * Result of matching a need against capacities.
 * Score combines semantic similarity with constraint feasibility.
 */
/**
 * Result of category chain matching.
 */
export type CategoryMatch = {
  overlapCategory: string   // where chains intersected
  overlapDistance: number   // 0 = exact, 1 = sibling, 2+ = ancestor
  isBlocked: boolean        // true if disjoint conflict
}

/**
 * Result of matching a need against capacities.
 * Score combines semantic similarity with constraint feasibility.
 */
export type MatchResult = {
  needId: string
  capacityId: string
  feasibilityScore: number
  matchedExpressions: {
    need: Expression
    capacity: Expression
    similarity: number
  }
  breakdown: {
    time?: number
    space?: number
    quantity?: number
    similarity: number
    priorityWeight: number
    categoryMatch?: CategoryMatch  // present if category chains overlapped
  }
}
