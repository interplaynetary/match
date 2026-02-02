import { useState, useRef, useCallback, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

import type { MatchWithOther } from './types.ts'
import { OUTER_RADIUS, NEED_RADIUS } from './constants.ts'
import { getNodeColor, getPosition, matchPassesThreshold } from './utils.ts'
import {
  useMatchData,
  useTooltip,
  useConnectedTooltips,
  useTooltipOverlapResolution,
} from './hooks/index.ts'
import {
  Chord,
  Node,
  OverviewSidebar,
  DetailSidebar,
  TaxonomyTreeView,
  AddEntryDialog,
  SearchBar,
  type SearchResult,
} from './components/index.ts'

type ViewMode = 'chord' | 'taxonomy'

function App(): React.ReactElement {
  const { data, error, refetch } = useMatchData()
  const [viewMode, setViewMode] = useState<ViewMode>('chord')
  const [threshold, setThreshold] = useState(0.8)
  const [lockedNodeId, setLockedNodeId] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<{
    id: string
    isCapacity: boolean
  } | null>(null)
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const tooltip = useTooltip()

  // Build connection map for hover labels
  const connections = useMemo(() => {
    if (!data) return new Map<string, string[]>()
    const map = new Map<string, string[]>()
    for (const match of data.matches) {
      if (!map.has(match.capacityId)) map.set(match.capacityId, [])
      if (!map.has(match.needId)) map.set(match.needId, [])
      map.get(match.capacityId)!.push(match.needId)
      map.get(match.needId)!.push(match.capacityId)
    }
    return map
  }, [data])

  const connectedTooltips = useConnectedTooltips(data, connections)

  useTooltipOverlapResolution(
    connectedTooltips.tooltips,
    connectedTooltips.ref,
    tooltip.ref
  )

  // Get filtered matches based on threshold
  const filteredMatches = useMemo(() => {
    if (!data) return []
    return data.matches.filter((m) => matchPassesThreshold(m, threshold))
  }, [data, threshold])

  // Get matches for a specific node
  const getNodeMatches = useCallback(
    (nodeId: string, isCapacity: boolean): MatchWithOther[] => {
      if (!data) return []
      if (isCapacity) {
        return filteredMatches
          .filter((m) => m.capacityId === nodeId)
          .map((m) => ({
            ...m,
            other: data.needs.find((n) => n.id === m.needId),
            otherType: 'Need' as const,
          }))
      }
      return filteredMatches
        .filter((m) => m.needId === nodeId)
        .map((m) => ({
          ...m,
          other: data.capacities.find((c) => c.id === m.capacityId),
          otherType: 'Capacity' as const,
        }))
    },
    [data, filteredMatches]
  )

  // Derive active node state
  const activeNodeId = lockedNodeId ?? hoveredNode?.id ?? null
  const activeIsCapacity = lockedNodeId
    ? data?.capacities.some((c) => c.id === lockedNodeId)
    : hoveredNode?.isCapacity

  // Get connected node IDs for highlighting
  const connectedIds = useMemo(() => {
    const ids = new Set<string>()
    if (activeNodeId) {
      ids.add(activeNodeId)
      const matches = getNodeMatches(activeNodeId, activeIsCapacity ?? false)
      for (const m of matches) {
        if (m.other) ids.add(m.other.id)
      }
    }
    return ids
  }, [activeNodeId, activeIsCapacity, getNodeMatches])

  // Node interaction handlers
  const handleNodeSelect = useCallback(
    (id: string) => {
      setLockedNodeId(lockedNodeId === id ? null : id)
    },
    [lockedNodeId]
  )

  const handleNodeHover = useCallback((id: string, isCapacity: boolean) => {
    setHoveredNode({ id, isCapacity })
  }, [])

  const handleNodeLeave = useCallback(() => {
    setHoveredNode(null)
  }, [])

  const handleBackToOverview = useCallback(() => {
    setLockedNodeId(null)
    setHoveredNode(null)
  }, [])

  const handleSvgClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === svgRef.current) {
        setLockedNodeId(null)
      }
    },
    []
  )

  const handleAddEntry = useCallback(
    async (entry: { naturalLanguage: string; type: 'capacity' | 'need' }) => {
      const res = await fetch('/api/add-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      })
      const result = await res.json()
      if (!res.ok) {
        throw new Error(result.error || 'Failed to add entry')
      }
      await refetch()
    },
    [refetch]
  )

  const handleSearchResults = useCallback((results: SearchResult[]) => {
    setSearchResults(results)
  }, [])

  const handleSearchClear = useCallback(() => {
    setSearchResults(null)
  }, [])

  // Build set of matching IDs from search
  const searchMatchIds = useMemo(() => {
    if (!searchResults) return null
    return new Set(searchResults.map((r) => r.id))
  }, [searchResults])

  // When searching, filter matches to only show connections involving search results
  const visibleMatches = useMemo(() => {
    if (!searchMatchIds) return filteredMatches
    return filteredMatches.filter(
      (m) => searchMatchIds.has(m.capacityId) || searchMatchIds.has(m.needId)
    )
  }, [filteredMatches, searchMatchIds])

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          color: '#ff6b6b',
        }}
      >
        Error: {error}
      </div>
    )
  }

  if (!data) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
        }}
      >
        Loading...
      </div>
    )
  }

  // Compute stats
  const needsWithMatches = new Set(filteredMatches.map((m) => m.needId)).size
  const capacitiesWithMatches = new Set(filteredMatches.map((m) => m.capacityId)).size

  const activeItem = activeNodeId
    ? activeIsCapacity
      ? data.capacities.find((c) => c.id === activeNodeId)
      : data.needs.find((n) => n.id === activeNodeId)
    : null

  const activeMatches = activeNodeId
    ? getNodeMatches(activeNodeId, activeIsCapacity ?? false).sort(
        (a, b) => b.score - a.score
      )
    : []

  return (
    <>
      <AddEntryDialog onSubmit={handleAddEntry} />
      <div
        id="tooltip"
        ref={tooltip.ref}
        style={{
          opacity: tooltip.content ? 1 : 0,
          left: tooltip.position.x,
          top: tooltip.position.y,
        }}
      >
        {tooltip.content}
      </div>
      <div id="connected-tooltips" ref={connectedTooltips.ref}>
        {connectedTooltips.tooltips.map((tip) => (
          <div key={tip.id}>
            <strong style={{ color: tip.color }}>
              {tip.isCapacity ? 'Capacity' : 'Need'} #{tip.id}
            </strong>
            <br />
            {tip.label}
          </div>
        ))}
      </div>

      <div className="container">
        <div className="viz">
          <SearchBar threshold={threshold} onResults={handleSearchResults} onClear={handleSearchClear} />
          {viewMode === 'taxonomy' ? (
            <TaxonomyTreeView />
          ) : (
            <svg
              ref={svgRef}
              id="chart"
              viewBox="-400 -400 800 800"
              onClick={handleSvgClick}
            >
              {/* Chords - uses visibleMatches (filtered by search when active) */}
              <g id="chords">
                {visibleMatches.map((match) => {
                  const capIndex = data.capacities.findIndex(
                    (c) => c.id === match.capacityId
                  )
                  const needIndex = data.needs.findIndex(
                    (n) => n.id === match.needId
                  )
                  if (capIndex === -1 || needIndex === -1) return null

                  const cap = data.capacities[capIndex]
                  const need = data.needs[needIndex]
                  if (!cap || !need) return null

                  const capPos = getPosition(capIndex, data.capacities.length, OUTER_RADIUS)
                  const needPos = getPosition(needIndex, data.needs.length, NEED_RADIUS)
                  const color = getNodeColor(cap.embedding, data.pcaTransform, true)

                  // Chord matches search if either endpoint matches
                  const chordSearchMatch = searchMatchIds
                    ? searchMatchIds.has(match.capacityId) || searchMatchIds.has(match.needId)
                    : null

                  return (
                    <Chord
                      key={`${match.capacityId}-${match.needId}`}
                      match={match}
                      capacity={cap}
                      need={need}
                      capPos={capPos}
                      needPos={needPos}
                      color={color}
                      lockedNodeId={lockedNodeId}
                      activeNodeId={activeNodeId}
                      activeIsCapacity={activeIsCapacity}
                      searchMatch={chordSearchMatch}
                      onShowTooltip={tooltip.show}
                      onHideTooltip={tooltip.hide}
                    />
                  )
                })}
              </g>

              {/* Capacity nodes (outer ring) */}
              {data.capacities.map((cap, i) => (
                <Node
                  key={cap.id}
                  item={cap}
                  index={i}
                  total={data.capacities.length}
                  radius={OUTER_RADIUS}
                  isCapacity={true}
                  color={getNodeColor(cap.embedding, data.pcaTransform, true)}
                  isConnected={connectedIds.has(cap.id)}
                  lockedNodeId={lockedNodeId}
                  searchMatch={searchMatchIds ? searchMatchIds.has(cap.id) : null}
                  onSelect={handleNodeSelect}
                  onHover={handleNodeHover}
                  onLeave={handleNodeLeave}
                  onShowTooltip={tooltip.show}
                  onHideTooltip={tooltip.hide}
                  onShowConnectedTooltips={connectedTooltips.show}
                  onHideConnectedTooltips={connectedTooltips.hide}
                />
              ))}

              {/* Need nodes (inner ring) */}
              {data.needs.map((need, i) => (
                <Node
                  key={need.id}
                  item={need}
                  index={i}
                  total={data.needs.length}
                  radius={NEED_RADIUS}
                  isCapacity={false}
                  color={getNodeColor(need.embedding, data.pcaTransform, false)}
                  isConnected={connectedIds.has(need.id)}
                  lockedNodeId={lockedNodeId}
                  searchMatch={searchMatchIds ? searchMatchIds.has(need.id) : null}
                  onSelect={handleNodeSelect}
                  onHover={handleNodeHover}
                  onLeave={handleNodeLeave}
                  onShowTooltip={tooltip.show}
                  onHideTooltip={tooltip.hide}
                  onShowConnectedTooltips={connectedTooltips.show}
                  onHideConnectedTooltips={connectedTooltips.hide}
                />
              ))}
            </svg>
          )}
        </div>

        <div className="sidebar">
          <div className="view-toggle">
            <button
              className={viewMode === 'chord' ? 'active' : ''}
              onClick={() => setViewMode('chord')}
            >
              Matches
            </button>
            <button
              className={viewMode === 'taxonomy' ? 'active' : ''}
              onClick={() => setViewMode('taxonomy')}
            >
              Taxonomy
            </button>
          </div>
          {!activeNodeId ? (
            <OverviewSidebar
              data={data}
              filteredMatches={filteredMatches}
              needsWithMatches={needsWithMatches}
              capacitiesWithMatches={capacitiesWithMatches}
              threshold={threshold}
              onThresholdChange={setThreshold}
            />
          ) : activeItem ? (
            <DetailSidebar
              activeItem={activeItem}
              activeIsCapacity={activeIsCapacity ?? false}
              activeMatches={activeMatches}
              transform={data.pcaTransform}
              onBack={handleBackToOverview}
            />
          ) : null}
        </div>
      </div>
    </>
  )
}

// Mount the app
const root = createRoot(document.getElementById('root')!)
root.render(<App />)
