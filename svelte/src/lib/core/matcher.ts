import type {
  Capacity,
  Constraints,
  Need,
  MatchResult,
  Expression,
  CategoryMatch,
} from './types'
import { cosineSimilarity } from './embeddings'
import {
  findCategoryOverlap,
  findSemanticOverlap,
  hasDisjointConflict,
  computeCategoryScore,
  computeSpecificity,
  type CategoryInfo,
} from './category-matcher'
import { haversineDistance } from './spatial'
import { availabilityWindowsOverlapWithTimezone } from './matching'
import type { AvailabilityWindow, DayOfWeek, TimeRange } from './time'

export type EmbeddingsLookup = Record<string, number[]>

export type MatcherOptions = {
  similarityThreshold?: number  // minimum similarity to consider a match (default 0.6)
  embeddings?: EmbeddingsLookup  // all embeddings (items + category names)
  semanticThreshold?: number    // similarity threshold for wormhole matching (default 0.8)
}

export class Matcher {
  private similarityThreshold: number
  private embeddings: EmbeddingsLookup | null
  private semanticThreshold: number

  constructor(options: MatcherOptions = {}) {
    this.similarityThreshold = options.similarityThreshold ?? 0.6
    this.embeddings = options.embeddings ?? null
    this.semanticThreshold = options.semanticThreshold ?? 0.8
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
   * Returns null if no valid match (e.g., missing embeddings or disjoint conflict).
   */
  private computeMatch(need: Need, capacity: Capacity): MatchResult | null {
    // Require embeddings for matching
    if (!need.embedding || !capacity.embedding) {
      return null
    }

    // Check for category-based matching first
    const categoryResult = this.findBestCategoryMatch(need.expressions, capacity.expressions)

    // If there's a disjoint conflict, block the match entirely
    if (categoryResult?.isBlocked) {
      return null
    }

    // Compute overall similarity between embeddings
    const rawSimilarity = cosineSimilarity(need.embedding, capacity.embedding)
    const embeddingSimilarity = Math.max(0, rawSimilarity)

    // Compute final similarity score
    // If we have a category match within distance threshold, blend category score with embedding score
    // Otherwise, use pure embedding similarity
    let similarity = embeddingSimilarity
    let effectiveCategoryResult = categoryResult
    if (categoryResult) {
      const categoryScore = computeCategoryScore(categoryResult.overlapDistance)
      if (categoryScore !== null) {
        // Category match within threshold: 70% category score, 30% embedding score
        similarity = categoryScore * 0.7 + embeddingSimilarity * 0.3
      } else {
        // Distance too high, category match is too generic to use
        effectiveCategoryResult = null  // don't report as category match
      }
    }

    // Find best matching expression pair for reporting
    const bestExpressions = this.findBestExpressionMatch(need, capacity)
    const matchedExpressions = { ...bestExpressions, similarity }

    // Compute priority weight (higher priority = lower number = higher weight)
    const priorityWeight = this.computePriorityWeight(matchedExpressions.need, matchedExpressions.capacity)

    // Compute constraint feasibility
    const constraintFeasibility = this.computeConstraintFeasibility(need, capacity)

    // Combine scores: similarity * priorityWeight * constraintFeasibility
    const breakdown: MatchResult['breakdown'] = {
      similarity,
      specificity: effectiveCategoryResult?.specificity,
      priorityWeight,
      ...constraintFeasibility.breakdown,
      categoryMatch: effectiveCategoryResult ?? undefined,
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
   * Find the best category match across all expression pairs.
   * Returns the match with the lowest distance, or null if no overlap.
   * Also checks for disjoint conflicts.
   */
  private findBestCategoryMatch(
    needExprs: Expression[],
    capacityExprs: Expression[]
  ): CategoryMatch | null {
    let bestMatch: CategoryMatch | null = null

    for (const needExpr of needExprs) {
      if (!needExpr.categoryChain) continue

      for (const capacityExpr of capacityExprs) {
        if (!capacityExpr.categoryChain) continue

        // Check for disjoint conflict first
        const needInfo: CategoryInfo = {
          chain: needExpr.categoryChain,
          disjointWith: needExpr.disjointWith ?? [],
        }
        const capacityInfo: CategoryInfo = {
          chain: capacityExpr.categoryChain,
          disjointWith: capacityExpr.disjointWith ?? [],
        }

        if (hasDisjointConflict(needInfo, capacityInfo)) {
          return {
            overlapCategory: '',
            overlapDistance: 0,
            isBlocked: true,
            specificity: 0,
          }
        }

        // Try exact matching first
        const exactOverlap = findCategoryOverlap(needExpr.categoryChain, capacityExpr.categoryChain)
        if (exactOverlap) {
          const specificity = computeSpecificity(exactOverlap.matchDepthA, exactOverlap.matchDepthB)
          const match: CategoryMatch = {
            overlapCategory: exactOverlap.category,
            overlapDistance: exactOverlap.distance,
            isBlocked: false,
            specificity,
          }

          if (!bestMatch || exactOverlap.distance < bestMatch.overlapDistance ||
              (exactOverlap.distance === bestMatch.overlapDistance && specificity > bestMatch.specificity)) {
            bestMatch = match
          }
        }

        // Try semantic matching if embeddings available (may find better match than exact)
        if (this.embeddings) {
          const needEmbs = needExpr.categoryChain.map(c => this.embeddings![c])
          const capEmbs = capacityExpr.categoryChain.map(c => this.embeddings![c])

          const semanticOverlap = findSemanticOverlap(
            needExpr.categoryChain,
            capacityExpr.categoryChain,
            needEmbs,
            capEmbs,
            this.semanticThreshold
          )

          if (semanticOverlap) {
            const specificity = computeSpecificity(semanticOverlap.matchDepthA, semanticOverlap.matchDepthB)
            // Use similarity as a factor in the score
            const match: CategoryMatch = {
              overlapCategory: `${semanticOverlap.nodeA}≈${semanticOverlap.nodeB}`,
              overlapDistance: semanticOverlap.blurDistance,
              isBlocked: false,
              specificity: specificity * semanticOverlap.similarity,
            }

            if (!bestMatch || semanticOverlap.blurDistance < bestMatch.overlapDistance ||
                (semanticOverlap.blurDistance === bestMatch.overlapDistance && match.specificity > bestMatch.specificity)) {
              bestMatch = match
            }
          }
        }
      }
    }

    return bestMatch
  }

  /**
   * Find the best matching pair of expressions between need and capacity.
   * TODO: per-expression embedding matching instead of just highest priority
   */
  private findBestExpressionMatch(
    need: Need,
    capacity: Capacity
  ): { need: Expression; capacity: Expression } {
    return {
      need: this.getHighestPriorityExpression(need.expressions),
      capacity: this.getHighestPriorityExpression(capacity.expressions),
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

    // Time feasibility - only include if at least one side has a meaningful time constraint
    if (hasTimeConstraint(need.constraints?.time) || hasTimeConstraint(capacity.constraints?.time)) {
      const detail = this.computeTimeFeasibility(
        need.constraints?.time,
        capacity.constraints?.time
      )
      breakdown.time = detail.score
      breakdown.timeDetail = detail
    }

    // Space feasibility - only include if at least one side has a meaningful space constraint
    if (hasSpaceConstraint(need.constraints?.space) || hasSpaceConstraint(capacity.constraints?.space)) {
      const detail = this.computeSpaceFeasibility(
        need.constraints?.space,
        capacity.constraints?.space
      )
      breakdown.space = detail.score
      breakdown.spaceDetail = detail
    }

    // Quantity feasibility - only include if at least one side has a meaningful quantity constraint
    if (hasQuantityConstraint(need.constraints?.quantity) || hasQuantityConstraint(capacity.constraints?.quantity)) {
      const detail = this.computeQuantityFeasibility(
        need.constraints?.quantity,
        capacity.constraints?.quantity
      )
      breakdown.quantity = detail.score
      breakdown.quantityDetail = detail
    }

    return { breakdown }
  }

  private computeTimeFeasibility(
    needTime?: Constraints['time'],
    capacityTime?: Constraints['time']
  ): { score: number; reason: string; needDesc?: string; capacityDesc?: string } {
    const needHas = hasTimeConstraint(needTime)
    const capHas = hasTimeConstraint(capacityTime)

    if (!needHas && !capHas) {
      return { score: 1.0, reason: 'No time constraints' }
    }

    const needDesc = describeTimeConstraint(needTime)
    const capDesc = describeTimeConstraint(capacityTime)

    if (!needHas) {
      return { score: 0.5, reason: `Need: any time | Capacity: ${capDesc}`, needDesc: 'any time', capacityDesc: capDesc }
    }
    if (!capHas) {
      return { score: 0.5, reason: `Need: ${needDesc} | Capacity: any time`, needDesc, capacityDesc: 'any time' }
    }

    // Convert to AvailabilityWindow format
    const needWindow = timeConstraintToAvailabilityWindow(needTime)
    const capacityWindow = timeConstraintToAvailabilityWindow(capacityTime)

    // Use System 2's timezone-aware overlap function
    const overlaps = availabilityWindowsOverlapWithTimezone(needWindow, capacityWindow)

    if (overlaps) {
      return { score: 1.0, reason: `overlaps`, needDesc, capacityDesc: capDesc }
    }
    return { score: 0.0, reason: `no overlap`, needDesc, capacityDesc: capDesc }
  }

  private computeSpaceFeasibility(
    needSpace?: Constraints['space'],
    capacitySpace?: Constraints['space']
  ): { score: number; reason: string; needDesc?: string; capacityDesc?: string } {
    const needHas = hasSpaceConstraint(needSpace)
    const capHas = hasSpaceConstraint(capacitySpace)

    // If neither has meaningful space data, no constraint
    if (!needHas && !capHas) {
      return { score: 1.0, reason: 'No location constraints' }
    }

    const needDesc = describeSpaceConstraint(needSpace)
    const capDesc = describeSpaceConstraint(capacitySpace)

    // One side missing = uncertainty
    if (!needHas || !needSpace) {
      return { score: 0.5, reason: `any location vs ${capDesc}`, needDesc: 'any location', capacityDesc: capDesc }
    }
    if (!capHas || !capacitySpace) {
      return { score: 0.5, reason: `${needDesc} vs any location`, needDesc, capacityDesc: 'any location' }
    }

    // Remote matching - both remote is perfect
    if (needSpace.remote && capacitySpace.remote) {
      return { score: 1.0, reason: 'both remote', needDesc, capacityDesc: capDesc }
    }
    // One remote, one not - partial match
    if (needSpace.remote || capacitySpace.remote) {
      return { score: 0.7, reason: 'remote vs in-person', needDesc, capacityDesc: capDesc }
    }

    // Distance-based matching using haversineDistance
    if (needSpace.location && capacitySpace.location) {
      const distance = haversineDistance(
        needSpace.location.lat,
        needSpace.location.lng,
        capacitySpace.location.lat,
        capacitySpace.location.lng
      )
      const maxRadius = needSpace.maxRadius ?? capacitySpace.maxRadius ?? 50 // default 50km
      if (distance > maxRadius) {
        return { score: 0.0, reason: `${distance.toFixed(1)}km apart (max ${maxRadius}km)`, needDesc, capacityDesc: capDesc }
      }
      // Linear decay: 1.0 at 0km, 0.0 at maxRadius
      const score = Math.max(0, 1.0 - distance / maxRadius)
      return { score, reason: `${distance.toFixed(1)}km apart`, needDesc, capacityDesc: capDesc }
    }

    // Fallback: area string matching
    if (needSpace.area && capacitySpace.area) {
      if (needSpace.area.toLowerCase() === capacitySpace.area.toLowerCase()) {
        return { score: 1.0, reason: 'same area', needDesc, capacityDesc: capDesc }
      }
      return { score: 0.3, reason: 'different areas', needDesc, capacityDesc: capDesc }
    }

    return { score: 0.5, reason: 'partial info', needDesc, capacityDesc: capDesc }
  }

  private computeQuantityFeasibility(
    needQty?: NonNullable<Need['constraints']>['quantity'],
    capacityQty?: NonNullable<Capacity['constraints']>['quantity']
  ): { score: number; reason: string; needDesc?: string; capacityDesc?: string } {
    const needHas = hasQuantityConstraint(needQty)
    const capHas = hasQuantityConstraint(capacityQty)

    if (!needHas && !capHas) {
      return { score: 1.0, reason: 'No quantity constraints' }
    }

    const needDesc = needHas && needQty ? `${needQty.amount}${needQty.unit}` : 'any amount'
    const capDesc = capHas && capacityQty ? `${capacityQty.amount}${capacityQty.unit}` : 'any amount'

    // Need has quantity, capacity doesn't specify limits → assume capacity can handle it
    if (needHas && !capHas) {
      return { score: 1.0, reason: 'capacity unlimited', needDesc, capacityDesc: capDesc }
    }

    // Capacity has quantity, need doesn't specify → need is flexible
    if (!needHas && capHas) {
      return { score: 1.0, reason: 'need flexible', needDesc, capacityDesc: capDesc }
    }

    // Both have constraints - compare them
    if (!needQty || !capacityQty) {
      return { score: 1.0, reason: 'compatible' }
    }

    // Units must match (TODO: unit conversion)
    if (needQty.unit !== capacityQty.unit) {
      return { score: 0.0, reason: `unit mismatch`, needDesc, capacityDesc: capDesc }
    }

    // Capacity must meet or exceed need
    if (capacityQty.amount >= needQty.amount) {
      return { score: 1.0, reason: 'sufficient', needDesc, capacityDesc: capDesc }
    }

    // Partial satisfaction
    const score = capacityQty.amount / needQty.amount
    return { score, reason: 'partial', needDesc, capacityDesc: capDesc
    }
  }
}

// Helper: Describe a time constraint in human-readable form
export function describeTimeConstraint(time?: Constraints['time']): string {
  if (!time) return 'any time'

  // Cast to any to handle various time constraint formats in the data
  const t = time as Record<string, unknown>
  const parts: string[] = []

  // Handle days array (e.g., ["Monday", "Tuesday", "Wednesday"])
  if (Array.isArray(t.days)) {
    if (t.days.length <= 3) {
      parts.push(t.days.join(', '))
    } else {
      parts.push(`${t.days.slice(0, 2).join(', ')}... (${t.days.length} days)`)
    }
  } else if (t.dayOfWeek) {
    parts.push(String(t.dayOfWeek))
  }

  // Handle hours object (e.g., { start: "09:00", end: "17:00" })
  if (t.hours && typeof t.hours === 'object') {
    const hours = t.hours as { start?: string; end?: string }
    if (hours.start && hours.end) {
      parts.push(`${hours.start}-${hours.end}`)
    }
  } else if (t.timeOfDay) {
    parts.push(String(t.timeOfDay))
  }

  // Handle date range
  if (t.availableFrom && t.availableTo) {
    parts.push(`${t.availableFrom} to ${t.availableTo}`)
  } else if (t.availableFrom) {
    parts.push(`from ${t.availableFrom}`)
  } else if (t.availableTo) {
    parts.push(`until ${t.availableTo}`)
  }

  // Handle single date
  if (t.date) {
    parts.push(String(t.date))
  }

  // Handle urgency
  if (t.urgency) {
    parts.push(String(t.urgency))
  }

  // Handle deadline
  if (t.deadline) {
    if (typeof t.deadline === 'string') {
      parts.push(`deadline: ${t.deadline}`)
    } else if (typeof t.deadline === 'object') {
      const dl = t.deadline as Record<string, number>
      const unit = Object.keys(dl)[0]
      if (unit) parts.push(`deadline: ${dl[unit]} ${unit}`)
    }
  }

  // Handle duration
  if (t.duration) {
    if (typeof t.duration === 'string') {
      parts.push(`duration: ${t.duration}`)
    } else if (typeof t.duration === 'object') {
      const dur = t.duration as Record<string, number>
      const unit = Object.keys(dur)[0]
      if (unit) parts.push(`${dur[unit]} ${unit}`)
    }
  }

  // Handle frequency
  if (t.frequency) {
    if (typeof t.frequency === 'string') {
      parts.push(t.frequency)
    } else if (typeof t.frequency === 'object') {
      const freq = t.frequency as Record<string, number>
      const key = Object.keys(freq)[0]
      if (key) parts.push(`${freq[key]}x ${key.replace('per', '/')}`)
    }
  }

  // Handle month/season
  if (t.month) parts.push(String(t.month))
  if (t.season) parts.push(String(t.season))

  // Handle timeframe
  if (t.timeframe) parts.push(String(t.timeframe))

  // Handle hours per week
  if (t.hoursPerWeek && typeof t.hoursPerWeek === 'object') {
    const h = t.hoursPerWeek as { min?: number; max?: number }
    if (h.min && h.max) {
      parts.push(`${h.min}-${h.max} hrs/week`)
    }
  }

  // Handle max duration
  if (t.maxDuration && typeof t.maxDuration === 'object') {
    const md = t.maxDuration as Record<string, number>
    const unit = Object.keys(md)[0]
    if (unit) parts.push(`max ${md[unit]} ${unit}`)
  }

  // Add timezone if present
  if (t.timezone && parts.length > 0) {
    parts.push(`(${t.timezone})`)
  }

  // Add recurring indicator only if it's a string (not just true)
  if (t.recurring && typeof t.recurring === 'string') {
    parts.push(`(${t.recurring})`)
  }

  return parts.length > 0 ? parts.join(' ') : 'has time constraint'
}

// Helper: Describe a space constraint in human-readable form
export function describeSpaceConstraint(space?: Constraints['space']): string {
  if (!space) return 'any location'

  if (space.remote) return 'remote'
  if (space.area) return space.area
  if (space.location) {
    const radius = space.maxRadius ? ` (${space.maxRadius}km radius)` : ''
    return `${space.location.lat.toFixed(2)}, ${space.location.lng.toFixed(2)}${radius}`
  }

  return 'specified location'
}

// Helper: Describe a quantity constraint in human-readable form
export function describeQuantityConstraint(qty?: Constraints['quantity']): string {
  if (!qty || (qty.amount == null && qty.unit == null)) return 'any amount'
  return `${qty.amount ?? ''} ${qty.unit ?? ''}`.trim()
}

// Helper: Check if time constraint has any meaningful values
function hasTimeConstraint(t?: Constraints['time']): boolean {
  if (!t) return false
  // Cast to any to handle various time constraint formats in the data
  const constraint = t as Record<string, unknown>
  return !!(t.availableFrom || t.availableTo || t.dayOfWeek || t.timeOfDay || t.recurring || t.minDuration ||
    // Also check for enriched data formats
    (Array.isArray(constraint.days) && constraint.days.length > 0) ||
    (constraint.hours && typeof constraint.hours === 'object'))
}

// Helper: Check if space constraint has any meaningful values
function hasSpaceConstraint(s?: Constraints['space']): boolean {
  if (!s) return false
  return !!(s.location || s.area || s.maxRadius || s.remote)
}

// Helper: Check if quantity constraint has any meaningful values
function hasQuantityConstraint(q?: Constraints['quantity']): boolean {
  if (!q) return false
  return !!(q.amount || q.unit || q.minAtomic)
}

// Helper: Convert TimeConstraint to AvailabilityWindow format
function timeConstraintToAvailabilityWindow(
  constraint: Constraints['time']
): AvailabilityWindow | undefined {
  if (!constraint) return undefined

  // Cast to any to handle various time constraint formats in the data
  const t = constraint as Record<string, unknown>
  const result: AvailabilityWindow = {}

  // Parse time ranges from various formats
  let timeRanges: TimeRange[] | undefined

  // Check for hours object (e.g., { start: "09:00", end: "17:00" })
  if (t.hours && typeof t.hours === 'object') {
    const hours = t.hours as { start?: string; end?: string }
    if (hours.start && hours.end) {
      timeRanges = [{ start_time: hours.start, end_time: hours.end }]
    }
  }
  // Fall back to timeOfDay string parsing
  else if (constraint.timeOfDay) {
    timeRanges = parseTimeOfDay(constraint.timeOfDay)
  }

  // Parse days from various formats
  // Check for days array (e.g., ["Monday", "Tuesday", "Wednesday"])
  if (Array.isArray(t.days) && t.days.length > 0) {
    const validDays: DayOfWeek[] = []
    for (const d of t.days) {
      const day = String(d).toLowerCase()
      if (isValidDayOfWeek(day)) {
        validDays.push(day)
      }
    }
    if (validDays.length > 0) {
      result.day_schedules = [{
        days: validDays,
        time_ranges: timeRanges ?? [{ start_time: '00:00', end_time: '23:59' }]
      }]
    }
  }
  // Fall back to dayOfWeek (singular)
  else if (constraint.dayOfWeek) {
    const day = constraint.dayOfWeek.toLowerCase()
    if (isValidDayOfWeek(day)) {
      result.day_schedules = [{
        days: [day],
        time_ranges: timeRanges ?? [{ start_time: '00:00', end_time: '23:59' }]
      }]
    }
  } else if (timeRanges) {
    // No specific day, just time ranges (apply to all days)
    result.time_ranges = timeRanges
  }

  return Object.keys(result).length > 0 ? result : undefined
}

function parseTimeOfDay(timeOfDay: string): TimeRange[] {
  // Handle named periods
  const namedPeriods: Record<string, TimeRange> = {
    'morning': { start_time: '06:00', end_time: '12:00' },
    'afternoon': { start_time: '12:00', end_time: '18:00' },
    'evening': { start_time: '18:00', end_time: '22:00' },
    'night': { start_time: '22:00', end_time: '06:00' },
    'business': { start_time: '09:00', end_time: '17:00' }
  }

  const lower = timeOfDay.toLowerCase()
  if (namedPeriods[lower]) {
    return [namedPeriods[lower]!]
  }

  // Handle "HH:MM-HH:MM" format
  const rangeMatch = timeOfDay.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/)
  if (rangeMatch) {
    return [{
      start_time: rangeMatch[1]!.padStart(5, '0'),
      end_time: rangeMatch[2]!.padStart(5, '0')
    }]
  }

  // Fallback: all day
  return [{ start_time: '00:00', end_time: '23:59' }]
}

function isValidDayOfWeek(day: string): day is DayOfWeek {
  return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].includes(day)
}
