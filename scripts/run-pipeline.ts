#!/usr/bin/env bun
/**
 * Run the full enrichment pipeline
 *
 * Pipeline steps:
 *   1. Enrich user inputs with LLM (expressions, category chains, constraints)
 *   2. Merge taxonomy (deeper root wins)
 *   3. Generate embeddings for new items
 *
 * Usage:
 *   bun scripts/run-pipeline.ts [--skip-enrich] [--skip-embed]
 *
 * Options:
 *   --skip-enrich   Skip enrichment, use existing enriched-full.json
 *   --skip-embed    Skip embedding generation
 *
 * Outputs:
 *   data/enriched-full.json  - Enriched data with merged taxonomy
 *   data/embeddings.json     - Embeddings keyed by content ID
 */

import { $ } from 'bun'

const args = process.argv.slice(2)
const skipEnrich = args.includes('--skip-enrich')
const skipEmbed = args.includes('--skip-embed')

console.log('='.repeat(60))
console.log('ENRICHMENT PIPELINE')
console.log('='.repeat(60))
console.log()

// Step 1: Enrichment with taxonomy merging
if (!skipEnrich) {
  console.log('Step 1: Enriching user inputs...')
  console.log()
  await $`bun scripts/run-enrichment.ts --output data/enriched-full.json`
  console.log()
} else {
  console.log('Step 1: Skipped (--skip-enrich)')
  console.log()
}

// Step 2: Generate embeddings
if (!skipEmbed) {
  console.log('Step 2: Generating embeddings...')
  console.log()
  await $`bun scripts/generate-embeddings.ts`
  console.log()
} else {
  console.log('Step 2: Skipped (--skip-embed)')
  console.log()
}

console.log('='.repeat(60))
console.log('Pipeline complete!')
console.log()
console.log('Output files:')
console.log('  data/enriched-full.json - Enriched examples with merged taxonomy')
console.log('  data/embeddings.json    - Embeddings keyed by content ID')
console.log()
console.log('To start the server:')
console.log('  bun --hot src/server.ts')
console.log('='.repeat(60))
