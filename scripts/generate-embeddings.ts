/*
 * Generate embeddings for enriched examples and category names
 *
 * Uses OpenAI's text-embedding-3-small model to create embeddings.
 * Embeddings are stored in embeddings.json keyed by:
 * - Example ID (e.g., "1", "2") for item embeddings
 * - Category name (e.g., "food", "services") for taxonomy node embeddings
 *
 * Usage:
 *   bun scripts/generate-embeddings.ts
 *
 * Requires:
 *   OPENAI_API_KEY environment variable (Bun auto-loads from .env)
 */

import { OpenAIEmbeddingProvider } from '../src/embeddings'
import type { EmbeddingsStore } from '../src/example-converter'
import type { EnrichedExampleWithId } from '../src/enrichment'
import { embedBatch } from '../src/embedding-ops'

const ENRICHED_FILE = './data/enriched-full.json'
const EMBEDDINGS_FILE = './data/embeddings.json'

type EnrichedData = {
  results: EnrichedExampleWithId[]
}

async function main() {
  const data: EnrichedData = await Bun.file(ENRICHED_FILE).json()
  const examples = data.results

  // Load existing embeddings if any
  let existingEmbeddings: EmbeddingsStore = {}
  try {
    existingEmbeddings = await Bun.file(EMBEDDINGS_FILE).json()
  } catch {
    // File doesn't exist yet
  }

  console.log(`Loaded ${examples.length} examples, ${Object.keys(existingEmbeddings).length} existing embeddings`)

  // Initialize provider
  const provider = new OpenAIEmbeddingProvider()

  // Run batch embedding with progress reporting
  const allEmbeddings = await embedBatch(examples, existingEmbeddings, provider, {
    batchSize: 100,
    onProgress: (completed, total) => {
      const batchNum = Math.ceil(completed / 100)
      const totalBatches = Math.ceil(total / 100)
      console.log(`  Batch ${batchNum}/${totalBatches}...`)
    },
  })

  const newCount = Object.keys(allEmbeddings).length - Object.keys(existingEmbeddings).length
  if (newCount === 0) {
    console.log('All embeddings up to date')
    return
  }

  // Write embeddings file
  await Bun.write(EMBEDDINGS_FILE, JSON.stringify(allEmbeddings))

  console.log(`Done! ${Object.keys(allEmbeddings).length} embeddings saved to ${EMBEDDINGS_FILE}`)
}

main().catch(console.error)
