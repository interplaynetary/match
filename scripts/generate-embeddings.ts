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
import { extractCategoryNames, type EnrichedExampleWithId } from '../src/enrichment'

const ENRICHED_FILE = './data/enriched-full.json'
const EMBEDDINGS_FILE = './data/embeddings.json'

type EnrichedData = {
  results: EnrichedExampleWithId[]
}

function embeddingText(example: EnrichedExampleWithId): string {
  return example.expressions.map(e => e.text).join(' | ')
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

  // Collect all texts that need embeddings
  const textsToEmbed: Array<{ key: string; text: string }> = []

  // Check which examples need embeddings
  for (const example of examples) {
    if (!existingEmbeddings[example.id]) {
      textsToEmbed.push({
        key: example.id,
        text: embeddingText(example),
      })
    }
  }
  console.log(`${textsToEmbed.length} examples need embeddings`)

  // Check which category names need embeddings
  const categoryNames = extractCategoryNames(examples)
  let categoriesNeeded = 0
  for (const category of categoryNames) {
    if (!existingEmbeddings[category]) {
      textsToEmbed.push({
        key: category,
        text: category, // embed the category name itself
      })
      categoriesNeeded++
    }
  }
  console.log(`${categoriesNeeded} category names need embeddings (${categoryNames.length} total)`)

  if (textsToEmbed.length === 0) {
    console.log('All embeddings up to date')
    return
  }

  console.log(`Generating ${textsToEmbed.length} embeddings...`)

  // Initialize provider
  const provider = new OpenAIEmbeddingProvider()

  // Batch embed (OpenAI supports up to 2048 inputs per request)
  const batchSize = 100

  for (let i = 0; i < textsToEmbed.length; i += batchSize) {
    const batch = textsToEmbed.slice(i, i + batchSize)
    const texts = batch.map(t => t.text)

    console.log(`  Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(textsToEmbed.length / batchSize)}...`)

    const batchEmbeddings = await provider.embedBatch(texts)

    for (let j = 0; j < batch.length; j++) {
      existingEmbeddings[batch[j]!.key] = batchEmbeddings[j]!
    }
  }

  // Write embeddings file
  await Bun.write(EMBEDDINGS_FILE, JSON.stringify(existingEmbeddings))

  console.log(`Done! ${Object.keys(existingEmbeddings).length} embeddings saved to ${EMBEDDINGS_FILE}`)
}

main().catch(console.error)
