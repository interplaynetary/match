import type { PCATransform } from '../../semantic-colors.ts'
import type { NodeItem } from '../types.ts'
import { getNodeColor } from '../utils.ts'

type ItemCardProps = {
  item: NodeItem
  isCapacity: boolean
  transform: PCATransform
  score?: number
  children?: React.ReactNode
}

export function ItemCard({ item, isCapacity, transform, score, children }: ItemCardProps): React.ReactElement {
  const color = getNodeColor(item.embedding, transform, isCapacity)

  return (
    <div className="match-item">
      <div className="match-item-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            className={`node-header-icon ${isCapacity ? 'capacity' : ''}`}
            style={{ background: color, width: 12, height: 12 }}
          />
          <span>{item.label}</span>
        </div>
        {score !== undefined && (
          <span className="match-item-score">
            {(score * 100).toFixed(0)}%
          </span>
        )}
      </div>
      <div style={{ fontSize: '0.8em', color: '#888', marginTop: 2 }}>
        {isCapacity ? 'Capacity' : 'Need'}
      </div>
      {children}
    </div>
  )
}
