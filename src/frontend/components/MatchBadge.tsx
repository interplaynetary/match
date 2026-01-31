import type { Match } from '../types.ts'

export function MatchBadge({ match }: { match: Match }): React.ReactElement {
  const cat = match.breakdown.categoryMatch

  if (cat && !cat.isBlocked && cat.overlapCategory) {
    if (cat.overlapDistance === 0) {
      return (
        <span className="match-level-badge match-level-exact">
          Both: {cat.overlapCategory}
        </span>
      )
    }
    return (
      <span className="match-level-badge match-level-related">
        Via: {cat.overlapCategory}
      </span>
    )
  }

  return (
    <span className="match-level-badge match-level-embedding">
      Similar meaning
    </span>
  )
}
