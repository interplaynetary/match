/**
 * Match data generation for the visualization API.
 */

import { Matcher, describeTimeConstraint, describeSpaceConstraint, describeQuantityConstraint } from './matcher'
import type { Constraints } from './types'
import { convertExamples, type EmbeddingsStore } from './example-converter'
import { computePCATransform, type PCATransform } from './semantic-colors'
import enrichedData from '../data/enriched-full.json'

const examples = enrichedData.results
import embeddingsData from '../data/embeddings.json'

const embeddings = embeddingsData as EmbeddingsStore

function summarizeConstraints(constraints?: Constraints): ConstraintSummary | undefined {
  if (!constraints) return undefined

  const summary: ConstraintSummary = {}

  if (constraints.time) {
    const desc = describeTimeConstraint(constraints.time)
    if (desc !== 'any time') summary.time = desc
  }
  if (constraints.space) {
    const desc = describeSpaceConstraint(constraints.space)
    if (desc !== 'any location') summary.space = desc
  }
  if (constraints.quantity) {
    const desc = describeQuantityConstraint(constraints.quantity)
    if (desc !== 'any amount') summary.quantity = desc
  }

  return Object.keys(summary).length > 0 ? summary : undefined
}

type ConstraintDetail = {
  score: number
  reason: string
  needDesc?: string
  capacityDesc?: string
}

type ConstraintSummary = {
  time?: string
  space?: string
  quantity?: string
}

export type MatchData = {
  capacities: Array<{ id: string; expressions: string[]; label: string; embedding?: number[]; constraints?: ConstraintSummary }>
  needs: Array<{ id: string; expressions: string[]; label: string; embedding?: number[]; constraints?: ConstraintSummary }>
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

export function generateMatchData(): MatchData {
  // Use low threshold to get all potential matches; UI slider filters client-side
  const matcher = new Matcher({ similarityThreshold: 0.5 })
  const { capacities, needs, byId } = convertExamples(examples as any, embeddings)

  // Collect all embeddings for PCA transform computation
  const allEmbeddings: number[][] = []

  const capacityData = capacities.map((c) => {
    const original = byId.get(c.id)?.original
    if (c.embedding) allEmbeddings.push(c.embedding)
    return {
      id: c.id,
      expressions: c.expressions.map(e => e.text),
      label: original?.naturalLanguage?.slice(0, 50) ?? c.expressions[0]?.text ?? 'capacity',
      embedding: c.embedding,
      constraints: summarizeConstraints(c.constraints),
    }
  })

  const needData = needs.map((n) => {
    const original = byId.get(n.id)?.original
    if (n.embedding) allEmbeddings.push(n.embedding)
    return {
      id: n.id,
      expressions: n.expressions.map(e => e.text),
      label: original?.naturalLanguage?.slice(0, 50) ?? n.expressions[0]?.text ?? 'need',
      embedding: n.embedding,
      constraints: summarizeConstraints(n.constraints),
    }
  })

  // Compute PCA transform from all embeddings
  const pcaTransform = computePCATransform(allEmbeddings)

  const matchData: MatchData['matches'] = []
  for (const need of needs) {
    const results = matcher.findMatches(need, capacities)
    for (const result of results) {
      matchData.push({
        needId: result.needId,
        capacityId: result.capacityId,
        score: result.feasibilityScore,
        breakdown: result.breakdown,
        matchedExpressions: {
          needText: result.matchedExpressions.need.text,
          capacityText: result.matchedExpressions.capacity.text,
          needChain: result.matchedExpressions.need.categoryChain,
          capacityChain: result.matchedExpressions.capacity.categoryChain,
        },
      })
    }
  }

  return {
    capacities: capacityData,
    needs: needData,
    matches: matchData,
    pcaTransform,
  }
}
