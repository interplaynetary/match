#!/usr/bin/env bun
/**
 * Analyze cohesion of the current taxonomy
 *
 * Uses centroid embeddings to measure how well categories group their children.
 * Reports cohesion scores and identifies potential improvements.
 *
 * Usage: bun scripts/analyze-cohesion.ts [--suggest-moves]
 */

import { buildTaxonomyTree, type TaxonomyNode } from '../../src/taxonomy-tree'
import { cosineSimilarity } from '../../src/embeddings'
import type { EmbeddingsStore } from '../../src/example-converter'
import enrichedData from '../../data/enriched-full.json'
import embeddingsData from '../../data/embeddings.json'

const embeddings = embeddingsData as EmbeddingsStore

const suggestMoves = process.argv.includes('--suggest-moves')

// Build taxonomy with embeddings
const examples = enrichedData.results.map(ex => ({
  ...ex,
  embedding: embeddings[String(ex.id)],
}))
const tree = buildTaxonomyTree(examples)

// =============================================================================
// Cohesion metrics
// =============================================================================

interface CohesionScore {
  nodeId: string
  name: string
  parentChildSim: number     // avg similarity between parent and children
  siblingCohesion: number    // avg pairwise similarity between siblings
  combinedScore: number      // parentChildSim * siblingCohesion
  childCount: number
}

function computeParentChildSimilarity(
  parentEmb: number[],
  childrenEmbs: number[][]
): number {
  if (childrenEmbs.length === 0) return 1

  let total = 0
  for (const childEmb of childrenEmbs) {
    total += cosineSimilarity(parentEmb, childEmb)
  }
  return total / childrenEmbs.length
}

function computeSiblingCohesion(childrenEmbs: number[][]): number {
  if (childrenEmbs.length < 2) return 1

  let total = 0
  let count = 0
  for (let i = 0; i < childrenEmbs.length; i++) {
    for (let j = i + 1; j < childrenEmbs.length; j++) {
      total += cosineSimilarity(childrenEmbs[i]!, childrenEmbs[j]!)
      count++
    }
  }
  return total / count
}

function analyzeCohesion(node: TaxonomyNode): CohesionScore[] {
  const results: CohesionScore[] = []

  // Only analyze nodes with children
  if (node.children.length > 0 && node.embedding) {
    const childrenWithEmbeddings = node.children.filter(c => c.embedding)
    const childrenEmbs = childrenWithEmbeddings.map(c => c.embedding!)

    if (childrenEmbs.length > 0) {
      const parentChildSim = computeParentChildSimilarity(node.embedding, childrenEmbs)
      const siblingCohesion = computeSiblingCohesion(childrenEmbs)

      results.push({
        nodeId: node.id,
        name: node.name,
        parentChildSim,
        siblingCohesion,
        combinedScore: parentChildSim * siblingCohesion,
        childCount: node.children.length,
      })
    }
  }

  // Recurse into children
  for (const child of node.children) {
    results.push(...analyzeCohesion(child))
  }

  return results
}

// =============================================================================
// Find potential improvements
// =============================================================================

interface MoveCandidate {
  nodeId: string
  nodeName: string
  currentParent: string
  suggestedParent: string
  currentSimilarity: number
  newSimilarity: number
  improvement: number
}

