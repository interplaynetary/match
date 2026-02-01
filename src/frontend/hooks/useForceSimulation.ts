import { useState, useEffect } from 'react'
import * as d3 from 'd3'
import type { TaxonomyNode, CohesionScore } from '../../taxonomy-tree.ts'

export type TreemapRect = {
  id: string
  name: string
  x0: number
  y0: number
  x1: number
  y1: number
  depth: number
  hasChildren: boolean
  expressionCount: number
  parent: string | null
  embedding?: number[]
  cohesion?: CohesionScore
}

export function useForceSimulation(
  root: TaxonomyNode | null,
  expandedIds: Set<string>,
  width: number,
  height: number
): {
  rects: TreemapRect[]
  isSimulating: boolean
} {
  const [rects, setRects] = useState<TreemapRect[]>([])

  useEffect(() => {
    if (!root) return

    // Build a filtered tree with only expanded nodes
    function filterTree(node: TaxonomyNode): TaxonomyNode {
      const isExpanded = expandedIds.has(node.id)
      return {
        ...node,
        children: isExpanded
          ? node.children.map(filterTree)
          : [],
      }
    }

    const filteredRoot = filterTree(root)

    // Create d3 hierarchy with sum for sizing
    const hierarchy = d3.hierarchy(filteredRoot)
      .sum(d => d.children.length === 0 ? Math.max(d.expressionCount, 1) : 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))

    // Create treemap layout
    const treemap = d3.treemap<TaxonomyNode>()
      .size([width, height])
      .paddingOuter(3)
      .paddingTop(19)
      .paddingInner(2)
      .round(true)

    const treemapRoot = treemap(hierarchy)

    // Convert to rects array
    const newRects: TreemapRect[] = treemapRoot.descendants().map(node => ({
      id: node.data.id,
      name: node.data.name,
      x0: node.x0,
      y0: node.y0,
      x1: node.x1,
      y1: node.y1,
      depth: node.depth,
      hasChildren: node.data.children.length > 0,
      expressionCount: node.data.expressionCount,
      parent: node.parent?.data.id ?? null,
      embedding: node.data.embedding,
      cohesion: node.data.cohesion,
    }))

    setRects(newRects)
  }, [root, expandedIds, width, height])

  return { rects, isSimulating: false }
}
