/**
 * Bun server for the match visualization.
 *
 * Serves the React frontend and provides an API endpoint for match data.
 * The frontend imports semantic-colors.ts directly, eliminating function duplication.
 */

import index from './frontend/index.html'
import { generateMatchData } from './visualizer.ts'

// Cache match data (regenerate by restarting server)
const matchData = generateMatchData()

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
  },

  development: {
    hmr: true,
    console: true,
  },
})

console.log(`Server running at http://localhost:${PORT}`)
