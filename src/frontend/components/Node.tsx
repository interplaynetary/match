import type { NodeItem } from '../types.ts'
import { getPosition } from '../utils.ts'
import { NodeTooltipContent } from './NodeTooltipContent.tsx'

type NodeProps = {
  item: NodeItem
  index: number
  total: number
  radius: number
  isCapacity: boolean
  color: string
  isConnected: boolean
  lockedNodeId: string | null
  searchMatch: boolean | null // null = no search active, true/false = matches search
  onSelect: (id: string) => void
  onHover: (id: string, isCapacity: boolean) => void
  onLeave: () => void
  onShowTooltip: (e: React.MouseEvent, content: React.ReactNode) => void
  onHideTooltip: () => void
  onShowConnectedTooltips: (nodeId: string) => void
  onHideConnectedTooltips: () => void
}

export function Node({
  item,
  index,
  total,
  radius,
  isCapacity,
  color,
  isConnected,
  lockedNodeId,
  searchMatch,
  onSelect,
  onHover,
  onLeave,
  onShowTooltip,
  onHideTooltip,
  onShowConnectedTooltips,
  onHideConnectedTooltips,
}: NodeProps): React.ReactElement {
  const pos = getPosition(index, total, radius)
  // Dim if: locked and not connected, OR search active and not matching
  const dimmed = (lockedNodeId && !isConnected) || (searchMatch === false)
  const opacity = dimmed ? 0.15 : 1

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect(item.id)
  }

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (!lockedNodeId) {
      onHover(item.id, isCapacity)
    }
    onShowTooltip(
      e,
      <NodeTooltipContent item={item} isCapacity={isCapacity} color={color} />
    )
    onShowConnectedTooltips(item.id)
  }

  const handleMouseLeave = () => {
    if (!lockedNodeId) onLeave()
    onHideTooltip()
    onHideConnectedTooltips()
  }

  return (
    <g
      className={`node ${isCapacity ? 'capacity' : 'need'}`}
      data-id={item.id}
      style={{ opacity }}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {isCapacity ? (
        <circle
          cx={pos.x}
          cy={pos.y}
          r={8}
          fill={color}
          stroke="#fff"
          strokeWidth={1}
        />
      ) : (
        <rect
          x={pos.x - 6}
          y={pos.y - 6}
          width={12}
          height={12}
          fill={color}
          stroke="#fff"
          strokeWidth={1}
        />
      )}
    </g>
  )
}
