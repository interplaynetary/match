import type {
  Capacity,
  Constraints,
  Need,
  MatchResult,
  SatisfactionPath,
  TypeCompatibility,
} from './types'
import { DEFAULT_TYPE_COMPATIBILITIES } from './types'

export class Matcher {
  private typeCompatibilities: TypeCompatibility[]

  constructor(customCompatibilities?: TypeCompatibility[]) {
    this.typeCompatibilities = customCompatibilities ?? DEFAULT_TYPE_COMPATIBILITIES
  }

  /**
   * Check if a capacity type satisfies a need's required type
   * Handles both direct matches and asymmetric type compatibility
   */
  typeMatches(capacityType: string, needRequires: string): boolean {
    // Normalize to lowercase for comparison
    const capType = capacityType.toLowerCase()
    const needType = needRequires.toLowerCase()

    // Direct match
    if (capType === needType) return true

    // Check asymmetric compatibility
    const compatibility = this.typeCompatibilities.find(
      (c) => c.capacityType.toLowerCase() === capType
    )
    if (compatibility) {
      return compatibility.satisfiesNeedFor.some((t) => t.toLowerCase() === needType)
    }

    return false
  }

  /**
   * Check if a capacity can satisfy a single satisfaction path
   */
  satisfiesPath(capacity: Capacity, path: SatisfactionPath): boolean {
    if (path.type === 'direct') {
      if (!this.typeMatches(capacity.capacityType, path.requires)) {
        return false
      }
      // Check attribute requirements if specified
      if (path.attributes) {
        for (const [key, value] of Object.entries(path.attributes)) {
          if (capacity.attributes?.[key] !== value) {
            return false
          }
        }
      }
      return true
    }

    if (path.type === 'composite') {
      // For composite paths, this single capacity must satisfy at least one component
      // Full composite matching requires multiple capacities - handled separately
      return path.all.some((subPath) => this.satisfiesPath(capacity, subPath))
    }

    return false
  }

  /**
   * Find all capacities that could satisfy a need
   */
  findMatches(need: Need, capacities: Capacity[]): MatchResult[] {
    const results: MatchResult[] = []

    for (const capacity of capacities) {
      for (const path of need.satisfactionPaths) {
        if (this.satisfiesPath(capacity, path)) {
          const feasibility = this.computeFeasibility(need, capacity)
          results.push({
            needId: need.id,
            capacityId: capacity.id,
            satisfiedVia: path,
            feasibilityScore: feasibility.total,
            breakdown: feasibility.breakdown,
          })
        }
      }
    }

    // Sort by feasibility score descending
    return results.sort((a, b) => b.feasibilityScore - a.feasibilityScore)
  }

  /**
   * Compute feasibility score for a need-capacity pair
   */
  computeFeasibility(
    need: Need,
    capacity: Capacity
  ): { total: number; breakdown: MatchResult['breakdown'] } {
    const breakdown: MatchResult['breakdown'] = {}
    const scores: number[] = []

    // Time feasibility
    if (need.constraints?.time || capacity.constraints?.time) {
      breakdown.time = this.computeTimeFeasibility(
        need.constraints?.time,
        capacity.constraints?.time
      )
      scores.push(breakdown.time)
    }

    // Space feasibility
    if (need.constraints?.space || capacity.constraints?.space) {
      breakdown.space = this.computeSpaceFeasibility(
        need.constraints?.space,
        capacity.constraints?.space
      )
      scores.push(breakdown.space)
    }

    // Quantity feasibility
    if (need.constraints?.quantity && capacity.constraints?.quantity) {
      breakdown.quantity = this.computeQuantityFeasibility(
        need.constraints.quantity,
        capacity.constraints.quantity
      )
      scores.push(breakdown.quantity)
    }

    // Type match score (1.0 for direct, 0.8 for asymmetric compatibility)
    breakdown.type = 1.0
    scores.push(breakdown.type)

    // Combine scores (geometric mean to penalize any low score)
    const total = scores.length > 0
      ? Math.pow(scores.reduce((a, b) => a * b, 1), 1 / scores.length)
      : 1.0

    return { total, breakdown }
  }

  private computeTimeFeasibility(
    needTime?: Constraints['time'],
    capacityTime?: Constraints['time']
  ): number {
    // TODO: Implement proper time overlap calculation
    // For now, return 1.0 if both have time constraints (optimistic)
    // Return 0.5 if only one has constraints (uncertain)
    if (!needTime && !capacityTime) return 1.0
    if (!needTime || !capacityTime) return 0.5
    return 1.0
  }

  private computeSpaceFeasibility(
    needSpace?: Constraints['space'],
    capacitySpace?: Constraints['space']
  ): number {
    // TODO: Implement proper distance calculation
    // For now, check area string match
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
