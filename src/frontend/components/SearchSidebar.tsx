import type { PCATransform } from '../../semantic-colors.ts'
import type { MatchData } from '../types.ts'
import type { SearchResult } from './SearchBar.tsx'
import { ItemCard } from './ItemCard.tsx'
import { ThresholdSlider } from './ThresholdSlider.tsx'

type SearchSidebarProps = {
  searchResults: SearchResult[]
  data: MatchData
  transform: PCATransform
  threshold: number
  onThresholdChange: (value: number) => void
  onClear: () => void
}

export function SearchSidebar({
  searchResults,
  data,
  transform,
  threshold,
  onThresholdChange,
  onClear,
}: SearchSidebarProps): React.ReactElement {
  return (
    <div className="sidebar-view active">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Search Results ({searchResults.length})</h1>
        <button
          onClick={onClear}
          style={{
            background: 'none',
            border: 'none',
            color: '#888',
            fontSize: 20,
            cursor: 'pointer',
            padding: '4px 8px',
          }}
        >
          ×
        </button>
      </div>

      <ThresholdSlider threshold={threshold} onThresholdChange={onThresholdChange} />

      <div className="match-list" style={{ marginTop: '20px' }}>
        {searchResults.length === 0 && (
          <p style={{ color: '#888' }}>No results</p>
        )}
        {searchResults.map((result) => {
          const isCapacity = result.type === 'capacity'
          const item = isCapacity
            ? data.capacities.find((c) => c.id === result.id)
            : data.needs.find((n) => n.id === result.id)
          if (!item) return null
          return (
            <ItemCard
              key={result.id}
              item={item}
              isCapacity={isCapacity}
              transform={transform}
              score={result.score}
            />
          )
        })}
      </div>
    </div>
  )
}
