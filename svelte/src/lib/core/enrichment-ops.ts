/**
 * Single-item enrichment operations with taxonomy integration
 *
 * Extracts core enrichment logic from run-enrichment.ts for reuse
 * in both batch processing and server-side single-item requests.
 */

import { AIPipe } from './ai-pipe'
import {
  contentId,
  EnrichedExample,
  ENRICHMENT_PROMPT,
  type UserInputType,
  type EnrichedExampleWithId,
} from './enrichment'
import { TaxonomyTree, compareToTaxonomy, resolveConflict } from './taxonomy-merge'

// =============================================================================
// Types
// =============================================================================

export type EnrichmentResult =
  | { success: true; data: EnrichedExampleWithId; taxonomyUpdated: boolean }
  | { success: false; input: UserInputType; error: string }

export interface EnrichmentConfig {
  pipe: AIPipe
  taxonomy: TaxonomyTree // Mutated in place
}

export interface BatchResult {
  results: EnrichedExampleWithId[]
  failures: Array<{ input: UserInputType; error: string }>
  stats: { conflicts: number; extensions: number }
}

// =============================================================================
// Single-item enrichment
// =============================================================================

/**
 * Enrich a single user input and integrate with taxonomy.
 * Mutates the taxonomy tree if new paths are discovered.
 */
export async function enrichSingleItem(
  input: UserInputType,
  config: EnrichmentConfig
): Promise<EnrichmentResult> {
  const { pipe, taxonomy } = config

  const result = await pipe.generate({
    schema: EnrichedExample,
    prompt: `Input: "${input.naturalLanguage}"\nType: ${input.type}`,
    systemPrompt: ENRICHMENT_PROMPT,
    retries: 1,
  })

  if (!result.success) {
    return { success: false, input, error: result.error }
  }

  const enriched: EnrichedExampleWithId = {
    id: contentId(input.naturalLanguage),
    ...result.data,
    naturalLanguage: input.naturalLanguage,
    type: input.type,
  }

  // Integrate with taxonomy
  let taxonomyUpdated = false

  for (const expr of enriched.expressions) {
    const comparison = compareToTaxonomy(taxonomy, expr.categoryChain)

    if (comparison.type === 'conflict') {
      const resolved = resolveConflict(taxonomy, expr.categoryChain, comparison)
      taxonomy.addPath(resolved)
      expr.categoryChain = resolved
      taxonomyUpdated = true
    } else if (comparison.type === 'exact-match') {
      // Already in taxonomy, no update needed
    } else {
      taxonomy.addPath(expr.categoryChain)
      taxonomyUpdated = true
    }
  }

  return { success: true, data: enriched, taxonomyUpdated }
}

// =============================================================================
// Batch enrichment
// =============================================================================

/**
 * Enrich multiple items with concurrency control.
 * Uses enrichSingleItem internally, then integrates all results with taxonomy.
 *
 * Note: LLM calls run in parallel, but taxonomy integration is sequential
 * to avoid race conditions in conflict resolution.
 */
export async function enrichBatch(
  inputs: UserInputType[],
  config: EnrichmentConfig & { concurrency?: number }
): Promise<BatchResult> {
  const { pipe, taxonomy, concurrency = 25 } = config
  const effectiveConcurrency = Math.min(concurrency, inputs.length)

  // Phase 1: Parallel LLM calls (without taxonomy integration)
  type LLMResult =
    | { success: true; data: EnrichedExampleWithId }
    | { success: false; input: UserInputType; error: string }

  async function llmEnrich(input: UserInputType): Promise<LLMResult> {
    const result = await pipe.generate({
      schema: EnrichedExample,
      prompt: `Input: "${input.naturalLanguage}"\nType: ${input.type}`,
      systemPrompt: ENRICHMENT_PROMPT,
      retries: 1,
    })

    if (!result.success) {
      return { success: false, input, error: result.error }
    }

    return {
      success: true,
      data: {
        id: contentId(input.naturalLanguage),
        ...result.data,
        naturalLanguage: input.naturalLanguage,
        type: input.type,
      },
    }
  }

  // Run with concurrency limit
  const pending = new Set<Promise<LLMResult>>()
  const allResults: Promise<LLMResult>[] = []

  for (let i = 0; i < inputs.length; i++) {
    if (pending.size >= effectiveConcurrency) {
      await Promise.race(pending)
    }

    const promise = llmEnrich(inputs[i]!).finally(() => pending.delete(promise))
    pending.add(promise)
    allResults.push(promise)
  }

  const settled = await Promise.all(allResults)
  const llmSuccesses = settled.filter((r): r is { success: true; data: EnrichedExampleWithId } => r.success)
  const failures = settled.filter((r): r is { success: false; input: UserInputType; error: string } => !r.success)

  // Phase 2: Sequential taxonomy integration
  let conflicts = 0
  let extensions = 0

  for (const { data } of llmSuccesses) {
    for (const expr of data.expressions) {
      const comparison = compareToTaxonomy(taxonomy, expr.categoryChain)

      if (comparison.type === 'conflict') {
        const resolved = resolveConflict(taxonomy, expr.categoryChain, comparison)
        taxonomy.addPath(resolved)
        expr.categoryChain = resolved
        conflicts++
      } else if (comparison.type === 'extension') {
        taxonomy.addPath(expr.categoryChain)
        extensions++
      } else {
        taxonomy.addPath(expr.categoryChain)
      }
    }
  }

  return {
    results: llmSuccesses.map((r) => r.data),
    failures: failures.map((f) => ({ input: f.input, error: f.error })),
    stats: { conflicts, extensions },
  }
}
