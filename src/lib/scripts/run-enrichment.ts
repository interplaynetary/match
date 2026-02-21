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

import { createOpenAIPipe } from '$lib/core/ai/ai-pipe'
import { CANONICAL_ROOTS } from '$lib/core/ai/canonical-roots'
import {
  UserInput,
  EnrichedExample,
  ENRICHMENT_PROMPT,
  collectCategoryStats,
  type UserInputType,
  type EnrichedExampleType,
} from '$lib/core/ai/enrichment'

// Parse args
const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : undefined
const outputIdx = args.indexOf('--output')
const outputFile = outputIdx >= 0 ? args[outputIdx + 1] : undefined
const modelIdx = args.indexOf('--model')
const model = modelIdx >= 0 ? args[modelIdx + 1] : 'gpt-4o-mini'
const concurrencyIdx = args.indexOf('--concurrency')
const concurrency = concurrencyIdx >= 0 ? parseInt(args[concurrencyIdx + 1]) : 25

// Load inputs
const inputData = await Bun.file('data/user-inputs.json').json()
const inputs: UserInputType[] = inputData.map((d: unknown) => UserInput.parse(d))

const toProcess = limit ? inputs.slice(0, limit) : inputs
const effectiveConcurrency = Math.min(concurrency, toProcess.length)

console.log(`Processing ${toProcess.length} inputs with ${model} (concurrency=${effectiveConcurrency})...`)
const startTime = Date.now()

// Create AI pipe
const pipe = createOpenAIPipe({ model })

type ProcessResult =
  | { success: true; data: EnrichedExampleType }
  | { success: false; input: UserInputType; error: string }

// Process a single input
async function processOne(input: UserInputType): Promise<ProcessResult> {
  const result = await pipe.generate({
    schema: EnrichedExample,
    prompt: `Input: "${input.naturalLanguage}"\nType: ${input.type}`,
    systemPrompt: ENRICHMENT_PROMPT,
    retries: 1,
  })

  if (result.success) {
    const enriched = {
      ...result.data,
      naturalLanguage: input.naturalLanguage,
      type: input.type,
    }
    process.stdout.write('.')
    return { success: true, data: enriched }
  } else {
    process.stdout.write('x')
    return { success: false, input, error: result.error }
  }
}

// Process with concurrency limit
const pending = new Set<Promise<ProcessResult>>()
const allResults: Promise<ProcessResult>[] = []

for (let i = 0; i < toProcess.length; i++) {
  // Wait if we're at concurrency limit
  if (pending.size >= effectiveConcurrency) {
    await Promise.race(pending)
  }

  const promise = processOne(toProcess[i]).finally(() => pending.delete(promise))
  pending.add(promise)
  allResults.push(promise)
}

// Wait for all and collect results
const settled = await Promise.all(allResults)
const results = settled.filter((r): r is { success: true; data: EnrichedExampleType } => r.success).map(r => r.data)
const failures = settled.filter((r): r is { success: false; input: UserInputType; error: string } => !r.success)

// Collect stats
const stats = collectCategoryStats(results)
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

console.log('Root Distribution:')
const sortedRoots = [...stats.rootCounts.entries()].sort((a, b) => b[1] - a[1])
for (const [root, count] of sortedRoots) {
  const marker = (CANONICAL_ROOTS as readonly string[]).includes(root) ? 'OK' : 'BAD'
  const pct = ((count / stats.totalExpressions) * 100).toFixed(1)
  console.log(`  [${marker}] ${root}: ${count} (${pct}%)`)
}
console.log()

console.log('Depth Stats:')
console.log(`  Min: ${stats.depths.min}`)
console.log(`  Max: ${stats.depths.max}`)
console.log(`  Avg: ${stats.depths.avg.toFixed(2)}`)
console.log()

if (stats.badRoots.length > 0) {
  console.log('Bad Roots Found:')
  for (const root of stats.badRoots) {
    console.log(`  - ${root}`)
  }
  console.log()
}

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
