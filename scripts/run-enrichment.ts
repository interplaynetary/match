/**
 * Run the enrichment pipeline on user-inputs.json
 *
 * Usage: bun scripts/run-enrichment.ts [--limit N] [--output FILE] [--model MODEL] [--concurrency N]
 *
 * Options:
 *   --limit N       Process only first N inputs (for testing)
 *   --output FILE   Write enriched data to FILE (default: stdout report only)
 *   --model MODEL   OpenAI model to use (default: gpt-4o-mini)
 *   --concurrency N Process N inputs in parallel (default: 25)
 */

import { createOpenAIPipe } from '../../src/ai-pipe'
import { UserInput, collectCategoryStats, type UserInputType } from '../../src/enrichment'
import { enrichBatch } from '../../src/enrichment-ops'
import { loadTaxonomy, saveTaxonomy } from '../../src/taxonomy-store'

// Parse args
const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]!) : undefined
const outputIdx = args.indexOf('--output')
const outputFile = outputIdx >= 0 ? args[outputIdx + 1] : undefined
const modelIdx = args.indexOf('--model')
const model = modelIdx >= 0 ? args[modelIdx + 1]! : 'gpt-4o-mini'
const concurrencyIdx = args.indexOf('--concurrency')
const concurrency = concurrencyIdx >= 0 ? parseInt(args[concurrencyIdx + 1]!) : 25

// Load inputs
const inputData = await Bun.file('data/user-inputs.json').json()
const inputs: UserInputType[] = inputData.map((d: unknown) => UserInput.parse(d))

const toProcess = limit ? inputs.slice(0, limit) : inputs
const effectiveConcurrency = Math.min(concurrency, toProcess.length)

console.log(`Processing ${toProcess.length} inputs with ${model} (concurrency=${effectiveConcurrency})...`)
const startTime = Date.now()

// Load persistent taxonomy
const taxonomy = await loadTaxonomy()

// Create AI pipe
const pipe = createOpenAIPipe({ model })

// Run batch enrichment
const { results, failures, stats } = await enrichBatch(toProcess, {
  pipe,
  taxonomy,
  concurrency: effectiveConcurrency,
})

// Save updated taxonomy
await saveTaxonomy(taxonomy)

// Collect stats
const categoryStats = collectCategoryStats(results)
const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

// Print report
console.log()
console.log()
console.log('='.repeat(60))
console.log('ENRICHMENT REPORT')
console.log('='.repeat(60))
console.log()

console.log(`Processed: ${toProcess.length} in ${elapsed}s`)
console.log(`Succeeded: ${results.length}`)
console.log(`Failed: ${failures.length}`)
console.log()

const finalRoots = new Set(taxonomy.getAllPaths().map((p) => p[0]))

console.log('Taxonomy Merging:')
console.log(`  Conflicts resolved: ${stats.conflicts}`)
console.log(`  Extensions added: ${stats.extensions}`)
console.log(`  Final roots: ${finalRoots.size} (${[...finalRoots].join(', ')})`)
console.log()

console.log('Root Distribution:')
const sortedRoots = [...categoryStats.rootCounts.entries()].sort((a, b) => b[1] - a[1])
for (const [root, count] of sortedRoots) {
  const pct = ((count / categoryStats.totalExpressions) * 100).toFixed(1)
  console.log(`  ${root}: ${count} (${pct}%)`)
}
console.log()

console.log('Depth Stats:')
console.log(`  Min: ${categoryStats.depths.min}`)
console.log(`  Max: ${categoryStats.depths.max}`)
console.log(`  Avg: ${categoryStats.depths.avg.toFixed(2)}`)
console.log()

if (failures.length > 0) {
  console.log('Failures:')
  for (const { input, error } of failures.slice(0, 5)) {
    console.log(`  - "${input.naturalLanguage.slice(0, 40)}...": ${error}`)
  }
  if (failures.length > 5) {
    console.log(`  ... and ${failures.length - 5} more`)
  }
  console.log()
}

// Sample outputs
console.log('Sample Enriched Outputs:')
for (const example of results.slice(0, 3)) {
  console.log()
  console.log(`  "${example.naturalLanguage}"`)
  console.log(`  Type: ${example.type}`)
  console.log(`  Expressions:`)
  for (const expr of example.expressions) {
    console.log(`    - "${expr.text}" -> [${expr.categoryChain.join(' > ')}]`)
  }
  if (example.constraints && Object.keys(example.constraints).length > 0) {
    console.log(`  Constraints: ${JSON.stringify(example.constraints)}`)
  }
  console.log(`  Should match: ${example.shouldMatchWith.join(', ')}`)
}

console.log()
console.log('='.repeat(60))

// Final merged output
if (outputFile) {
  const output = {
    timestamp: new Date().toISOString(),
    model,
    total: toProcess.length,
    completed: results.length,
    failed: failures.length,
    results,
  }
  await Bun.write(outputFile, JSON.stringify(output, null, 2))
  console.log(`Wrote ${results.length} enriched examples to ${outputFile}`)
}
