/**
 * Bun server for the match visualization.
 *
 * Serves the React frontend and provides API endpoints for match data
 * and adding new entries to the system.
 */

import index from './frontend/index.html'
import { generateMatchData, type MatchData } from './match-data.ts'
import { buildTaxonomyTree } from './taxonomy-tree.ts'
import { createOpenAIPipe } from './ai-pipe'
import { OpenAIEmbeddingProvider, cosineSimilarity } from './embeddings'
import { enrichSingleItem } from './enrichment-ops'
import { embedSingleItem, embedSingleItemCategories } from './embedding-ops'
import { loadTaxonomy, saveTaxonomy } from './taxonomy-store'
import type { EmbeddingsStore } from './example-converter.ts'
import type { UserInputType, EnrichedExampleWithId } from './enrichment'

// Mutable state - reloaded on add
let enrichedData: { results: EnrichedExampleWithId[] }
let embeddings: EmbeddingsStore
let matchData: MatchData
let taxonomyData: { tree: ReturnType<typeof buildTaxonomyTree>; pcaTransform: MatchData['pcaTransform'] }

// Mutex for add-entry to prevent race conditions
let addEntryLock = false
const MAX_INPUT_LENGTH = 1000

async function loadData() {
  enrichedData = await Bun.file('data/enriched-full.json').json()
  embeddings = await Bun.file('data/embeddings.json').json()
  matchData = generateMatchData({ examples: enrichedData.results, embeddings })

  const examplesWithEmbeddings = enrichedData.results.map((ex) => ({
    ...ex,
    embedding: embeddings[String(ex.id)],
  }))
  const taxonomyTree = buildTaxonomyTree(examplesWithEmbeddings)
  taxonomyData = {
    tree: taxonomyTree,
    pcaTransform: matchData.pcaTransform,
  }
}

// Initial load
await loadData()

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000

// Lazy-initialized resources for enrichment
let pipe: ReturnType<typeof createOpenAIPipe> | null = null
let embeddingProvider: OpenAIEmbeddingProvider | null = null

function getPipe() {
  if (!pipe) pipe = createOpenAIPipe({ model: 'gpt-4o-mini' })
  return pipe
}

function getEmbeddingProvider() {
  if (!embeddingProvider) embeddingProvider = new OpenAIEmbeddingProvider()
  return embeddingProvider
}

