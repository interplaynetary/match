import type { Match, ConstraintDetail } from '../types.ts'

type ConstraintScoresProps = {
  breakdown: Match['breakdown']
  compact?: boolean
  showSide?: 'need' | 'capacity'  // which side's constraint to show (for context-aware display)
}

// SVG icons for each constraint type
const CONSTRAINT_ICONS: Record<string, React.ReactElement> = {
  time: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12,6 12,12 16,14" />
    </svg>
  ),
  space: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  quantity: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  ),
}

function getScoreColor(score: number): string {
  if (score >= 0.8) return '#4CAF50'
  if (score >= 0.5) return '#FFC107'
  return '#f44336'
}

function getDescription(detail: ConstraintDetail | undefined, showSide?: 'need' | 'capacity'): string | undefined {
  if (!detail) return undefined

  // If showSide is specified, show just that side's constraint
  if (showSide === 'need' && detail.needDesc) {
    return detail.needDesc
  }
  if (showSide === 'capacity' && detail.capacityDesc) {
    return detail.capacityDesc
  }

  // Fallback to full reason
  return detail.reason
}

export function ConstraintScores({ breakdown, compact, showSide }: ConstraintScoresProps): React.ReactElement | null {
  const constraints: Array<{ key: string; score: number; description?: string }> = []

  if (breakdown.timeDetail) {
    constraints.push({
      key: 'time',
      score: breakdown.timeDetail.score,
      description: getDescription(breakdown.timeDetail, showSide)
    })
  } else if (breakdown.time !== undefined) {
    constraints.push({ key: 'time', score: breakdown.time })
  }

  if (breakdown.spaceDetail) {
    constraints.push({
      key: 'space',
      score: breakdown.spaceDetail.score,
      description: getDescription(breakdown.spaceDetail, showSide)
    })
  } else if (breakdown.space !== undefined) {
    constraints.push({ key: 'space', score: breakdown.space })
  }

  if (breakdown.quantityDetail) {
    constraints.push({
      key: 'quantity',
      score: breakdown.quantityDetail.score,
      description: getDescription(breakdown.quantityDetail, showSide)
    })
  } else if (breakdown.quantity !== undefined) {
    constraints.push({ key: 'quantity', score: breakdown.quantity })
  }

  if (constraints.length === 0) return null

  if (compact) {
    return (
      <div className="constraint-scores-compact">
        {constraints.map(({ key, score, description }) => (
          <div key={key} className="constraint-pill-row">
            <span
              className="constraint-pill"
              style={{ color: getScoreColor(score), display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              {CONSTRAINT_ICONS[key]}
              <span>{description || key}</span>
            </span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="constraint-scores" style={{ marginTop: '8px', fontSize: '0.85em' }}>
      {constraints.map(({ key, score, description }) => (
        <div
          key={key}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginBottom: '4px',
            color: getScoreColor(score),
          }}
        >
          {CONSTRAINT_ICONS[key]}
          <span>{description || key}</span>
        </div>
      ))}
    </div>
  )
}
