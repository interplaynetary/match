/**
 * Compare exact vs semantic category matching using the Matcher class
 */

import { Matcher } from '../src/matcher'
import { convertExamples, type EmbeddingsStore } from '../src/example-converter'
import enrichedData from '../data/enriched-full.json'
import embeddingsData from '../data/embeddings.json'

const examples = enrichedData.results
const embeddings = embeddingsData as EmbeddingsStore
const { capacities, needs } = convertExamples(examples as any, embeddings)

// Matcher without semantic matching
const exactMatcher = new Matcher({ similarityThreshold: 0.5 })

// Matcher with semantic matching
const semanticMatcher = new Matcher({
  similarityThreshold: 0.5,
  embeddings: embeddings,
  semanticThreshold: 0.8
})

console.log('=== Comparing Match Quality ===\n')

// Find cases where semantic gets a better category match
const improvements: Array<{
  need: string
  capacity: string
  exactCategory: string
  exactDistance: number
  semanticCategory: string
  semanticDistance: number
  semanticSpecificity: number
}> = []

for (const need of needs) {
  const exactMatches = exactMatcher.findMatches(need, capacities)
  const semanticMatches = semanticMatcher.findMatches(need, capacities)

  const exactById = new Map(exactMatches.map(m => [m.capacityId, m]))
  const semanticById = new Map(semanticMatches.map(m => [m.capacityId, m]))

  for (const [capId, semanticMatch] of semanticById) {
    const exactMatch = exactById.get(capId)

    const semanticCat = semanticMatch.breakdown.categoryMatch
    const exactCat = exactMatch?.breakdown.categoryMatch

    // Check if semantic found a more specific match
    if (semanticCat && exactCat && !semanticCat.isBlocked && !exactCat.isBlocked) {
      if (semanticCat.overlapDistance < exactCat.overlapDistance ||
          (semanticCat.overlapDistance === exactCat.overlapDistance &&
           semanticCat.specificity > exactCat.specificity)) {
        const capacity = capacities.find(c => c.id === capId)!
        improvements.push({
          need: need.expressions[0]?.text ?? need.id,
          capacity: capacity.expressions[0]?.text ?? capId,
          exactCategory: exactCat.overlapCategory,
          exactDistance: exactCat.overlapDistance,
          semanticCategory: semanticCat.overlapCategory,
          semanticDistance: semanticCat.overlapDistance,
          semanticSpecificity: semanticCat.specificity,
        })
      }
    }
  }
}

console.log(`Found ${improvements.length} cases where semantic matching is more specific:\n`)

for (const imp of improvements.slice(0, 30)) {
  console.log(`Need: "${imp.need}"`)
  console.log(`Capacity: "${imp.capacity}"`)
  console.log(`  Exact:    "${imp.exactCategory}" (distance ${imp.exactDistance})`)
  console.log(`  Semantic: "${imp.semanticCategory}" (distance ${imp.semanticDistance}, specificity ${imp.semanticSpecificity.toFixed(3)})`)
  console.log()
}

if (improvements.length > 30) {
  console.log(`... and ${improvements.length - 30} more improvements`)
}