Bun.serve({
  port: PORT,

  routes: {
    '/': index,

    '/api/matches': {
      GET: () => Response.json(matchData),
    },

    '/api/taxonomy': {
      GET: () => Response.json(taxonomyData),
    },

    '/api/search': {
      POST: async (req) => {
        try {
          const body = await req.json()
          const { query, threshold = 0.3 } = body as { query: string; threshold?: number }

          if (!query || typeof query !== 'string' || query.trim().length === 0) {
            return Response.json({ results: [] })
          }

          // Generate embedding for search query
          const provider = getEmbeddingProvider()
          const queryEmbedding = await provider.embed(query.trim())

          // Find similar items
          const results: Array<{ id: string; score: number; type: 'capacity' | 'need' }> = []

          for (const item of matchData.capacities) {
            if (item.embedding) {
              const score = cosineSimilarity(queryEmbedding, item.embedding)
              if (score >= threshold) {
                results.push({ id: item.id, score, type: 'capacity' })
              }
            }
          }

          for (const item of matchData.needs) {
            if (item.embedding) {
              const score = cosineSimilarity(queryEmbedding, item.embedding)
              if (score >= threshold) {
                results.push({ id: item.id, score, type: 'need' })
              }
            }
          }

          // Sort by score descending
          results.sort((a, b) => b.score - a.score)

          return Response.json({ results })
        } catch (err) {
          console.error('Search error:', err)
          return Response.json(
            { error: err instanceof Error ? err.message : 'Search failed' },
            { status: 500 }
          )
        }
      },
    },

    '/api/add-entry': {
      POST: async (req) => {
        // Mutex to prevent concurrent modifications
        if (addEntryLock) {
          return Response.json(
            { error: 'Another entry is being processed. Please try again.' },
            { status: 429 }
          )
        }
        addEntryLock = true

        try {
          const body = await req.json()
          const { naturalLanguage, type } = body as {
            naturalLanguage: string
            type?: 'capacity' | 'need'
          }

          if (!naturalLanguage || typeof naturalLanguage !== 'string') {
            return Response.json({ error: 'naturalLanguage is required' }, { status: 400 })
          }

          const trimmed = naturalLanguage.trim()
          if (trimmed.length === 0) {
            return Response.json({ error: 'Input cannot be empty' }, { status: 400 })
          }

          if (trimmed.length > MAX_INPUT_LENGTH) {
            return Response.json(
              { error: `Input too long. Maximum ${MAX_INPUT_LENGTH} characters allowed.` },
              { status: 400 }
            )
          }

          // Check for duplicates
          const lowerTrimmed = trimmed.toLowerCase()
          const isDuplicate = enrichedData.results.some((entry) =>
            entry.expressions.some((e) => e.text.toLowerCase() === lowerTrimmed)
          )
          if (isDuplicate) {
            return Response.json(
              { error: 'An entry with similar text already exists.' },
              { status: 409 }
            )
          }

          // Auto-detect type if not provided
          const detectedType = type ?? detectType(trimmed)

          const input: UserInputType = {
            naturalLanguage: trimmed,
            type: detectedType,
          }

          // Load taxonomy
          const taxonomy = await loadTaxonomy()

          // Enrich
          const enrichResult = await enrichSingleItem(input, {
            pipe: getPipe(),
            taxonomy,
          })

          if (!enrichResult.success) {
            return Response.json({ error: enrichResult.error }, { status: 500 })
          }

          // Generate embedding
          const provider = getEmbeddingProvider()
          const itemEmbedding = await embedSingleItem(enrichResult.data, provider)
          const categoryEmbeddings = await embedSingleItemCategories(
            enrichResult.data,
            embeddings,
            provider
          )

          // Persist to files
          // 1. Add to enriched-full.json
          enrichedData.results.push(enrichResult.data)
          await Bun.write(
            'data/enriched-full.json',
            JSON.stringify(
              {
                ...enrichedData,
                timestamp: new Date().toISOString(),
              },
              null,
              2
            )
          )

          // 2. Add to embeddings.json
          embeddings[enrichResult.data.id] = itemEmbedding
          Object.assign(embeddings, categoryEmbeddings)
          await Bun.write('data/embeddings.json', JSON.stringify(embeddings))

          // 3. Save taxonomy
          if (enrichResult.taxonomyUpdated) {
            await saveTaxonomy(taxonomy)
          }

          // Reload match data
          await loadData()

          return Response.json({
            success: true,
            id: enrichResult.data.id,
            type: detectedType,
            expressions: enrichResult.data.expressions.map((e) => e.text),
          })
        } catch (err) {
          console.error('Error adding entry:', err)
          return Response.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
          )
        } finally {
          addEntryLock = false
        }
      },
    },
  },

  development: {
    hmr: true,
    console: true,
  },
})

console.log(`Server running at http://localhost:${PORT}`)

/**
 * Auto-detect whether input is a capacity or need based on keywords.
 */
function detectType(text: string): 'capacity' | 'need' {
  const lower = text.toLowerCase()

  // Need indicators
  const needPatterns = [
    /\bi need\b/,
    /\bi'm looking for\b/,
    /\blooking for\b/,
    /\bseeking\b/,
    /\bwanted\b/,
    /\bi want\b/,
    /\bhelp me\b/,
    /\bcan someone\b/,
    /\bdoes anyone\b/,
    /\bin search of\b/,
    /\brequire\b/,
    /\bneed to\b/,
    /\bwould like\b/,
  ]

  // Capacity indicators
  const capacityPatterns = [
    /\bi offer\b/,
    /\bi can\b/,
    /\bi have\b/,
    /\bi'm a\b/,
    /\bi am a\b/,
    /\bproviding\b/,
    /\bavailable for\b/,
    /\bfor hire\b/,
    /\bfor sale\b/,
    /\bselling\b/,
    /\boffering\b/,
    /\bi teach\b/,
    /\bi do\b/,
    /\bmy .* service/,
  ]

  const needScore = needPatterns.reduce((score, pattern) => score + (pattern.test(lower) ? 1 : 0), 0)
  const capacityScore = capacityPatterns.reduce(
    (score, pattern) => score + (pattern.test(lower) ? 1 : 0),
    0
  )

  // Default to 'need' if uncertain (slightly more common use case)
  return capacityScore > needScore ? 'capacity' : 'need'
}
