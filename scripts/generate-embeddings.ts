/*
 * Generate embeddings for enriched examples
 *
 * Uses OpenAI's text-embedding-3-small model to create embeddings from
 * each example's expressions. Embeddings are stored separately in embeddings.json
 * keyed by content-addressable ID.
 *
 * Usage:
 *   bun scripts/generate-embeddings.ts
 *
 * Requires:
 *   OPENAI_API_KEY environment variable (Bun auto-loads from .env)
 */

import { OpenAIEmbeddingProvider } from '../src/embeddings'

const ENRICHED_FILE = './data/enriched-full.json'
const EMBEDDINGS_FILE = './data/embeddings.json'

type EnrichedExample = {
  id: string
  naturalLanguage: string
  type: 'capacity' | 'need'
  expressions: Array<{ text: string; categoryChain: string[] }>
}

type EnrichedData = {
  results: EnrichedExample[]
}

type EmbeddingsStore = Record<string, number[]>

function embeddingText(example: EnrichedExample): string {
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

  // Check which examples need embeddings
  const needsEmbedding = examples.filter(e => !existingEmbeddings[e.id])
  console.log(`${needsEmbedding.length} examples need embeddings`)

  if (needsEmbedding.length === 0) {
    console.log('All examples already have embeddings')
    return
  }

  // Generate text for each example that needs embedding
  const textsToEmbed = needsEmbedding.map(example => ({
    id: example.id,
    text: embeddingText(example),
  }))

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
      existingEmbeddings[batch[j]!.id] = batchEmbeddings[j]!
    }
  }

  // Write embeddings file
  await Bun.write(EMBEDDINGS_FILE, JSON.stringify(existingEmbeddings))

  console.log(`Done! ${Object.keys(existingEmbeddings).length} embeddings saved to ${EMBEDDINGS_FILE}`)
}

main().catch(console.error)
