/*
 * Generate embeddings for all examples in matching-examples.json
 *
 * Uses OpenAI's text-embedding-3-small model to create embeddings from
 * each example's expressions. Embeddings are stored separately in embeddings.json
 * to keep the main examples file readable.
 *
 * Usage:
 *   bun scripts/generate-embeddings.ts
 *
 * Requires:
 *   OPENAI_API_KEY environment variable (Bun auto-loads from .env)
 */

import { OpenAIEmbeddingProvider, generateEmbeddingText } from '$lib/core/embeddings'
import { convertExamples } from '../core/example-converter'

const EXAMPLES_FILE = './data/matching-examples.json'
const EMBEDDINGS_FILE = './data/embeddings.json'

type RawExample = {
  id: number
  category: string
  naturalLanguage: string
  type: 'capacity' | 'need'
  expressions: Array<{ text: string; priority?: number }>
  constraints?: Record<string, unknown>
  shouldMatchWith?: string[]
  notes?: string
}

type EmbeddingsStore = Record<string, number[]>

async function main() {
  const examples: RawExample[] = await Bun.file(EXAMPLES_FILE).json()

  // Load existing embeddings if any
  let existingEmbeddings: EmbeddingsStore = {}
  try {
    existingEmbeddings = await Bun.file(EMBEDDINGS_FILE).json()
  } catch {
    // File doesn't exist yet
  }

  console.log(`Loaded ${examples.length} examples, ${Object.keys(existingEmbeddings).length} existing embeddings`)

  // Check which examples need embeddings
  const needsEmbedding = examples.filter(e => !existingEmbeddings[String(e.id)])
  console.log(`${needsEmbedding.length} examples need embeddings`)

  if (needsEmbedding.length === 0) {
    console.log('All examples already have embeddings')
    return
  }

  // Convert to our types to use generateEmbeddingText
  const { byId } = convertExamples(examples)

  // Generate text for each example that needs embedding
  const textsToEmbed: Array<{ id: string; text: string }> = []
  for (const example of needsEmbedding) {
    const item = byId.get(String(example.id))
    if (item) {
      const text = generateEmbeddingText(item.converted)
      textsToEmbed.push({ id: String(example.id), text })
    }
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
      existingEmbeddings[batch[j]!.id] = batchEmbeddings[j]!
    }
  }

  // Write embeddings file
  await Bun.write(EMBEDDINGS_FILE, JSON.stringify(existingEmbeddings))

  console.log(`Done! ${Object.keys(existingEmbeddings).length} embeddings saved to ${EMBEDDINGS_FILE}`)
}

main().catch(console.error)
