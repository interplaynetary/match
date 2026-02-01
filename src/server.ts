/**
 * Bun server for the match visualization.
 *
 * Serves the React frontend and provides an API endpoint for match data.
 * The frontend imports semantic-colors.ts directly, eliminating function duplication.
 */

import index from './frontend/index.html'
import { generateMatchData } from './match-data.ts'
import { buildTaxonomyTree } from './taxonomy-tree.ts'
import enrichedData from '../data/enriched-full.json'

const examples = enrichedData.results
import embeddingsData from '../data/embeddings.json'

type EmbeddingsStore = Record<string, number[]>
const embeddings = embeddingsData as EmbeddingsStore

// Cache data (regenerate by restarting server)
const matchData = generateMatchData()

// Build taxonomy with embeddings from the embeddings store
const examplesWithEmbeddings = examples.map(ex => ({
  ...ex,
  embedding: embeddings[String(ex.id)],
}))
const taxonomyTree = buildTaxonomyTree(examplesWithEmbeddings)
const taxonomyData = {
  tree: taxonomyTree,
  pcaTransform: matchData.pcaTransform,
}

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000

Bun.serve({
  port: PORT,

  routes: {
    '/': index,

    '/api/matches': {
      GET: () => {
        return Response.json(matchData)
      },
    },

    '/api/taxonomy': {
      GET: () => {
        return Response.json(taxonomyData)
      },
    },
  },

  development: {
    hmr: true,
    console: true,
  },
})

console.log(`Server running at http://localhost:${PORT}`)
