import { embeddingToColor, type PCATransform } from '../core/ai/semantic-colors.ts'
import { DEFAULT_CAPACITY_COLOR, DEFAULT_NEED_COLOR } from './constants.ts'
import type { Match } from './types'

/**
 * Check if a match passes the threshold filter.
 * Uses the combined feasibility score (match.score), not raw similarity.
 */
export function matchPassesThreshold(match: Match, threshold: number): boolean {
  return match.score >= threshold
}

export function getNodeColor(
  embedding: number[] | undefined,
  transform: PCATransform | undefined,
  isCapacity: boolean
): string {
  if (!embedding || !transform) {
    return isCapacity ? DEFAULT_CAPACITY_COLOR : DEFAULT_NEED_COLOR
  }
  return embeddingToColor(embedding, transform)
}

export function getPosition(
  index: number,
  total: number,
  radius: number
): { x: number; y: number; angle: number } {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    angle,
  }
}

export function computeChordPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): string {
  const dx = x2 - x1
  const dy = y2 - y1
  const chordLength = Math.sqrt(dx * dx + dy * dy)

  // Bow outward from center
  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2
  const perpX = -dy
  const perpY = dx
  const dot = midX * perpX + midY * perpY
  const direction = dot >= 0 ? 1 : -1

  const curveIntensity = 0.15
  const sagitta = chordLength * curveIntensity * direction
  const absSagitta = Math.abs(sagitta)

  if (chordLength === 0 || absSagitta < 0.1) {
    return `M ${x1},${y1} L ${x2},${y2}`
  }

  // Radius from chord L and sagitta h: r = (L^2/4 + h^2) / (2h)
  const radius =
    (chordLength * chordLength / 4 + absSagitta * absSagitta) /
    (2 * absSagitta)
  const sweepFlag = sagitta < 0 ? 1 : 0
  return `M ${x1},${y1} A ${radius},${radius} 0 0,${sweepFlag} ${x2},${y2}`
}