function findBetterParents(tree: TaxonomyNode): MoveCandidate[] {
  const candidates: MoveCandidate[] = []

  // Collect all nodes with their embeddings
  const allNodes: Array<{ node: TaxonomyNode; parentId: string | null }> = []

  function collectNodes(node: TaxonomyNode, parentId: string | null) {
    allNodes.push({ node, parentId })
    for (const child of node.children) {
      collectNodes(child, node.id)
    }
  }
  collectNodes(tree, null)

  // For each leaf or node, check if another parent would be more similar
  for (const { node, parentId } of allNodes) {
    if (!node.embedding || !parentId) continue

    const currentParent = allNodes.find(n => n.node.id === parentId)?.node
    if (!currentParent?.embedding) continue

    const currentSim = cosineSimilarity(node.embedding, currentParent.embedding)

    // Check all other potential parents (nodes with children at same or higher depth)
    for (const { node: potentialParent } of allNodes) {
      if (potentialParent.id === parentId) continue
      if (potentialParent.id === node.id) continue
      if (!potentialParent.embedding) continue
      if (potentialParent.children.length === 0 && potentialParent.id !== 'root') continue

      // Don't suggest moving to a descendant
      if (potentialParent.id.startsWith(node.id + '/')) continue

      const newSim = cosineSimilarity(node.embedding, potentialParent.embedding)

      if (newSim > currentSim + 0.05) { // Only suggest if significant improvement
        candidates.push({
          nodeId: node.id,
          nodeName: node.name,
          currentParent: currentParent.name,
          suggestedParent: potentialParent.name,
          currentSimilarity: currentSim,
          newSimilarity: newSim,
          improvement: newSim - currentSim,
        })
      }
    }
  }

  // Sort by improvement
  candidates.sort((a, b) => b.improvement - a.improvement)

  return candidates
}

// =============================================================================
// Report
// =============================================================================

console.log('='.repeat(70))
console.log('TAXONOMY COHESION ANALYSIS')
console.log('='.repeat(70))
console.log()

const scores = analyzeCohesion(tree)

// Sort by combined score (lowest first = needs attention)
scores.sort((a, b) => a.combinedScore - b.combinedScore)

// Summary stats
const avgScore = scores.reduce((a, b) => a + b.combinedScore, 0) / scores.length
const minScore = scores[0]
const maxScore = scores[scores.length - 1]

console.log('Summary:')
console.log(`  Categories analyzed: ${scores.length}`)
console.log(`  Average cohesion: ${avgScore.toFixed(3)}`)
console.log(`  Range: ${minScore?.combinedScore.toFixed(3)} - ${maxScore?.combinedScore.toFixed(3)}`)
console.log()

// Low cohesion categories (bottom 25%)
const lowCohesionThreshold = scores[Math.floor(scores.length * 0.25)]?.combinedScore ?? 0
const lowCohesion = scores.filter(s => s.combinedScore <= lowCohesionThreshold)

console.log('Low Cohesion Categories (bottom 25%):')
console.log('-'.repeat(70))
console.log('Category'.padEnd(30) + 'Parent-Child'.padEnd(15) + 'Siblings'.padEnd(15) + 'Combined')
console.log('-'.repeat(70))

for (const score of lowCohesion.slice(0, 15)) {
  const path = score.nodeId.split('/').slice(-2).join('/')
  console.log(
    path.padEnd(30) +
    score.parentChildSim.toFixed(3).padEnd(15) +
    score.siblingCohesion.toFixed(3).padEnd(15) +
    score.combinedScore.toFixed(3)
  )
}
console.log()

// High cohesion categories (top 10)
console.log('High Cohesion Categories (top 10):')
console.log('-'.repeat(70))

const topScores = [...scores].sort((a, b) => b.combinedScore - a.combinedScore).slice(0, 10)
for (const score of topScores) {
  const path = score.nodeId.split('/').slice(-2).join('/')
  console.log(
    path.padEnd(30) +
    score.parentChildSim.toFixed(3).padEnd(15) +
    score.siblingCohesion.toFixed(3).padEnd(15) +
    score.combinedScore.toFixed(3)
  )
}
console.log()

// Suggested moves
if (suggestMoves) {
  console.log('='.repeat(70))
  console.log('SUGGESTED MOVES (--suggest-moves)')
  console.log('='.repeat(70))
  console.log()

  const moves = findBetterParents(tree)

  if (moves.length === 0) {
    console.log('No significant improvements found.')
  } else {
    console.log(`Found ${moves.length} potential improvements:`)
    console.log()

    for (const move of moves.slice(0, 20)) {
      console.log(`  ${move.nodeName}`)
      console.log(`    Current: ${move.currentParent} (sim: ${move.currentSimilarity.toFixed(3)})`)
      console.log(`    Better:  ${move.suggestedParent} (sim: ${move.newSimilarity.toFixed(3)}, +${move.improvement.toFixed(3)})`)
      console.log()
    }
  }
}

console.log('='.repeat(70))
