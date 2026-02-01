/**
 * Taxonomy tree for managing hierarchical category chains
 *
 * Supports comparing new paths against existing structure and
 * merging them intelligently.
 */

export type CategoryPath = string[]

export type ConflictResult = {
  type: 'conflict'
  conflictingNode: string
  existingLocation: CategoryPath
  proposedLocation: CategoryPath
}

export type CompareResult =
  | { type: 'novel'; overlapDepth: 0 }
  | { type: 'exact-match' }
  | { type: 'extension'; existingPath: CategoryPath; newSegments: CategoryPath }
  | { type: 'generalization'; existingPath: CategoryPath; newAncestors: CategoryPath }
  | { type: 'sibling'; commonPrefix: CategoryPath; existingBranch: string; newBranch: string }
  | ConflictResult
  | { type: 'ambiguous'; sharedNode: string }

interface TreeNode {
  children: Map<string, TreeNode>
  isLeaf: boolean
}

export class TaxonomyTree {
  private root: TreeNode = { children: new Map(), isLeaf: false }

  getAllPaths(): CategoryPath[] {
    const paths: CategoryPath[] = []
    this.collectPaths(this.root, [], paths)
    return paths
  }

  private collectPaths(node: TreeNode, currentPath: CategoryPath, paths: CategoryPath[]): void {
    if (node.isLeaf) {
      paths.push([...currentPath])
    }
    for (const [segment, child] of Array.from(node.children.entries())) {
      this.collectPaths(child, [...currentPath, segment], paths)
    }
  }

  addPath(path: CategoryPath): void {
    let node = this.root
    for (const segment of path) {
      if (!node.children.has(segment)) {
        node.children.set(segment, { children: new Map(), isLeaf: false })
      }
      node = node.children.get(segment)!
    }
    node.isLeaf = true
  }

  hasPath(path: CategoryPath): boolean {
    let node = this.root
    for (const segment of path) {
      if (!node.children.has(segment)) {
        return false
      }
      node = node.children.get(segment)!
    }
    return node.isLeaf
  }

  hasPrefix(prefix: CategoryPath): boolean {
    let node = this.root
    for (const segment of prefix) {
      if (!node.children.has(segment)) {
        return false
      }
      node = node.children.get(segment)!
    }
    return true
  }

  /** Get all nodes at any depth that match a given name */
  findNodesByName(name: string): CategoryPath[] {
    const results: CategoryPath[] = []
    this.findNodesRecursive(this.root, [], name, results)
    return results
  }

  private findNodesRecursive(
    node: TreeNode,
    currentPath: CategoryPath,
    target: string,
    results: CategoryPath[]
  ): void {
    for (const [segment, child] of Array.from(node.children.entries())) {
      const newPath = [...currentPath, segment]
      if (segment === target) {
        results.push(newPath)
      }
      this.findNodesRecursive(child, newPath, target, results)
    }
  }

  /** Get the node at a given path, or undefined if it doesn't exist */
  getNode(path: CategoryPath): TreeNode | undefined {
    let node = this.root
    for (const segment of path) {
      if (!node.children.has(segment)) {
        return undefined
      }
      node = node.children.get(segment)!
    }
    return node
  }

  /** Remove a path from the tree */
  removePath(path: CategoryPath): boolean {
    if (path.length === 0) return false

    const parent = this.getNode(path.slice(0, -1))
    if (!parent) return false

    const lastSegment = path[path.length - 1]!
    const node = parent.children.get(lastSegment)
    if (!node || !node.isLeaf) return false

    // If node has children, just unmark as leaf
    if (node.children.size > 0) {
      node.isLeaf = false
    } else {
      // Otherwise remove the node entirely
      parent.children.delete(lastSegment)
    }
    return true
  }
}

