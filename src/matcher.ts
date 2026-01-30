import type {
  Capacity,
  Constraints,
  Need,
  MatchResult,
  Expression,
} from './types'
import { cosineSimilarity } from './embeddings'

export type MatcherOptions = {
  similarityThreshold?: number  // minimum similarity to consider a match (default 0.6)
}

export class Matcher {
  private similarityThreshold: number

  constructor(options: MatcherOptions = {}) {
    this.similarityThreshold = options.similarityThreshold ?? 0.6
  }

  /**
   * Find all capacities that could satisfy a need.
   * Matching is based on embedding similarity with priority weighting.
   */
  findMatches(need: Need, capacities: Capacity[]): MatchResult[] {
    const results: MatchResult[] = []

    for (const capacity of capacities) {
      const match = this.computeMatch(need, capacity)
      if (match && match.feasibilityScore >= this.similarityThreshold) {
        results.push(match)
      }
    }

    // Sort by feasibility score descending
    return results.sort((a, b) => b.feasibilityScore - a.feasibilityScore)
  }

  /**
   * Compute match between a need and capacity.
   * Returns null if no valid match (e.g., missing embeddings).
   */
  private computeMatch(need: Need, capacity: Capacity): MatchResult | null {
    // Require embeddings for matching
    if (!need.embedding || !capacity.embedding) {
      return null
    }

    // Compute overall similarity between embeddings
    const rawSimilarity = cosineSimilarity(need.embedding, capacity.embedding)
    const similarity = Math.max(0, rawSimilarity)

    // Find best matching expression pair for reporting
    const matchedExpressions = this.findBestExpressionMatch(need, capacity, similarity)

    // Compute priority weight (higher priority = lower number = higher weight)
    const priorityWeight = this.computePriorityWeight(matchedExpressions.need, matchedExpressions.capacity)

    // Compute constraint feasibility
    const constraintFeasibility = this.computeConstraintFeasibility(need, capacity)

    // Combine scores: similarity * priorityWeight * constraintFeasibility
    const breakdown: MatchResult['breakdown'] = {
      similarity,
      priorityWeight,
      ...constraintFeasibility.breakdown,
    }

    const scores = [similarity, priorityWeight]
    if (constraintFeasibility.breakdown.time !== undefined) {
      scores.push(constraintFeasibility.breakdown.time)
    }
    if (constraintFeasibility.breakdown.space !== undefined) {
      scores.push(constraintFeasibility.breakdown.space)
    }
    if (constraintFeasibility.breakdown.quantity !== undefined) {
      scores.push(constraintFeasibility.breakdown.quantity)
    }

    // Geometric mean of all scores
    const feasibilityScore = scores.length > 0
      ? Math.pow(scores.reduce((a, b) => a * b, 1), 1 / scores.length)
      : 0

    return {
      needId: need.id,
      capacityId: capacity.id,
      feasibilityScore,
      matchedExpressions,
      breakdown,
    }
  }

  /**
   * Find the best matching pair of expressions between need and capacity.
   * For now, just returns the first expressions - in future could do per-expression embedding matching.
   */
  private findBestExpressionMatch(
    need: Need,
    capacity: Capacity,
    similarity: number
  ): MatchResult['matchedExpressions'] {
    // Return highest priority expressions from each
    const needExpr = this.getHighestPriorityExpression(need.expressions)
    const capExpr = this.getHighestPriorityExpression(capacity.expressions)

    return {
      need: needExpr,
      capacity: capExpr,
      similarity,
    }
  }

  /**
   * Get the expression with highest priority (lowest priority number).
   */
  private getHighestPriorityExpression(expressions: Expression[]): Expression {
    if (expressions.length === 0) {
      return { text: '' }
    }

    return expressions.reduce((best, expr) => {
      const bestPriority = best.priority ?? 1
      const exprPriority = expr.priority ?? 1
      return exprPriority < bestPriority ? expr : best
    }, expressions[0]!)
  }

  /**
   * Compute priority weight based on matched expressions.
   * Lower priority numbers = higher weight.
   */
  private computePriorityWeight(needExpr: Expression, capacityExpr: Expression): number {
    const needPriority = needExpr.priority ?? 1
    const capacityPriority = capacityExpr.priority ?? 1

    // Convert priority to weight: priority 1 = 1.0, priority 2 = 0.9, priority 3 = 0.8, etc.
    const needWeight = Math.max(0.5, 1 - (needPriority - 1) * 0.1)
    const capacityWeight = Math.max(0.5, 1 - (capacityPriority - 1) * 0.1)

    // Combine weights (geometric mean)
    return Math.sqrt(needWeight * capacityWeight)
  }

  /**
   * Compute feasibility based on constraints.
   */
  private computeConstraintFeasibility(
    need: Need,
    capacity: Capacity
  ): { breakdown: Partial<MatchResult['breakdown']> } {
    const breakdown: Partial<MatchResult['breakdown']> = {}

    // Time feasibility
    if (need.constraints?.time || capacity.constraints?.time) {
      breakdown.time = this.computeTimeFeasibility(
        need.constraints?.time,
        capacity.constraints?.time
      )
    }

    // Space feasibility
    if (need.constraints?.space || capacity.constraints?.space) {
      breakdown.space = this.computeSpaceFeasibility(
        need.constraints?.space,
        capacity.constraints?.space
      )
    }

    // Quantity feasibility
    if (need.constraints?.quantity && capacity.constraints?.quantity) {
      breakdown.quantity = this.computeQuantityFeasibility(
        need.constraints.quantity,
        capacity.constraints.quantity
      )
    }

    return { breakdown }
  }

  private computeTimeFeasibility(
    needTime?: Constraints['time'],
    capacityTime?: Constraints['time']
  ): number {
    // TODO: Implement proper time overlap calculation
    if (!needTime && !capacityTime) return 1.0
    if (!needTime || !capacityTime) return 0.5
    return 1.0
  }

  private computeSpaceFeasibility(
    needSpace?: Constraints['space'],
    capacitySpace?: Constraints['space']
  ): number {
    // TODO: Implement proper distance calculation
    if (!needSpace && !capacitySpace) return 1.0
    if (!needSpace || !capacitySpace) return 0.5

    if (needSpace.area && capacitySpace.area) {
      return needSpace.area.toLowerCase() === capacitySpace.area.toLowerCase() ? 1.0 : 0.3
    }

    // Remote matching
    if (needSpace.remote && capacitySpace.remote) return 1.0

    return 0.5
  }

  private computeQuantityFeasibility(
    needQty: NonNullable<Need['constraints']>['quantity'],
    capacityQty: NonNullable<Capacity['constraints']>['quantity']
  ): number {
    if (!needQty || !capacityQty) return 1.0

    // Units must match (TODO: unit conversion)
    if (needQty.unit !== capacityQty.unit) return 0.0

    // Capacity must meet or exceed need
    if (capacityQty.amount >= needQty.amount) return 1.0

    // Partial satisfaction
    return capacityQty.amount / needQty.amount
  }
}
