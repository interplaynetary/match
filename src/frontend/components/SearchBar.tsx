import { useState, useCallback, useRef, useEffect } from 'react'

export interface SearchResult {
  id: string
  score: number
  type: 'capacity' | 'need'
}

export interface SearchBarProps {
  threshold: number
  onResults: (results: SearchResult[]) => void
  onClear: () => void
}

export function SearchBar({ threshold, onResults, onClear }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) {
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
          onResults(data.results)
        }
      } catch (err) {
        console.error('Search failed:', err)
      } finally {
        setIsSearching(false)
      }
    },
    [threshold, onResults, onClear]
  )

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
    onClear()
  }, [onClear])

  // Re-run search when threshold changes (if there's an active query)
  useEffect(() => {
    if (query.trim()) {
      doSearch(query)
    }
  }, [threshold]) // eslint-disable-line react-hooks/exhaustive-deps

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
      </div>
      {isSearching && (
        <span style={{ color: '#888', fontSize: 12 }}>...</span>
      )}
    </div>
  )
}
