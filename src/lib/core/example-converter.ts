import type { Capacity, Need, Expression } from './types'

export type RawExample = {
  id: string
  naturalLanguage: string
  type: 'capacity' | 'need'
  expressions: Array<{ text: string; categoryChain?: string[]; disjointWith?: string | null }>
  constraints?: Record<string, unknown>
  shouldMatchWith?: string[]
  notes?: string
}

export type EmbeddingsStore = Record<string, number[]>

function convertExample(example: RawExample, embedding?: number[]): Capacity | Need | null {
  if (!example.expressions || example.expressions.length === 0) return null

  return {
    id: example.id,
    expressions: example.expressions as Expression[],
    constraints: example.constraints as Capacity['constraints'],
    embedding,
  }
}

export function convertExamples(
  examples: RawExample[],
  embeddings: EmbeddingsStore = {}
): {
  capacities: Capacity[]
  needs: Need[]
  byId: Map<string, { original: RawExample; converted: Capacity | Need }>
} {
  const capacities: Capacity[] = []
  const needs: Need[] = []
  const byId = new Map<string, { original: RawExample; converted: Capacity | Need }>()

  for (const example of examples) {
    const converted = convertExample(example, embeddings[example.id])
    if (!converted) continue

    if (example.type === 'capacity') {
      capacities.push(converted)
    } else {
      needs.push(converted)
    }
    byId.set(example.id, { original: example, converted })
  }

  return { capacities, needs, byId }
}
