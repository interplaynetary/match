import type { Capacity, Need } from './types'

/**
 * Compute cosine similarity between two embedding vectors
 * Returns value between -1 and 1
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`)
  }
  if (a.length === 0) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  return denominator === 0 ? 0 : dotProduct / denominator
}

/**
 * Generate text representation for embedding from expressions.
 * Combines all expression texts, weighted by priority (lower priority = less influence).
 */
export function generateEmbeddingText(item: Capacity | Need): string {
  if (item.expressions.length === 0) {
    return ''
  }

  // Sort by priority (lower = higher priority), then join all expression texts
  const sorted = [...item.expressions].sort((a, b) => {
    const aPriority = a.priority ?? 1
    const bPriority = b.priority ?? 1
    return aPriority - bPriority
  })

  return sorted.map(e => e.text).join(' | ')
}

/**
 * Embedding provider interface for abstracting different embedding APIs
 */
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
}

/**
 * OpenAI embedding provider using text-embedding-3-small
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string
  private model: string

  constructor(apiKey?: string, model = 'text-embedding-3-small') {
    this.apiKey = apiKey ?? process.env.OPENAI_API_KEY ?? ''
    this.model = model
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY is required')
    }
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: text, model: this.model }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error: ${response.status} ${error}`)
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>
    }
    return data.data[0]!.embedding
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: texts, model: this.model }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error: ${response.status} ${error}`)
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>
    }
    // Sort by index to maintain order
    return data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding)
  }
}
