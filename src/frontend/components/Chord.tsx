import type { Match, NodeItem } from '../types.ts'
import { computeChordPath } from '../utils.ts'
import { ChordTooltipContent } from './ChordTooltipContent.tsx'

type ChordProps = {
  match: Match
  capacity: NodeItem
  need: NodeItem
  capPos: { x: number; y: number }
  needPos: { x: number; y: number }
  color: string
  threshold: number
  lockedNodeId: string | null
  activeNodeId: string | null
  activeIsCapacity: boolean | undefined
  onShowTooltip: (e: React.MouseEvent, content: React.ReactNode) => void
  onHideTooltip: () => void
}

export function Chord({
  match,
  capacity,
  need,
  capPos,
  needPos,
  color,
  threshold,
  lockedNodeId,
  activeNodeId,
  activeIsCapacity,
  onShowTooltip,
  onHideTooltip,
}: ChordProps): React.ReactElement | null {
  // Threshold filters on similarity (match quality) - determines if match appears
  const similarity = match.breakdown.similarity ?? 1
  const isVisible = similarity >= threshold

  // Opacity uses specificity (match precision) - determines visual emphasis
  const specificity = match.breakdown.specificity ?? similarity

  if (!isVisible) {
    return (
      <path
        d={computeChordPath(capPos.x, capPos.y, needPos.x, needPos.y)}
        fill="none"
        stroke={color}
        strokeWidth={Math.max(5, match.score * 12)}
        opacity={0}
        className="chord"
        data-cap={match.capacityId}
        data-need={match.needId}
        style={{ display: 'none' }}
      />
    )
  }

  const isHighlighted =
    !lockedNodeId ||
    (activeIsCapacity
      ? match.capacityId === activeNodeId
      : match.needId === activeNodeId)

  // Square specificity for visual emphasis
  const baseOpacity = specificity * specificity
  // When locked to a node, hide non-highlighted edges completely
  const opacity = lockedNodeId && !isHighlighted ? 0 : baseOpacity

  const handleMouseEnter = (e: React.MouseEvent) => {
    const exprs = match.matchedExpressions
    const needText = exprs?.needText || need.expressions[0] || 'Need'
    const capText = exprs?.capacityText || capacity.expressions[0] || 'Capacity'

    onShowTooltip(
      e,
      <ChordTooltipContent
        match={match}
        needText={needText}
        capacityText={capText}
      />
    )
  }

  return (
    <path
      d={computeChordPath(capPos.x, capPos.y, needPos.x, needPos.y)}
      fill="none"
      stroke={color}
      strokeWidth={Math.max(5, match.score * 12)}
      opacity={opacity}
      className="chord"
      data-cap={match.capacityId}
      data-need={match.needId}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={onHideTooltip}
    />
  )
}
