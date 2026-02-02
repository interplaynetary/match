/**
 * Match data generation for the visualization API.
 */

import { Matcher, describeTimeConstraint, describeSpaceConstraint, describeQuantityConstraint } from './matcher'
import type { Constraints } from './types'
import { convertExamples, type EmbeddingsStore } from './example-converter'
import { computePCATransform } from './semantic-colors'
import type { MatchData, ConstraintSummary } from './frontend/types'

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

// Re-export the canonical MatchData type
export type { MatchData } from './frontend/types'

interface GenerateMatchDataInput {
  examples: any[]
  embeddings: EmbeddingsStore
}

/**
 * Generate match data from provided examples and embeddings.
 */
export function generateMatchData({ examples, embeddings }: GenerateMatchDataInput): MatchData {

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
      label: original?.naturalLanguage ?? c.expressions[0]?.text ?? 'capacity',
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
      label: original?.naturalLanguage ?? n.expressions[0]?.text ?? 'need',
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
