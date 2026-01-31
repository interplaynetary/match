import { useState, useCallback, useEffect, useMemo } from 'react'
import { getNodesAtDepth } from '../../taxonomy-tree.ts'
import { embeddingToColor } from '../../semantic-colors.ts'
import { useTaxonomyData, useForceSimulation } from '../hooks/index.ts'
import type { TreemapRect } from '../hooks/useForceSimulation.ts'
import type { PCATransform } from '../../semantic-colors.ts'

const WIDTH = 900
const HEIGHT = 600
const INITIAL_DEPTH = 3

// Fallback colors when no embedding available
const DEPTH_COLORS = [
  '#1a1a2e', // root
  '#16213e', // level 1
  '#0f3460', // level 2
  '#1a4a7a', // level 3+
]

function getColor(
  rect: TreemapRect,
  pcaTransform: PCATransform | null
): string {
  // Use semantic color if embedding available
  if (rect.embedding && pcaTransform) {
    return embeddingToColor(rect.embedding, pcaTransform)
  }
  // Fallback to depth-based color
  return DEPTH_COLORS[Math.min(rect.depth, DEPTH_COLORS.length - 1)]
}

export function TaxonomyTreeView(): React.ReactElement {
  const { data, pcaTransform, error } = useTaxonomyData()
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  // Initialize expanded nodes when data loads
  useEffect(() => {
    if (data) {
      setExpandedIds(getNodesAtDepth(data, INITIAL_DEPTH))
    }
  }, [data])

  const { rects } = useForceSimulation(data, expandedIds, WIDTH, HEIGHT)

  const toggleNode = useCallback((nodeId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        // Collapse: remove this node and all descendants
        next.delete(nodeId)
        for (const id of prev) {
          if (id.startsWith(nodeId + '/')) {
            next.delete(id)
          }
        }
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [])

  // Get breadcrumb path for hovered node
  const breadcrumb = useMemo(() => {
    if (!hoveredId) return null
    const parts = hoveredId.split('/').slice(1) // Remove 'root'
    return parts.join(' > ')
  }, [hoveredId])

  if (error) {
    return <div className="tree-error">Error loading taxonomy: {error}</div>
  }

  if (!data) {
    return <div className="tree-loading">Loading taxonomy...</div>
  }

  return (
    <div className="treemap-container">
      <div className="treemap-breadcrumb">
        {breadcrumb || 'Hover over a category to see its path'}
      </div>
      <svg
        className="taxonomy-treemap"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {rects.map((rect) => {
          const width = rect.x1 - rect.x0
          const height = rect.y1 - rect.y0
          const isExpanded = expandedIds.has(rect.id)
          const isHovered = hoveredId === rect.id
          const showLabel = width > 30 && height > 14

          // Skip root
          if (rect.depth === 0) return null

          const color = getColor(rect, pcaTransform)

          return (
            <g
              key={rect.id}
              className={`treemap-cell ${rect.hasChildren ? 'has-children' : 'leaf'} ${isHovered ? 'hovered' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                if (rect.hasChildren) toggleNode(rect.id)
              }}
              onMouseEnter={() => setHoveredId(rect.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{ cursor: rect.hasChildren ? 'pointer' : 'default' }}
            >
              <rect
                x={rect.x0}
                y={rect.y0}
                width={width}
                height={height}
                fill={color}
                stroke={isHovered ? '#fff' : '#222'}
                strokeWidth={isHovered ? 2 : 1}
              />
              {showLabel && (
                <text
                  x={rect.x0 + 4}
                  y={rect.y0 + 13}
                  className="treemap-label"
                >
                  {rect.name}
                  {rect.hasChildren && !isExpanded && ' +'}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
