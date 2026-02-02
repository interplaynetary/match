/**
 * Diagnostic script to analyze specificity values in match data
 */

import { generateMatchData } from '../src/match-data'
import type { EmbeddingsStore } from '../src/example-converter'

const enrichedData = await Bun.file('data/enriched-full.json').json()
const embeddings: EmbeddingsStore = await Bun.file('data/embeddings.json').json()
const data = generateMatchData({ examples: enrichedData.results, embeddings })

console.log('=== SPECIFICITY ANALYSIS ===\n')
console.log(`Total matches: ${data.matches.length}`)

// Group by specificity presence
const withSpecificity = data.matches.filter(m => m.breakdown.specificity !== undefined)
const withoutSpecificity = data.matches.filter(m => m.breakdown.specificity === undefined)
const withCategoryMatch = data.matches.filter(m => m.breakdown.categoryMatch)

console.log(`Matches with specificity: ${withSpecificity.length}`)
console.log(`Matches without specificity: ${withoutSpecificity.length}`)
console.log(`Matches with categoryMatch: ${withCategoryMatch.length}`)

// Build lookup maps
const needMap = new Map(data.needs.map(n => [n.id, n]))
const capMap = new Map(data.capacities.map(c => [c.id, c]))

console.log('\n=== SAMPLE MATCHES WITH SPECIFICITY ===\n')

// Show first 20 matches with category match
const sampleMatches = data.matches
  .filter(m => m.breakdown.categoryMatch)
  .slice(0, 30)

for (const match of sampleMatches) {
  const need = needMap.get(match.needId)
  const cap = capMap.get(match.capacityId)
  const cm = match.breakdown.categoryMatch!
  const specificity = match.breakdown.specificity ?? 'undefined'
  const opacity = typeof specificity === 'number' ? (specificity * specificity).toFixed(3) : 'N/A'

  console.log(`${need?.label?.slice(0, 40)} <-> ${cap?.label?.slice(0, 40)}`)
  console.log(`  Category: "${cm.overlapCategory}" | Distance: ${cm.overlapDistance}`)
  console.log(`  Need chain: ${match.matchedExpressions?.needChain?.join(' > ') ?? 'none'}`)
  console.log(`  Cap chain:  ${match.matchedExpressions?.capacityChain?.join(' > ') ?? 'none'}`)
  console.log(`  Specificity: ${specificity} | Opacity: ${opacity}`)
  console.log(`  Similarity: ${match.breakdown.similarity?.toFixed(3)} | Score: ${match.score.toFixed(3)}`)
  console.log()
}

// Find the "Will work for food" case
console.log('\n=== "WILL WORK FOR FOOD" MATCHES ===\n')
const foodNeed = data.needs.find(n => n.label.toLowerCase().includes('will work for food'))
if (foodNeed) {
  console.log(`Found need: ${foodNeed.id} - ${foodNeed.label}`)
  const foodMatches = data.matches.filter(m => m.needId === foodNeed.id)
  console.log(`Total matches: ${foodMatches.length}\n`)

  for (const match of foodMatches.slice(0, 10)) {
    const cap = capMap.get(match.capacityId)
    const cm = match.breakdown.categoryMatch
    const specificity = match.breakdown.specificity ?? 'undefined'
    const opacity = typeof specificity === 'number' ? (specificity * specificity).toFixed(3) : 'N/A'

    console.log(`  -> ${cap?.label?.slice(0, 50)}`)
    console.log(`     Category: ${cm?.overlapCategory ?? 'none'} | Specificity: ${specificity} | Opacity: ${opacity}`)
    console.log(`     Need chain: ${match.matchedExpressions?.needChain?.join(' > ') ?? 'none'}`)
    console.log(`     Cap chain:  ${match.matchedExpressions?.capacityChain?.join(' > ') ?? 'none'}`)
    console.log()
  }
} else {
  console.log('Could not find "Will work for food" need')
}

// Distribution of specificity values
console.log('\n=== SPECIFICITY DISTRIBUTION ===\n')
const specValues = withSpecificity.map(m => m.breakdown.specificity!)
const buckets = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
for (let i = 0; i < buckets.length - 1; i++) {
  const count = specValues.filter(v => v >= buckets[i] && v < buckets[i + 1]).length
  const bar = '█'.repeat(Math.round(count / 5))
  console.log(`${buckets[i].toFixed(1)}-${buckets[i + 1].toFixed(1)}: ${count.toString().padStart(4)} ${bar}`)
}
