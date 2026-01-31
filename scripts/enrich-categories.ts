/*
 * Enrich expressions with category chains using Claude CLI
 *
 * Reads matching-examples.json, calls Claude ONCE with all expressions,
 * and writes to enriched-examples.json.
 *
 * Usage:
 *   bun scripts/enrich-categories.ts
 *
 * Requires:
 *   Claude CLI installed and authenticated (uses Max subscription)
 */

import { spawn } from 'child_process'

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

type CategoryResult = {
  text: string
  categoryChain: string[]
  disjointWith: string[]
}

async function callClaudeBatch(expressions: string[]): Promise<CategoryResult[]> {
  const expressionList = expressions.map((e, i) => `${i + 1}. "${e}"`).join('\n')

  const prompt = `For each term below, generate a category chain (abstract to specific) and any mutually exclusive categories.

Rules:
- categoryChain: path from general to specific (e.g., ["food", "meat", "pork"])
- disjointWith: genuinely mutually exclusive categories (e.g., vegan conflicts with meat)
- Use lowercase, hyphenated multi-word categories
- Keep chains concise (3-6 levels typically)

Terms:
${expressionList}

Respond with a JSON array, one object per term in order:
[
  {"text": "...", "categoryChain": [...], "disjointWith": [...]},
  ...
]

Output ONLY the JSON array, no markdown or explanation.`

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

        // Extract JSON array from the result
        const jsonMatch = resultText.match(/\[[\s\S]*\]/)
        if (!jsonMatch) {
          reject(new Error(`No JSON array found in response: ${resultText.slice(0, 500)}`))
          return
        }

        const parsed = JSON.parse(jsonMatch[0]) as CategoryResult[]
        resolve(parsed)
      } catch (e) {
        reject(new Error(`Failed to parse response: ${e}. Output: ${stdout.slice(0, 500)}`))
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

  // Collect expressions needing enrichment
  const toEnrich: { example: RawExample; expr: Expression; text: string }[] = []
  let alreadyEnriched = 0

  for (const example of examples) {
    for (const expr of example.expressions) {
      if (expr.categoryChain) {
        alreadyEnriched++
      } else {
        toEnrich.push({ example, expr, text: expr.text })
      }
    }
  }

  console.log(`${alreadyEnriched} already enriched, ${toEnrich.length} need enrichment`)

  if (toEnrich.length === 0) {
    console.log('All expressions already have categories')
    return
  }

  // Process in batches (Claude can handle ~50-100 at a time comfortably)
  const BATCH_SIZE = 50
  const batches = []
  for (let i = 0; i < toEnrich.length; i += BATCH_SIZE) {
    batches.push(toEnrich.slice(i, i + BATCH_SIZE))
  }

  console.log(`Processing ${toEnrich.length} expressions in ${batches.length} batch(es)...`)

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx]!
    console.log(`\nBatch ${batchIdx + 1}/${batches.length} (${batch.length} expressions)...`)

    const texts = batch.map(b => b.text)

    try {
      const results = await callClaudeBatch(texts)

      // Apply results back to expressions
      for (let i = 0; i < batch.length && i < results.length; i++) {
        const result = results[i]!
        const item = batch[i]!

        item.expr.categoryChain = result.categoryChain
        item.expr.disjointWith = result.disjointWith

        console.log(`  "${item.text}" -> [${result.categoryChain.join(' > ')}]`)
      }

      // Save after each batch
      await Bun.write(ENRICHED_FILE, JSON.stringify(examples, null, 2))
      console.log(`  Saved progress.`)

    } catch (error) {
      console.error(`  Batch error: ${error}`)
      // Save what we have and continue
      await Bun.write(ENRICHED_FILE, JSON.stringify(examples, null, 2))
    }
  }

  console.log(`\nDone! Enriched examples saved to ${ENRICHED_FILE}`)
}

main().catch(console.error)
