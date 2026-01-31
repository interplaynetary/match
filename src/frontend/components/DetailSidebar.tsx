import type { PCATransform } from '../../semantic-colors.ts'
import type { NodeItem, MatchWithOther, ConstraintSummary } from '../types.ts'
import { getNodeColor } from '../utils.ts'
import { MatchBadge } from './MatchBadge.tsx'
import { ConstraintScores } from './ConstraintScores.tsx'

type DetailSidebarProps = {
  activeItem: NodeItem
  activeIsCapacity: boolean
  activeMatches: MatchWithOther[]
  transform: PCATransform
  onBack: () => void
}

function ConstraintsSummary({ constraints }: { constraints?: ConstraintSummary }) {
  if (!constraints) return null
  const entries = Object.entries(constraints).filter(([_, v]) => v)
  if (entries.length === 0) return null

  return (
    <div className="active-constraints">
      {entries.map(([key, value]) => (
        <div key={key} className="constraint-row">
          <span className="constraint-label">{key}:</span>
          <span>{value}</span>
        </div>
      ))}
    </div>
  )
}

export function DetailSidebar({
  activeItem,
  activeIsCapacity,
  activeMatches,
  transform,
  onBack,
}: DetailSidebarProps): React.ReactElement {
  const color = getNodeColor(activeItem.embedding, transform, activeIsCapacity)

  return (
    <div className="sidebar-view active">
      <button className="back-button" onClick={onBack}>
        <span>&#8592;</span> Back to Overview
      </button>

      <div className="node-header">
        <div
          className={`node-header-icon ${activeIsCapacity ? 'capacity' : ''}`}
          style={{ background: color }}
        />
        <div>
          <div className="node-title">
            {activeIsCapacity ? 'Capacity' : 'Need'} #{activeItem.id}
          </div>
        </div>
      </div>
      <p style={{ fontSize: '0.9em', color: '#ccc', marginBottom: '15px' }}>
        {activeItem.label}
      </p>

      <ConstraintsSummary constraints={activeItem.constraints} />

      <h2 style={{ marginTop: '20px' }}>Top Matches ({activeMatches.length})</h2>
      <div className="match-list">
        {activeMatches.length === 0 && (
          <p style={{ color: '#888' }}>No matches above threshold</p>
        )}
        {activeMatches.slice(0, 20).map((m) => (
          <div key={`${m.capacityId}-${m.needId}`} className="match-item">
            <div className="match-item-header">
              <span>
                {m.otherType} #{m.other?.id}
              </span>
              <span className="match-item-score">
                {(m.score * 100).toFixed(0)}%
              </span>
            </div>
            <div className="match-item-label">{m.other?.label || ''}</div>
            <div style={{ marginTop: '6px' }}>
              <MatchBadge match={m} />
            </div>
            <ConstraintScores
              breakdown={m.breakdown}
              compact
              showSide={activeIsCapacity ? 'need' : 'capacity'}
            />
          </div>
        ))}
        {activeMatches.length > 20 && (
          <p style={{ color: '#888', textAlign: 'center' }}>
            ... and {activeMatches.length - 20} more
          </p>
        )}
      </div>
    </div>
  )
}
