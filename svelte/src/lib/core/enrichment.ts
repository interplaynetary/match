/**
 * Enrichment pipeline for user inputs
 *
 * Takes simple {naturalLanguage, type} inputs and enriches with:
 * - Expressions at different abstraction levels
 * - Category chains for matching
 * - Structured constraints
 * - Matching hints
 */

import { z } from 'zod'
import { CANONICAL_ROOTS, type CanonicalRoot } from './canonical-roots'

// =============================================================================
// Schemas
// =============================================================================

// OpenAI structured output requires .nullable() for optional fields
export const EnrichedExpression = z.object({
  text: z.string().min(1),
  categoryChain: z.array(z.string()).min(1).max(6),
  disjointWith: z.array(z.string()).nullable(),
})

export const Constraints = z.object({
  quantity: z
    .object({
      amount: z.number().nullable(),
      min: z.number().nullable(),
      max: z.number().nullable(),
      unit: z.string().nullable(),
    })
    .nullable(),
  time: z
    .object({
      availableFrom: z.string().nullable(),
      availableTo: z.string().nullable(),
      deadline: z.string().nullable(),
      recurring: z.boolean().nullable(),
      days: z.array(z.string()).nullable(),
      hours: z
        .object({
          start: z.string().nullable(),
          end: z.string().nullable(),
        })
        .nullable(),
      urgency: z.enum(['immediate', 'high', 'normal', 'low']).nullable(),
    })
    .nullable(),
  location: z
    .object({
      city: z.string().nullable(),
      area: z.string().nullable(),
      neighborhood: z.string().nullable(),
      mode: z.enum(['remote', 'in-person', 'hybrid']).nullable(),
      willTravel: z.boolean().nullable(),
      radius: z
        .object({
          amount: z.number(),
          unit: z.string(),
        })
        .nullable(),
    })
    .nullable(),
  price: z
    .object({
      amount: z.number().nullable(),
      min: z.number().nullable(),
      max: z.number().nullable(),
      currency: z.string().nullable(),
      period: z.string().nullable(),
    })
    .nullable(),
})

export const EnrichedExample = z.object({
  naturalLanguage: z.string(),
  type: z.enum(['capacity', 'need']),
  expressions: z.array(EnrichedExpression).min(1),
  constraints: Constraints.nullable(),
  shouldMatchWith: z.array(z.string()),
  notes: z.string().nullable(),
})

export const UserInput = z.object({
  naturalLanguage: z.string(),
  type: z.enum(['capacity', 'need']),
})

// =============================================================================
// Prompt
// =============================================================================

export const ENRICHMENT_PROMPT = `You enrich user inputs for a matching system that connects capacities (what people offer) with needs (what people need).

## Your Task

Given a user input, extract:

1. **expressions**: Different ways to describe this capacity/need, from specific to general
   - Each expression has a categoryChain for matching
   - Use 2-4 expressions per input

2. **categoryChain**: Taxonomy path from general to specific
   - Start with: services, goods, spaces, skills, or opportunities
   - 2-5 levels deep
   - Use lowercase, hyphenated terms

3. **constraints**: Structured data (only if present in input)
   - quantity: amounts, minimums, maximums
   - time: dates, recurring schedules, urgency
   - location: cities, areas, remote/in-person
   - price: amounts, budgets

4. **shouldMatchWith**: What this should match with (2-4 items)
   - For capacities: what needs would benefit
   - For needs: what capacities would satisfy

5. **notes**: Brief observation (optional)

## Category Rules

Good categories help matching:
- "catering" - someone offering catering matches someone needing catering
- "music-instruction" - groups piano/guitar/violin teachers

Bad categories don't help:
- "entity" - everything is an entity, useless
- "thing" - too abstract
- "person" - doesn't help match

## Examples

Input: "I'm a professional piano teacher with 15 years experience"
Type: capacity

Output:
{
  "expressions": [
    {"text": "professional piano teacher", "categoryChain": ["services", "education", "music-instruction", "piano"]},
    {"text": "piano instruction", "categoryChain": ["services", "education", "music-instruction"]},
    {"text": "music teacher", "categoryChain": ["services", "education"]}
  ],
  "shouldMatchWith": ["piano students", "music lesson seekers", "parents seeking music education"],
  "notes": "Teacher matches student needs, not other teachers"
}

Input: "Need to borrow a lawnmower for Saturday afternoon"
Type: need

Output:
{
  "expressions": [
    {"text": "lawnmower", "categoryChain": ["goods", "tools", "garden-tools", "lawnmower"]}
  ],
  "constraints": {
    "time": {"days": ["Saturday"], "hours": {"start": "12:00", "end": "18:00"}}
  },
  "shouldMatchWith": ["lawnmower owners", "tool lending", "garden equipment rentals"]
}`

// =============================================================================
// Types
// =============================================================================

export type EnrichedExpressionType = z.infer<typeof EnrichedExpression>
export type EnrichedExampleType = z.infer<typeof EnrichedExample>
export type UserInputType = z.infer<typeof UserInput>
export type ConstraintsType = z.infer<typeof Constraints>

// =============================================================================
// Statistics
// =============================================================================

export interface CategoryStats {
  rootCounts: Map<string, number>
  badRoots: string[]
  depths: {
    min: number
    max: number
    avg: number
  }
  totalExpressions: number
}

/**
 * Collect statistics about category chains from enriched examples
 */
export function collectCategoryStats(examples: EnrichedExampleType[]): CategoryStats {
  const rootCounts = new Map<string, number>()
  const depths: number[] = []
  const badRootsSet = new Set<string>()

  for (const example of examples) {
    for (const expr of example.expressions) {
      const chain = expr.categoryChain
      if (chain.length === 0) continue

      const root = chain[0]

      // Count roots
      rootCounts.set(root, (rootCounts.get(root) || 0) + 1)

      // Track bad roots
      if (!CANONICAL_ROOTS.includes(root as CanonicalRoot)) {
        badRootsSet.add(root)
      }

      // Track depths
      depths.push(chain.length)
    }
  }

  return {
    rootCounts,
    badRoots: [...badRootsSet],
    depths: {
      min: depths.length > 0 ? Math.min(...depths) : 0,
      max: depths.length > 0 ? Math.max(...depths) : 0,
      avg: depths.length > 0 ? depths.reduce((a, b) => a + b, 0) / depths.length : 0,
    },
    totalExpressions: depths.length,
  }
}
