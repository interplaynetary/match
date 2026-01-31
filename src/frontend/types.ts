import type { PCATransform } from '../semantic-colors.ts'

export type ConstraintDetail = {
  score: number
  reason: string
  needDesc?: string
  capacityDesc?: string
}

export type ConstraintSummary = {
  time?: string
  space?: string
  quantity?: string
}

export type MatchData = {
  capacities: Array<{
    id: string
    expressions: string[]
    label: string
    embedding?: number[]
    constraints?: ConstraintSummary
  }>
  needs: Array<{
    id: string
    expressions: string[]
    label: string
    embedding?: number[]
    constraints?: ConstraintSummary
  }>
  pcaTransform: PCATransform
  matches: Array<{
    needId: string
    capacityId: string
    score: number
    breakdown: {
      time?: number
      space?: number
      quantity?: number
      timeDetail?: ConstraintDetail
      spaceDetail?: ConstraintDetail
      quantityDetail?: ConstraintDetail
      similarity?: number
      specificity?: number
      priorityWeight?: number
      categoryMatch?: {
        overlapCategory: string
        overlapDistance: number
        isBlocked: boolean
        specificity: number
      }
    }
    matchedExpressions?: {
      needText: string
      capacityText: string
      needChain?: string[]
      capacityChain?: string[]
    }
  }>
}

export type Match = MatchData['matches'][0]

export type NodeItem = {
  id: string
  expressions: string[]
  label: string
  embedding?: number[]
  constraints?: ConstraintSummary
}

export type ConnectedTooltip = {
  id: string
  isCapacity: boolean
  label: string
  color: string
  x: number
  y: number
}

export type MatchWithOther = Match & {
  other: NodeItem | undefined
  otherType: 'Need' | 'Capacity'
}
