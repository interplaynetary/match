// Core types for the matching system

export type SatisfactionPath =
  | { type: 'direct'; requires: string; attributes?: Record<string, unknown> }
  | { type: 'composite'; all: SatisfactionPath[] }

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

export type Capacity = {
  id: string
  capacityType: string
  attributes?: Record<string, unknown>
  constraints?: Constraints
  embedding?: number[]
}

export type Need = {
  id: string
  satisfactionPaths: SatisfactionPath[]
  attributes?: Record<string, unknown>
  constraints?: Constraints
  embedding?: number[]
}

export type MatchResult = {
  needId: string
  capacityId: string
  satisfiedVia: SatisfactionPath
  feasibilityScore: number
  breakdown: {
    time?: number
    space?: number
    quantity?: number
    type?: number
  }
}

// Type compatibility declarations
// e.g., "teacher" is compatible with needs for "student"
export type TypeCompatibility = {
  capacityType: string
  satisfiesNeedFor: string[]
}

// Default type compatibilities (asymmetric pairings)
export const DEFAULT_TYPE_COMPATIBILITIES: TypeCompatibility[] = [
  { capacityType: 'teacher', satisfiesNeedFor: ['student', 'learner', 'lessons'] },
  { capacityType: 'student', satisfiesNeedFor: ['teacher', 'tutor', 'mentor'] },
  { capacityType: 'buyer', satisfiesNeedFor: ['seller', 'vendor'] },
  { capacityType: 'seller', satisfiesNeedFor: ['buyer', 'customer'] },
  { capacityType: 'landlord', satisfiesNeedFor: ['tenant', 'renter'] },
  { capacityType: 'tenant', satisfiesNeedFor: ['landlord', 'housing'] },
  { capacityType: 'mentor', satisfiesNeedFor: ['mentee', 'apprentice'] },
  { capacityType: 'mentee', satisfiesNeedFor: ['mentor', 'guide'] },
  { capacityType: 'driver', satisfiesNeedFor: ['rider', 'passenger', 'ride'] },
  { capacityType: 'rider', satisfiesNeedFor: ['driver', 'ride'] },
  { capacityType: 'host', satisfiesNeedFor: ['guest', 'visitor', 'accommodation'] },
  { capacityType: 'guest', satisfiesNeedFor: ['host', 'hosting'] },
  { capacityType: 'employer', satisfiesNeedFor: ['employee', 'worker', 'job'] },
  { capacityType: 'employee', satisfiesNeedFor: ['employer', 'work', 'employment'] },
  { capacityType: 'coach', satisfiesNeedFor: ['athlete', 'player', 'trainee'] },
  { capacityType: 'athlete', satisfiesNeedFor: ['coach', 'trainer', 'coaching'] },
]