export function compareToTaxonomy(tree: TaxonomyTree, newPath: CategoryPath): CompareResult {
  // Check for exact match first
  if (tree.hasPath(newPath)) {
    return { type: 'exact-match' }
  }

  // Check if new path extends an existing path
  for (const existingPath of tree.getAllPaths()) {
    if (isPrefix(existingPath, newPath)) {
      return {
        type: 'extension',
        existingPath,
        newSegments: newPath.slice(existingPath.length),
      }
    }
  }

  // Check for generalization: new path contains an existing path as suffix
  for (const existingPath of tree.getAllPaths()) {
    const suffixStart = findSuffixMatch(newPath, existingPath)
    if (suffixStart !== -1) {
      return {
        type: 'generalization',
        existingPath,
        newAncestors: newPath.slice(0, suffixStart),
      }
    }
  }

  // Check for sibling first: shares a common prefix but diverges
  let longestCommonPrefix: CategoryPath = []
  let siblingExistingPath: CategoryPath | null = null

  for (const existingPath of tree.getAllPaths()) {
    const common = findCommonPrefix(existingPath, newPath)
    if (common.length > longestCommonPrefix.length) {
      longestCommonPrefix = common
      siblingExistingPath = existingPath
    }
  }

  if (longestCommonPrefix.length > 0 && siblingExistingPath) {
    return {
      type: 'sibling',
      commonPrefix: longestCommonPrefix,
      existingBranch: siblingExistingPath[longestCommonPrefix.length] || '',
      newBranch: newPath[longestCommonPrefix.length] || '',
    }
  }

  // Check for conflicts: same node name appearing at different locations
  // Only check this if we didn't find a sibling relationship
  for (const segment of newPath) {
    const existingLocations = tree.findNodesByName(segment)
    const newIndex = newPath.indexOf(segment)
    const newLocation = newPath.slice(0, newIndex + 1)

    for (const existingLocation of existingLocations) {
      // If the paths to this node differ, it's a potential conflict
      if (!arraysEqual(existingLocation, newLocation)) {
        // Check if this is a leaf node appearing in different contexts
        const existingNode = tree.getNode(existingLocation)
        if (existingNode?.isLeaf && newIndex === newPath.length - 1) {
          // Same leaf in different trees - ambiguous
          return {
            type: 'ambiguous',
            sharedNode: segment,
          }
        }

        // Intermediate node at different depths - conflict
        return {
          type: 'conflict',
          conflictingNode: segment,
          existingLocation,
          proposedLocation: newLocation,
        }
      }
    }
  }

  // No overlap at all
  return { type: 'novel', overlapDepth: 0 }
}

function isPrefix(prefix: CategoryPath, path: CategoryPath): boolean {
  if (prefix.length >= path.length) return false
  return prefix.every((segment, i) => path[i] === segment)
}

function findSuffixMatch(newPath: CategoryPath, existingPath: CategoryPath): number {
  // Check if existingPath appears as a suffix of newPath
  for (let i = 0; i <= newPath.length - existingPath.length; i++) {
    let match = true
    for (let j = 0; j < existingPath.length; j++) {
      if (newPath[i + j] !== existingPath[j]) {
        match = false
        break
      }
    }
    if (match) return i
  }
  return -1
}

function findCommonPrefix(a: CategoryPath, b: CategoryPath): CategoryPath {
  const result: CategoryPath = []
  const minLen = Math.min(a.length, b.length)
  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) {
      result.push(a[i]!)
    } else {
      break
    }
  }
  return result
}

function arraysEqual(a: CategoryPath, b: CategoryPath): boolean {
  if (a.length !== b.length) return false
  return a.every((val, i) => val === b[i])
}

export function mergePath(tree: TaxonomyTree, newPath: CategoryPath): void {
  const comparison = compareToTaxonomy(tree, newPath)

  switch (comparison.type) {
    case 'exact-match':
      // Already exists, nothing to do
      return

    case 'novel':
    case 'sibling':
      // Just add the new path
      tree.addPath(newPath)
      return

    case 'extension':
      // Replace shorter path with longer one
      tree.removePath(comparison.existingPath)
      tree.addPath(newPath)
      return

    case 'generalization':
      // Re-root: remove old path, add new one with ancestors
      tree.removePath(comparison.existingPath)
      tree.addPath(newPath)
      return

    case 'conflict':
    case 'ambiguous':
      // For now, just add the path - caller should handle conflicts
      tree.addPath(newPath)
      return
  }
}

/**
 * Resolve a conflict by re-rooting the new path under the deeper ancestry.
 *
 * Rule: deeper root wins. If existing tree has `goods > food > ingredients`
 * and new path is `food > ingredients > flour`, the result is
 * `goods > food > ingredients > flour`.
 *
 * The conflicting node becomes a hanger point - everything after it in the
 * new path gets appended to the existing location.
 */
export function resolveConflict(
  _tree: TaxonomyTree,
  newPath: CategoryPath,
  conflict: ConflictResult
): CategoryPath {
  const { conflictingNode, existingLocation, proposedLocation } = conflict

  // Find where the conflicting node is in each path
  const existingDepth = existingLocation.length - 1 // depth of conflictingNode in existing
  const proposedDepth = proposedLocation.length - 1 // depth of conflictingNode in new path

  // Existing is deeper (more ancestors) - re-root new path under existing
  if (existingDepth >= proposedDepth) {
    // Find what comes after the conflicting node in the new path
    const conflictIndex = newPath.indexOf(conflictingNode)
    const suffix = newPath.slice(conflictIndex + 1)

    // Append suffix to existing location
    return [...existingLocation, ...suffix]
  }

  // New path is deeper - it becomes the canonical one
  return newPath
}
