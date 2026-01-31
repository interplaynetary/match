import type { Match } from '../types.ts'
import { MatchBadge } from './MatchBadge.tsx'

type ChordTooltipContentProps = {
  match: Match
  needText: string
  capacityText: string
}

export function ChordTooltipContent({
  match,
  needText,
  capacityText,
}: ChordTooltipContentProps): React.ReactElement {
  const catMatch = match.breakdown.categoryMatch
  const hasCategory = catMatch && !catMatch.isBlocked && catMatch.overlapCategory

  return (
    <div>
      <strong>Match</strong>{' '}
      <span style={{ color: '#4CAF50' }}>
        {(match.score * 100).toFixed(0)}%
      </span>
      <MatchBadge match={match} />
      <div className="match-connection">
        <div className="match-connection-expr">"{needText}"</div>
        <div className="match-connection-link">
          {hasCategory ? (
            catMatch.overlapDistance === 0 ? (
              <span className="link-word">{catMatch.overlapCategory}</span>
            ) : (
              <>
                <span>both relate to</span>
                <span className="link-word">{catMatch.overlapCategory}</span>
              </>
            )
          ) : (
            <span>similar to</span>
          )}
        </div>
        <div className="match-connection-expr">"{capacityText}"</div>
      </div>
    </div>
  )
}
