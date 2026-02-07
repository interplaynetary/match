/**
 * Embedding operations for single items and batches
 *
 * Extracts core embedding logic from generate-embeddings.ts for reuse
 * in both batch processing and server-side single-item requests.
 */

import type { EmbeddingProvider } from './embeddings'
import type { EmbeddingsStore } from './example-converter'
import { extractCategoryNames, type EnrichedExampleWithId } from './enrichment'

// =============================================================================
// Helpers
// =============================================================================

/**
 * Generate text for embedding from an enriched example.
 * Combines all expression texts with pipe separator.
 */
export function embeddingText(example: EnrichedExampleWithId): string {
  return example.expressions.map((e) => e.text).join(' | ')
}

// =============================================================================
// Single-item embedding
// =============================================================================

/**
 * Generate embedding for a single enriched item.
 */
export async function embedSingleItem(
  example: EnrichedExampleWithId,
  provider: EmbeddingProvider
): Promise<number[]> {
  const text = embeddingText(example)
  return provider.embed(text)
}

/**
 * Generate embeddings for a single item's category names.
 * Returns a map of category name to embedding.
 */
export async function embedSingleItemCategories(
  example: EnrichedExampleWithId,
  existingEmbeddings: EmbeddingsStore,
  provider: EmbeddingProvider
): Promise<EmbeddingsStore> {
  const categories = new Set<string>()
  for (const expr of example.expressions) {
    for (const category of expr.categoryChain) {
      if (!existingEmbeddings[category]) {
        categories.add(category)
      }
    }
  }

  if (categories.size === 0) {
    return {}
  }

  const categoryList = Array.from(categories)
  const embeddings = await provider.embedBatch(categoryList)

  const result: EmbeddingsStore = {}
  for (let i = 0; i < categoryList.length; i++) {
    result[categoryList[i]!] = embeddings[i]!
  }
  return result
}

// =============================================================================
// Batch embedding
// =============================================================================

export interface EmbedBatchOptions {
  batchSize?: number
  onProgress?: (completed: number, total: number) => void
}

/**
 * Generate embeddings for items that don't have them yet.
 * Returns a new store containing all embeddings (existing + new).
 */
export async function embedBatch(
  examples: EnrichedExampleWithId[],
  existingEmbeddings: EmbeddingsStore,
  provider: EmbeddingProvider,
  options: EmbedBatchOptions = {}
): Promise<EmbeddingsStore> {
  const { batchSize = 100, onProgress } = options

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

  // Check which category names need embeddings
  const categoryNames = extractCategoryNames(examples)
  for (const category of categoryNames) {
    if (!existingEmbeddings[category]) {
      textsToEmbed.push({
        key: category,
        text: category,
      })
    }
  }

  if (textsToEmbed.length === 0) {
    return existingEmbeddings
  }

  // Copy existing embeddings
  const result: EmbeddingsStore = { ...existingEmbeddings }

  // Batch embed
  for (let i = 0; i < textsToEmbed.length; i += batchSize) {
    const batch = textsToEmbed.slice(i, i + batchSize)
    const texts = batch.map((t) => t.text)

    const batchEmbeddings = await provider.embedBatch(texts)

    for (let j = 0; j < batch.length; j++) {
      result[batch[j]!.key] = batchEmbeddings[j]!
    }

    onProgress?.(Math.min(i + batchSize, textsToEmbed.length), textsToEmbed.length)
  }

  return result
}
