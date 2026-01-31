/**
 * Builds a taxonomy tree from category chains found in expressions.
 */

export type TaxonomyNode = {
  id: string           // path: "root/goods/food"
  name: string         // display name: "food"
  children: TaxonomyNode[]
  expressionCount: number
  depth: number
  embedding?: number[] // average embedding of all expressions in this category
}

type ExampleWithExpressions = {
  embedding?: number[]
  expressions: Array<{
    categoryChain?: string[]
  }>
}

// Internal node type with embedding accumulator
type BuildNode = TaxonomyNode & {
  embeddingSum: number[]
  embeddingCount: number
}

export function buildTaxonomyTree(examples: ExampleWithExpressions[]): TaxonomyNode {
  const root: BuildNode = {
    id: 'root',
    name: 'Taxonomy',
    children: [],
    expressionCount: 0,
    depth: 0,
    embeddingSum: [],
    embeddingCount: 0,
  }

  const nodeMap = new Map<string, BuildNode>()
  nodeMap.set('root', root)

  for (const example of examples) {
    const embedding = example.embedding

    for (const expr of example.expressions) {
      if (!expr.categoryChain || expr.categoryChain.length === 0) continue

      let currentPath = 'root'
      let parent = root

      for (let i = 0; i < expr.categoryChain.length; i++) {
        const category = expr.categoryChain[i]
        const newPath = `${currentPath}/${category}`

        let node = nodeMap.get(newPath)
        if (!node) {
          node = {
            id: newPath,
            name: category,
            children: [],
            expressionCount: 0,
            depth: i + 1,
            embeddingSum: [],
            embeddingCount: 0,
          }
          nodeMap.set(newPath, node)
          parent.children.push(node)
        }

        node.expressionCount++

        // Accumulate embedding for averaging
        if (embedding && embedding.length > 0) {
          if (node.embeddingSum.length === 0) {
            node.embeddingSum = [...embedding]
          } else {
            for (let j = 0; j < embedding.length; j++) {
              node.embeddingSum[j] += embedding[j]
            }
          }
          node.embeddingCount++
        }

        parent = node
        currentPath = newPath
      }
    }
  }

  // Convert BuildNodes to TaxonomyNodes with averaged embeddings
  function finalize(node: BuildNode): TaxonomyNode {
    const result: TaxonomyNode = {
      id: node.id,
      name: node.name,
      children: node.children.map(c => finalize(c as BuildNode)),
      expressionCount: node.expressionCount,
      depth: node.depth,
    }

    if (node.embeddingCount > 0 && node.embeddingSum.length > 0) {
      result.embedding = node.embeddingSum.map(v => v / node.embeddingCount)
    }

    return result
  }

  const finalRoot = finalize(root)

  // Sort children alphabetically at each level
  function sortChildren(node: TaxonomyNode) {
    node.children.sort((a, b) => a.name.localeCompare(b.name))
    for (const child of node.children) {
      sortChildren(child)
    }
  }
  sortChildren(finalRoot)

  return finalRoot
}

/**
 * Get IDs of all nodes up to a certain depth (for initial expansion).
 */
export function getNodesAtDepth(root: TaxonomyNode, maxDepth: number): Set<string> {
  const ids = new Set<string>()

  function traverse(node: TaxonomyNode) {
    if (node.depth < maxDepth) {
      ids.add(node.id)
      for (const child of node.children) {
        traverse(child)
      }
    }
  }

  traverse(root)
  return ids
}

/**
 * Flatten tree into nodes and links for D3 force simulation.
 */
export function flattenTree(
  root: TaxonomyNode,
  expandedIds: Set<string>
): {
  nodes: Array<TaxonomyNode & { x?: number; y?: number }>
  links: Array<{ source: string; target: string }>
} {
  const nodes: TaxonomyNode[] = []
  const links: Array<{ source: string; target: string }> = []

  function traverse(node: TaxonomyNode, parentId: string | null) {
    nodes.push(node)
    if (parentId) {
      links.push({ source: parentId, target: node.id })
    }
    // Only traverse children if this node is expanded
    if (expandedIds.has(node.id)) {
      for (const child of node.children) {
        traverse(child, node.id)
      }
    }
  }

  traverse(root, null)
  return { nodes, links }
}
