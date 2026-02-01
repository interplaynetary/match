import type { MatchData, Match } from '../types.ts'

type OverviewSidebarProps = {
  data: MatchData
  filteredMatches: Match[]
  needsWithMatches: number
  capacitiesWithMatches: number
  threshold: number
  onThresholdChange: (value: number) => void
}

export function OverviewSidebar({
  data,
  filteredMatches,
  needsWithMatches,
  threshold,
  onThresholdChange,
}: OverviewSidebarProps): React.ReactElement {
  return (
    <div className="sidebar-view active">
      <h1>Match Visualization</h1>
      <div className="stats">
        <div className="stat">
          <div className="stat-value">{data.capacities.length}</div>
          <div className="stat-label">Capacities</div>
        </div>
        <div className="stat">
          <div className="stat-value">{data.needs.length}</div>
          <div className="stat-label">Needs</div>
        </div>
        <div className="stat">
          <div className="stat-value">{filteredMatches.length}</div>
          <div className="stat-label">Matches</div>
        </div>
        <div className="stat">
          <div className="stat-value">
            {needsWithMatches}/{data.needs.length}
          </div>
          <div className="stat-label">Needs Covered</div>
        </div>
      </div>

      <h2>Threshold</h2>
      <div className="slider-container">
        <label>
          <span>Match threshold</span>
          <span className="slider-value">{Math.round(threshold * 100)}%</span>
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value={threshold * 100}
          onChange={(e) =>
            onThresholdChange(parseInt((e.target as HTMLInputElement).value) / 100)
          }
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.7em',
            color: '#666',
            marginTop: '4px',
          }}
        >
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>

      <h2>Legend</h2>
      <div className="legend">
        <div className="legend-item">
          <div
            className="legend-color"
            style={{ background: '#4CAF50', borderRadius: '50%' }}
          />
          <span>Capacity (outer ring)</span>
        </div>
        <div className="legend-item">
          <div
            className="legend-color"
            style={{ background: '#2196F3', borderRadius: 0 }}
          />
          <span>Need (inner ring)</span>
        </div>
      </div>
      <p style={{ fontSize: '0.75em', color: '#666', marginTop: '8px' }}>
        Node colors derived from semantic embeddings
      </p>

      <h2>Hover for Details</h2>
      <div className="details">
        <p>Hover over nodes or chords to see details</p>
      </div>
    </div>
  )
}
