import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

// Direct import from semantic-colors - single source of truth
import {
  embeddingToColor,
  type PCATransform,
} from '../semantic-colors.ts'

// Types matching the API response
type MatchData = {
  capacities: Array<{
    id: string
    expressions: string[]
    label: string
    embedding?: number[]
  }>
  needs: Array<{
    id: string
    expressions: string[]
    label: string
    embedding?: number[]
  }>
  pcaTransform: PCATransform
  matches: Array<{
    needId: string
    capacityId: string
    score: number
    breakdown: {
      time?: number
      space?: number
      quantity?: number
      similarity?: number
      priorityWeight?: number
      categoryMatch?: {
        overlapCategory: string
        overlapDistance: number
        isBlocked: boolean
      }
    }
    matchedExpressions?: {
      needText: string
      capacityText: string
      needChain?: string[]
      capacityChain?: string[]
    }
  }>
}

// Fallback colors when embeddings are missing
const DEFAULT_CAPACITY_COLOR = '#4CAF50'
const DEFAULT_NEED_COLOR = '#2196F3'

function getNodeColor(
  embedding: number[] | undefined,
  transform: PCATransform | undefined,
  isCapacity: boolean
): string {
  if (!embedding || !transform) {
    return isCapacity ? DEFAULT_CAPACITY_COLOR : DEFAULT_NEED_COLOR
  }
  return embeddingToColor(embedding, transform)
}

// Chord diagram configuration
const OUTER_RADIUS = 350
const NEED_RADIUS = 220

