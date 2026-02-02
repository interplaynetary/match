import { useState, useCallback, useRef, useEffect } from 'react'

export interface SearchResult {
  id: string
  score: number
  type: 'capacity' | 'need'
}

export type TypeFilter = 'all' | 'capacity' | 'need'

export interface SearchBarProps {
  threshold: number
  onResults: (results: SearchResult[]) => void
  onClear: () => void
}

export function SearchBar({ threshold, onResults, onClear }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [rawResults, setRawResults] = useState<SearchResult[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queryRef = useRef(query)
  queryRef.current = query

  // Apply type filter and notify parent
  const applyFilter = useCallback(
    (results: SearchResult[], filter: TypeFilter) => {
      const filtered = filter === 'all' ? results : results.filter((r) => r.type === filter)
      onResults(filtered)
    },
    [onResults]
  )

  const doSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setRawResults([])
        onClear()
        return
      }

      setIsSearching(true)
      try {
        const res = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: searchQuery, threshold }),
        })
        const data = await res.json()
        if (!res.ok) {
          console.error('Search failed:', data.error || res.statusText)
          return
        }
        if (data.results) {
          setRawResults(data.results)
          applyFilter(data.results, typeFilter)
        }
      } catch (err) {
        console.error('Search failed:', err)
      } finally {
        setIsSearching(false)
      }
    },
    [threshold, typeFilter, onClear, applyFilter]
  )

  // Re-apply filter when typeFilter changes
  useEffect(() => {
    if (rawResults.length > 0) {
      applyFilter(rawResults, typeFilter)
    }
  }, [typeFilter, rawResults, applyFilter])

  const handleChange = useCallback(
    (value: string) => {
      setQuery(value)

      // Clear previous debounce
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      if (!value.trim()) {
        onClear()
        return
      }

      // Debounce search by 300ms
      debounceRef.current = setTimeout(() => {
        doSearch(value)
      }, 300)
    },
    [doSearch, onClear]
  )

  const handleClear = useCallback(() => {
    setQuery('')
    setRawResults([])
    onClear()
  }, [onClear])

  // Re-run search when threshold changes (if there's an active query)
  useEffect(() => {
    if (queryRef.current.trim()) {
      doSearch(queryRef.current)
    }
  }, [threshold, doSearch])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  return (
    <div
      style={{
        position: 'absolute',
        top: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Search by meaning..."
          style={{
            width: 280,
            padding: '10px 36px 10px 14px',
            background: 'rgba(15, 52, 96, 0.9)',
            border: '1px solid #333',
            borderRadius: 20,
            color: '#eee',
            fontSize: 14,
            outline: 'none',
            backdropFilter: 'blur(8px)',
          }}
        />
        {query && (
          <button
            onClick={handleClear}
            style={{
              position: 'absolute',
              right: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              color: '#888',
              fontSize: 16,
              cursor: 'pointer',
              padding: 4,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
        {isSearching && (
          <span
            style={{
              position: 'absolute',
              right: 32,
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#888',
              fontSize: 12,
            }}
          >
            ...
          </span>
        )}
      </div>
      {query && (
        <div style={{ display: 'flex', gap: 4 }}>
          {(['all', 'capacity', 'need'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setTypeFilter(filter)}
              style={{
                padding: '6px 10px',
                background: typeFilter === filter ? 'rgba(100, 150, 200, 0.8)' : 'rgba(15, 52, 96, 0.7)',
                border: '1px solid #444',
                borderRadius: 12,
                color: typeFilter === filter ? '#fff' : '#aaa',
                fontSize: 11,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {filter === 'all' ? 'All' : filter === 'capacity' ? 'Offers' : 'Needs'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
