import type { PCATransform } from '../semantic-colors.ts'

export type MatchData = {
  capacities: Array<{
    id: string
    expressions: string[]
    label: string
    embedding?: number[]
  }>
  needs: Array<{
    id: string
    expressions: string[]
    label: string
    embedding?: number[]
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
      similarity?: number
      priorityWeight?: number
      categoryMatch?: {
        overlapCategory: string
        overlapDistance: number
        isBlocked: boolean
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
