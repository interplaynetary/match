import type { NodeItem } from '../types.ts'

type NodeTooltipContentProps = {
  item: NodeItem
  isCapacity: boolean
  color: string
}

export function NodeTooltipContent({
  item,
  isCapacity,
  color,
}: NodeTooltipContentProps): React.ReactElement {
  return (
    <div>
      <strong style={{ color }}>
        {isCapacity ? 'Capacity' : 'Need'} #{item.id}
      </strong>
      <br />
      {item.label}
    </div>
  )
}