function App() {
  const [data, setData] = useState<MatchData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [threshold, setThreshold] = useState(0.75)
  const [lockedNodeId, setLockedNodeId] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<{
    id: string
    isCapacity: boolean
  } | null>(null)
  const [tooltipContent, setTooltipContent] = useState<React.ReactNode | null>(
    null
  )
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const [connectedTooltips, setConnectedTooltips] = useState<
    Array<{
      id: string
      isCapacity: boolean
      label: string
      color: string
      x: number
      y: number
    }>
  >([])
  const svgRef = useRef<SVGSVGElement>(null)
  const connectedTooltipsRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  // Fetch match data on mount
  useEffect(() => {
    fetch('/api/matches')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch match data')
        return res.json() as Promise<MatchData>
      })
      .then(setData)
      .catch((err: Error) => setError(err.message))
  }, [])

  // Get filtered matches based on threshold
  const getFilteredMatches = useCallback(() => {
    if (!data) return []
    return data.matches.filter(
      (m) => (m.breakdown.similarity ?? 1) >= threshold
    )
  }, [data, threshold])

  // Get matches for a specific node
  const getNodeMatches = useCallback(
    (nodeId: string, isCapacity: boolean) => {
      const filtered = getFilteredMatches()
      if (isCapacity) {
        return filtered
          .filter((m) => m.capacityId === nodeId)
          .map((m) => ({
            ...m,
            other: data?.needs.find((n) => n.id === m.needId),
            otherType: 'Need' as const,
          }))
      }
      return filtered
        .filter((m) => m.needId === nodeId)
        .map((m) => ({
          ...m,
          other: data?.capacities.find((c) => c.id === m.capacityId),
          otherType: 'Capacity' as const,
        }))
    },
    [data, getFilteredMatches]
  )

  // Get position for a node on its ring
  const getPosition = useCallback(
    (index: number, total: number, radius: number) => {
      const angle = (index / total) * Math.PI * 2 - Math.PI / 2
      return {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        angle,
      }
    },
    []
  )

  // Handle node hover/click
  const activeNodeId = lockedNodeId ?? hoveredNode?.id ?? null
  const activeIsCapacity = lockedNodeId
    ? data?.capacities.some((c) => c.id === lockedNodeId)
    : hoveredNode?.isCapacity

  // Get connected node IDs for highlighting
  const connectedIds = new Set<string>()
  if (activeNodeId) {
    connectedIds.add(activeNodeId)
    const matches = getNodeMatches(activeNodeId, activeIsCapacity ?? false)
    matches.forEach((m) => {
      if (m.other) connectedIds.add(m.other.id)
    })
  }

  // Build connection map for hover labels
  const connections = React.useMemo(() => {
    if (!data) return new Map<string, string[]>()
    const map = new Map<string, string[]>()
    data.matches.forEach((match) => {
      if (!map.has(match.capacityId)) map.set(match.capacityId, [])
      if (!map.has(match.needId)) map.set(match.needId, [])
      map.get(match.capacityId)!.push(match.needId)
      map.get(match.needId)!.push(match.capacityId)
    })
    return map
  }, [data])

  // Show connected tooltips when hovering a node
  const showConnectedTooltips = useCallback(
    (nodeId: string) => {
      if (!data || !svgRef.current) return

      const connectedIds = connections.get(nodeId) || []
      const tooltips: typeof connectedTooltips = []

      connectedIds.forEach((id) => {
        // Only show tooltip if the connecting chord is visible
        const chord = document.querySelector(
          `.chord[data-cap="${nodeId}"][data-need="${id}"], .chord[data-cap="${id}"][data-need="${nodeId}"]`
        ) as HTMLElement | null
        if (!chord || chord.style.display === 'none') return

        const cap = data.capacities.find((c) => c.id === id)
        const need = data.needs.find((n) => n.id === id)
        const item = cap || need
        if (!item) return

        const isCapacity = !!cap
        const color = getNodeColor(item.embedding, data.pcaTransform, isCapacity)

        // Find the node element to position tooltip near it
        const nodeEl = document.querySelector(`.node[data-id="${id}"]`)
        if (!nodeEl) return

        const rect = nodeEl.getBoundingClientRect()
        const label = item.label || item.expressions?.join(', ')

        tooltips.push({
          id,
          isCapacity,
          label: label || '',
          color,
          x: rect.left + rect.width / 2,
          y: rect.top,
        })
      })

      setConnectedTooltips(tooltips)
    },
    [data, connections]
  )

  const hideConnectedTooltips = useCallback(() => {
    setConnectedTooltips([])
  }, [])

  // Force simulation to resolve tooltip overlaps (runs after render)
  useEffect(() => {
    if (connectedTooltips.length === 0 || !connectedTooltipsRef.current || !tooltipRef.current) return

    const container = connectedTooltipsRef.current
    const tipEls = Array.from(container.children) as HTMLElement[]
    if (tipEls.length === 0) return

    // Get dimensions and initial positions
    const placedRects: Array<{
      el: HTMLElement
      x: number
      y: number
      width: number
      height: number
    }> = []
    tipEls.forEach((el, i) => {
      const tip = connectedTooltips[i]
      if (!tip) return
      const rect = el.getBoundingClientRect()
      placedRects.push({
        el,
        x: tip.x - rect.width / 2,
        y: tip.y - rect.height - 10,
        width: rect.width,
        height: rect.height,
      })
    })

    // Include main tooltip in repulsion (but don't move it)
    const mainTipRect = tooltipRef.current.getBoundingClientRect()
    const mainTip = {
      x: mainTipRect.left,
      y: mainTipRect.top,
      width: mainTipRect.width,
      height: mainTipRect.height,
    }

    // Force simulation to resolve overlaps
    const gap = 10
    for (let iter = 0; iter < 100; iter++) {
      let hasOverlap = false

      // Check connected tooltips against main tooltip
      for (const rect of placedRects) {
        const a = rect
        const b = mainTip
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
        if (overlapX > -gap && overlapY > -gap) {
          const sepX = overlapX + gap
          const sepY = overlapY + gap
          if (sepX > 0 && sepY > 0) {
            hasOverlap = true
            const aCx = a.x + a.width / 2,
              bCx = b.x + b.width / 2
            const aCy = a.y + a.height / 2,
              bCy = b.y + b.height / 2
            // Only move the connected tooltip, not the main one
            if (sepX < sepY) {
              const shift = sepX + 1
              a.x += aCx <= bCx ? -shift : shift
            } else {
              const shift = sepY + 1
              a.y += aCy <= bCy ? -shift : shift
            }
          }
        }
      }

      // Check connected tooltips against each other
      for (let i = 0; i < placedRects.length; i++) {
        for (let j = i + 1; j < placedRects.length; j++) {
          const a = placedRects[i]!
          const b = placedRects[j]!
          const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
          const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
          if (overlapX > -gap && overlapY > -gap) {
            const sepX = overlapX + gap
            const sepY = overlapY + gap
            if (sepX > 0 && sepY > 0) {
              hasOverlap = true
              const aCx = a.x + a.width / 2,
                bCx = b.x + b.width / 2
              const aCy = a.y + a.height / 2,
                bCy = b.y + b.height / 2
              if (sepX < sepY) {
                const shift = sepX / 2 + 0.5
                if (aCx <= bCx) {
                  a.x -= shift
                  b.x += shift
                } else {
                  a.x += shift
                  b.x -= shift
                }
              } else {
                const shift = sepY / 2 + 0.5
                if (aCy <= bCy) {
                  a.y -= shift
                  b.y += shift
                } else {
                  a.y += shift
                  b.y -= shift
                }
              }
            }
          }
        }
      }
      if (!hasOverlap) break
    }

    // Apply final positions
    for (const rect of placedRects) {
      rect.el.style.left = rect.x + 'px'
      rect.el.style.top = rect.y + 'px'
    }
  }, [connectedTooltips])

  // Show tooltip
  const showTooltip = (e: React.MouseEvent, content: React.ReactNode) => {
    setTooltipContent(content)
    setTooltipPos({ x: e.clientX + 10, y: e.clientY + 10 })
  }

  const hideTooltip = () => setTooltipContent(null)

  // Match badge component
  const MatchBadge = ({
    match,
  }: {
    match: MatchData['matches'][0]
  }) => {
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

  // Compute filtered stats
  const filteredMatches = getFilteredMatches()
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
      <div
        id="tooltip"
        ref={tooltipRef}
        style={{
          opacity: tooltipContent ? 1 : 0,
          left: tooltipPos.x,
          top: tooltipPos.y,
        }}
      >
        {tooltipContent}
      </div>
      <div id="connected-tooltips" ref={connectedTooltipsRef}>
        {connectedTooltips.map((tip) => (
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
          <svg
            ref={svgRef}
            id="chart"
            viewBox="-400 -400 800 800"
            onClick={(e) => {
              if (e.target === svgRef.current) {
                setLockedNodeId(null)
              }
            }}
          >
            {/* Chords */}
            <g id="chords">
              {data.matches.map((match) => {
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

                const capPos = getPosition(
                  capIndex,
                  data.capacities.length,
                  OUTER_RADIUS
                )
                const needPos = getPosition(
                  needIndex,
                  data.needs.length,
                  NEED_RADIUS
                )

                // Curved path using SVG arc
                const x1 = capPos.x,
                  y1 = capPos.y
                const x2 = needPos.x,
                  y2 = needPos.y
                const dx = x2 - x1,
                  dy = y2 - y1
                const chordLength = Math.sqrt(dx * dx + dy * dy)

                // Bow outward from center
                const midX = (x1 + x2) / 2
                const midY = (y1 + y2) / 2
                const perpX = -dy,
                  perpY = dx
                const dot = midX * perpX + midY * perpY
                const direction = dot >= 0 ? 1 : -1

                const curveIntensity = 0.15
                const sagitta = chordLength * curveIntensity * direction
                const absSagitta = Math.abs(sagitta)

                let d: string
                if (chordLength === 0 || absSagitta < 0.1) {
                  d = `M ${x1},${y1} L ${x2},${y2}`
                } else {
                  // Radius from chord L and sagitta h: r = (L²/4 + h²) / (2h)
                  const radius =
                    (chordLength * chordLength / 4 + absSagitta * absSagitta) /
                    (2 * absSagitta)
                  const sweepFlag = sagitta < 0 ? 1 : 0
                  d = `M ${x1},${y1} A ${radius},${radius} 0 0,${sweepFlag} ${x2},${y2}`
                }

                const similarity = match.breakdown.similarity ?? 1
                const isVisible = similarity >= threshold
                const isHighlighted =
                  !lockedNodeId ||
                  (activeIsCapacity
                    ? match.capacityId === activeNodeId
                    : match.needId === activeNodeId)

                const color = getNodeColor(
                  cap.embedding,
                  data.pcaTransform,
                  true
                )

                return (
                  <path
                    key={`${match.capacityId}-${match.needId}`}
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={Math.max(5, match.score * 12)}
                    opacity={
                      isVisible ? (lockedNodeId && !isHighlighted ? 0.1 : similarity * similarity) : 0
                    }
                    className="chord"
                    data-cap={match.capacityId}
                    data-need={match.needId}
                    style={{ display: isVisible ? '' : 'none' }}
                    onMouseEnter={(e) => {
                      const exprs = match.matchedExpressions
                      const catMatch = match.breakdown.categoryMatch
                      const needText =
                        exprs?.needText || need.expressions[0] || 'Need'
                      const capText =
                        exprs?.capacityText ||
                        cap.expressions[0] ||
                        'Capacity'

                      showTooltip(
                        e,
                        <div>
                          <strong>Match</strong>{' '}
                          <span style={{ color: '#4CAF50' }}>
                            {(match.score * 100).toFixed(0)}%
                          </span>
                          <MatchBadge match={match} />
                          <div className="match-connection">
                            <div className="match-connection-expr">
                              "{needText}"
                            </div>
                            <div className="match-connection-link">
                              {catMatch &&
                              !catMatch.isBlocked &&
                              catMatch.overlapCategory ? (
                                catMatch.overlapDistance === 0 ? (
                                  <span className="link-word">
                                    {catMatch.overlapCategory}
                                  </span>
                                ) : (
                                  <>
                                    <span>both relate to</span>
                                    <span className="link-word">
                                      {catMatch.overlapCategory}
                                    </span>
                                  </>
                                )
                              ) : (
                                <span>similar to</span>
                              )}
                            </div>
                            <div className="match-connection-expr">
                              "{capText}"
                            </div>
                          </div>
                        </div>
                      )
                    }}
                    onMouseLeave={hideTooltip}
                  />
                )
              })}
            </g>

            {/* Capacity nodes (outer ring) */}
            {data.capacities.map((cap, i) => {
              const pos = getPosition(i, data.capacities.length, OUTER_RADIUS)
              const color = getNodeColor(
                cap.embedding,
                data.pcaTransform,
                true
              )
              const isActive = connectedIds.has(cap.id)
              const opacity =
                lockedNodeId && !isActive ? 0.3 : 1

              return (
                <g
                  key={cap.id}
                  className="node capacity"
                  data-id={cap.id}
                  style={{ opacity }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setLockedNodeId(
                      lockedNodeId === cap.id ? null : cap.id
                    )
                  }}
                  onMouseEnter={(e) => {
                    if (!lockedNodeId) {
                      setHoveredNode({ id: cap.id, isCapacity: true })
                    }
                    showTooltip(
                      e,
                      <div>
                        <strong style={{ color }}>
                          Capacity #{cap.id}
                        </strong>
                        <br />
                        {cap.label}
                      </div>
                    )
                    showConnectedTooltips(cap.id)
                  }}
                  onMouseLeave={() => {
                    if (!lockedNodeId) setHoveredNode(null)
                    hideTooltip()
                    hideConnectedTooltips()
                  }}
                >
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={8}
                    fill={color}
                    stroke="#fff"
                    strokeWidth={1}
                  />
                </g>
              )
            })}

            {/* Need nodes (inner ring) */}
            {data.needs.map((need, i) => {
              const pos = getPosition(i, data.needs.length, NEED_RADIUS)
              const color = getNodeColor(
                need.embedding,
                data.pcaTransform,
                false
              )
              const isActive = connectedIds.has(need.id)
              const opacity =
                lockedNodeId && !isActive ? 0.3 : 1

              return (
                <g
                  key={need.id}
                  className="node need"
                  data-id={need.id}
                  style={{ opacity }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setLockedNodeId(
                      lockedNodeId === need.id ? null : need.id
                    )
                  }}
                  onMouseEnter={(e) => {
                    if (!lockedNodeId) {
                      setHoveredNode({ id: need.id, isCapacity: false })
                    }
                    showTooltip(
                      e,
                      <div>
                        <strong style={{ color }}>Need #{need.id}</strong>
                        <br />
                        {need.label}
                      </div>
                    )
                    showConnectedTooltips(need.id)
                  }}
                  onMouseLeave={() => {
                    if (!lockedNodeId) setHoveredNode(null)
                    hideTooltip()
                    hideConnectedTooltips()
                  }}
                >
                  <rect
                    x={pos.x - 6}
                    y={pos.y - 6}
                    width={12}
                    height={12}
                    fill={color}
                    stroke="#fff"
                    strokeWidth={1}
                  />
                </g>
              )
            })}
          </svg>
        </div>

        <div className="sidebar">
          {!activeNodeId ? (
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
                  <span>Similarity threshold</span>
                  <span className="slider-value">
                    {Math.round(threshold * 100)}%
                  </span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={threshold * 100}
                  onChange={(e) =>
                    setThreshold(parseInt((e.target as HTMLInputElement).value) / 100)
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
                    style={{
                      background: '#4CAF50',
                      borderRadius: '50%',
                    }}
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
              <p
                style={{
                  fontSize: '0.75em',
                  color: '#666',
                  marginTop: '8px',
                }}
              >
                Node colors derived from semantic embeddings
              </p>

              <h2>Hover for Details</h2>
              <div className="details">
                <p>Hover over nodes or chords to see details</p>
              </div>
            </div>
          ) : (
            <div className="sidebar-view active">
              <button
                className="back-button"
                onClick={() => {
                  setLockedNodeId(null)
                  setHoveredNode(null)
                }}
              >
                <span>&#8592;</span> Back to Overview
              </button>

              {activeItem && (
                <>
                  <div className="node-header">
                    <div
                      className={`node-header-icon ${activeIsCapacity ? 'capacity' : ''}`}
                      style={{
                        background: getNodeColor(
                          activeItem.embedding,
                          data.pcaTransform,
                          activeIsCapacity ?? false
                        ),
                      }}
                    />
                    <div>
                      <div className="node-title">
                        {activeIsCapacity ? 'Capacity' : 'Need'} #
                        {activeItem.id}
                      </div>
                    </div>
                  </div>
                  <p
                    style={{
                      fontSize: '0.9em',
                      color: '#ccc',
                      marginBottom: '15px',
                    }}
                  >
                    {activeItem.label}
                  </p>
                  <div style={{ fontSize: '0.85em', color: '#888' }}>
                    Expressions: {activeItem.expressions.join(', ')}
                  </div>

                  <h2 style={{ marginTop: '20px' }}>
                    Top Matches ({activeMatches.length})
                  </h2>
                  <div className="match-list">
                    {activeMatches.length === 0 && (
                      <p style={{ color: '#888' }}>
                        No matches above threshold
                      </p>
                    )}
                    {activeMatches.slice(0, 20).map((m) => (
                      <div
                        key={`${m.capacityId}-${m.needId}`}
                        className="match-item"
                      >
                        <div className="match-item-header">
                          <span>
                            {m.otherType} #{m.other?.id}
                          </span>
                          <span className="match-item-score">
                            {(m.score * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div className="match-item-label">
                          {m.other?.label || ''}
                        </div>
                        <div style={{ marginTop: '6px' }}>
                          <MatchBadge match={m} />
                        </div>
                      </div>
                    ))}
                    {activeMatches.length > 20 && (
                      <p
                        style={{
                          color: '#888',
                          textAlign: 'center',
                        }}
                      >
                        ... and {activeMatches.length - 20} more
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// Mount the app
const root = createRoot(document.getElementById('root')!)
root.render(<App />)
