import type { Capacity, Need, SatisfactionPath } from './types'

type RawExample = {
  id: number
  category: string
  naturalLanguage: string
  type: 'capacity' | 'need'
  structured: {
    capacityType?: string
    satisfactionPaths?: Array<{ requires: string; [key: string]: unknown }>
    attributes?: Record<string, unknown>
    constraints?: Record<string, unknown>
    [key: string]: unknown
  }
  shouldMatchWith: string[]
  notes: string
}

export function convertToCapacity(example: RawExample): Capacity | null {
  if (example.type !== 'capacity') return null
  if (!example.structured.capacityType) return null

  return {
    id: String(example.id),
    capacityType: example.structured.capacityType,
    attributes: example.structured.attributes,
    constraints: example.structured.constraints as Capacity['constraints'],
  }
}

export function convertToNeed(example: RawExample): Need | null {
  if (example.type !== 'need') return null

  const paths = example.structured.satisfactionPaths
  if (!paths || paths.length === 0) return null

  const satisfactionPaths: SatisfactionPath[] = paths.map((p) => ({
    type: 'direct' as const,
    requires: p.requires,
    attributes: Object.fromEntries(
      Object.entries(p).filter(([k]) => k !== 'requires')
    ),
  }))

  return {
    id: String(example.id),
    satisfactionPaths,
    attributes: example.structured.attributes,
    constraints: example.structured.constraints as Need['constraints'],
  }
}

export function convertExamples(examples: RawExample[]): {
  capacities: Capacity[]
  needs: Need[]
  byId: Map<string, { original: RawExample; converted: Capacity | Need }>
} {
  const capacities: Capacity[] = []
  const needs: Need[] = []
  const byId = new Map<string, { original: RawExample; converted: Capacity | Need }>()

  for (const example of examples) {
    if (example.type === 'capacity') {
      const capacity = convertToCapacity(example)
      if (capacity) {
        capacities.push(capacity)
        byId.set(String(example.id), { original: example, converted: capacity })
      }
    } else {
      const need = convertToNeed(example)
      if (need) {
        needs.push(need)
        byId.set(String(example.id), { original: example, converted: need })
      }
    }
  }

  return { capacities, needs, byId }
}

// Known matching pairs based on consecutive IDs and compatible types
export const KNOWN_PAIRS: Array<{ needId: number; capacityId: number; reason: string }> = [
  { needId: 2, capacityId: 1, reason: 'flour need ↔ flour capacity' },
  { needId: 4, capacityId: 3, reason: 'lawnmower need ↔ lawnmower capacity' },
  { needId: 6, capacityId: 5, reason: 'piano student ↔ piano teacher' },
  { needId: 9, capacityId: 10, reason: 'bicycle buyer ↔ bicycle seller' },
]
