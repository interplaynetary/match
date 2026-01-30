import type { Capacity, Need, Expression } from './types'

export type RawExample = {
  id: number
  category: string
  naturalLanguage: string
  type: 'capacity' | 'need'
  expressions: Array<{ text: string; priority?: number }>
  constraints?: Record<string, unknown>
  shouldMatchWith?: string[]
  notes?: string
}

export type EmbeddingsStore = Record<string, number[]>

export function convertToCapacity(example: RawExample, embedding?: number[]): Capacity | null {
  if (example.type !== 'capacity') return null
  if (!example.expressions || example.expressions.length === 0) return null

  return {
    id: String(example.id),
    expressions: example.expressions as Expression[],
    constraints: example.constraints as Capacity['constraints'],
    embedding,
  }
}

export function convertToNeed(example: RawExample, embedding?: number[]): Need | null {
  if (example.type !== 'need') return null
  if (!example.expressions || example.expressions.length === 0) return null

  return {
    id: String(example.id),
    expressions: example.expressions as Expression[],
    constraints: example.constraints as Need['constraints'],
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
    const id = String(example.id)
    const embedding = embeddings[id]

    if (example.type === 'capacity') {
      const capacity = convertToCapacity(example, embedding)
      if (capacity) {
        capacities.push(capacity)
        byId.set(id, { original: example, converted: capacity })
      }
    } else {
      const need = convertToNeed(example, embedding)
      if (need) {
        needs.push(need)
        byId.set(id, { original: example, converted: need })
      }
    }
  }

  return { capacities, needs, byId }
}

// Known matching pairs based on consecutive IDs and compatible expressions
export const KNOWN_PAIRS: Array<{ needId: number; capacityId: number; reason: string }> = [
  { needId: 2, capacityId: 1, reason: 'flour need ↔ flour capacity' },
  { needId: 4, capacityId: 3, reason: 'lawnmower need ↔ lawnmower capacity' },
  { needId: 6, capacityId: 5, reason: 'piano student ↔ piano teacher' },
  { needId: 9, capacityId: 10, reason: 'bicycle buyer ↔ bicycle seller' },
]
