/*
 * Enrich expressions with category chains using Claude CLI
 *
 * Reads matching-examples.json, calls Claude for each expression that
 * doesn't have a categoryChain, and writes to enriched-examples.json.
 *
 * Usage:
 *   bun scripts/enrich-categories.ts
 *
 * Requires:
 *   Claude CLI installed and authenticated (uses Max subscription)
 */

import { spawn } from 'child_process'
import { z } from 'zod'

const EXAMPLES_FILE = './data/matching-examples.json'
const ENRICHED_FILE = './data/enriched-examples.json'

type Expression = {
  text: string
  priority?: number
  categoryChain?: string[]
  disjointWith?: string[]
}

type RawExample = {
  id: number
  category: string
  naturalLanguage: string
  type: 'capacity' | 'need'
  expressions: Expression[]
  constraints?: Record<string, unknown>
  shouldMatchWith?: string[]
  notes?: string
}

const CategoryResponseSchema = z.object({
  categoryChain: z.array(z.string()),
  disjointWith: z.array(z.string()),
})

async function callClaude(text: string): Promise<{ categoryChain: string[]; disjointWith: string[] }> {
  const prompt = `Given this term, return a category chain from abstract to specific, and any mutually exclusive categories.

The category chain should start with the most general category and end with the most specific.
Categories should be lowercase, hyphenated if multi-word.
Only include disjointWith categories that are genuinely mutually exclusive (e.g., vegan vs meat, not just different).

Term: "${text}"

Respond with ONLY valid JSON, no markdown:
{"categoryChain": [...], "disjointWith": []}`

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', prompt, '--output-format', 'json'], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Claude exited with code ${code}: ${stderr}`))
        return
      }

      try {
        // Claude JSON output has { result: "..." } format
        const output = JSON.parse(stdout)
        const resultText = output.result || stdout

        // Extract JSON from the result (may have markdown wrapper)
        const jsonMatch = resultText.match(/\{[\s\S]*\}/)
        if (!jsonMatch) {
          reject(new Error(`No JSON found in response: ${resultText}`))
          return
        }

        const parsed = JSON.parse(jsonMatch[0])
        resolve(CategoryResponseSchema.parse(parsed))
      } catch (e) {
        reject(new Error(`Failed to parse response: ${e}. Output: ${stdout}`))
      }
    })

    proc.on('error', reject)
    proc.stdin.end()
  })
}

async function main() {
  // Try to load existing enriched file, fall back to original
  let examples: RawExample[]
  try {
    examples = await Bun.file(ENRICHED_FILE).json()
    console.log(`Loaded ${examples.length} examples from enriched file`)
  } catch {
    examples = await Bun.file(EXAMPLES_FILE).json()
    console.log(`Loaded ${examples.length} examples from source file`)
  }

  // Count expressions needing enrichment
  let needsEnrichment = 0
  let alreadyEnriched = 0
  for (const example of examples) {
    for (const expr of example.expressions) {
      if (expr.categoryChain) {
        alreadyEnriched++
      } else {
        needsEnrichment++
      }
    }
  }

  console.log(`${alreadyEnriched} expressions already enriched, ${needsEnrichment} need enrichment`)

  if (needsEnrichment === 0) {
    console.log('All expressions already have categories')
    return
  }

  // Process each expression
  let processed = 0
  for (const example of examples) {
    for (const expr of example.expressions) {
      if (expr.categoryChain) continue

      processed++
      console.log(`[${processed}/${needsEnrichment}] "${expr.text}"`)

      try {
        const result = await callClaude(expr.text)
        expr.categoryChain = result.categoryChain
        expr.disjointWith = result.disjointWith
        console.log(`  -> [${result.categoryChain.join(' > ')}]`)
        if (result.disjointWith.length > 0) {
          console.log(`     disjoint: ${result.disjointWith.join(', ')}`)
        }
      } catch (error) {
        console.error(`  ERROR: ${error}`)
        // Continue with other expressions
      }

      // Save after each expression for idempotency
      await Bun.write(ENRICHED_FILE, JSON.stringify(examples, null, 2))

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  console.log(`Done! Enriched examples saved to ${ENRICHED_FILE}`)
}

main().catch(console.error)
