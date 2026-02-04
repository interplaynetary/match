/*
 * Enrich expressions with category chains using Claude CLI
 *
 * Uses a SINGLE conversational session to process all expressions,
 * avoiding the 7-second startup overhead per batch.
 *
 * Usage:
 *   bun scripts/enrich-categories.ts
 *
 * Requires:
 *   Claude CLI installed and authenticated (uses Max subscription)
 */

import { spawn, ChildProcess } from 'child_process'

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

const SYSTEM_PROMPT = `You are a category enrichment assistant. When given a list of terms, you generate:
1. categoryChain: taxonomy path from general to specific (e.g., ["food", "meat", "pork"])
2. disjointWith: genuinely mutually exclusive categories (e.g., vegan conflicts with meat)

Rules:
- Use lowercase, hyphenated multi-word categories
- Keep chains concise (3-6 levels typically)
- Only list truly exclusive categories in disjointWith

Always respond with ONLY a JSON array, no markdown or explanation:
[{"text": "...", "categoryChain": [...], "disjointWith": [...]}, ...]`

class ClaudeConversation {
  private proc: ChildProcess
  private buffer = ''
  private pendingResolve: ((result: CategoryResult[]) => void) | null = null
  private pendingReject: ((err: Error) => void) | null = null

  constructor() {
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--system-prompt', SYSTEM_PROMPT,
      '--dangerously-skip-permissions',
      '--verbose',
    ]

    this.proc = spawn('claude', args, {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.proc.stdout!.on('data', (data: Buffer) => {
      this.buffer += data.toString()
      this.processBuffer()
    })

    this.proc.stderr!.on('data', (data: Buffer) => {
      // Log for debugging but don't treat as fatal
      const msg = data.toString().trim()
      if (msg && !msg.includes('Reading from stdin')) {
        console.error('[Claude stderr]:', msg)
      }
    })

    this.proc.on('error', (err) => {
      if (this.pendingReject) {
        this.pendingReject(err)
        this.pendingResolve = null
        this.pendingReject = null
      }
    })

    this.proc.on('close', (code) => {
      if (this.pendingReject && code !== 0) {
        this.pendingReject(new Error(`Claude exited with code ${code}`))
        this.pendingResolve = null
        this.pendingReject = null
      }
    })
  }

  private processBuffer() {
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue

      try {
        const msg = JSON.parse(line)

        // Look for assistant message with result
        if (msg.type === 'assistant' && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'text' && block.text) {
              this.tryParseResult(block.text)
            }
          }
        }

        // Also check for result_text in the response
        if (msg.result_text) {
          this.tryParseResult(msg.result_text)
        }

        // Check for result field (JSON output format)
        if (msg.result) {
          this.tryParseResult(msg.result)
        }
      } catch {
        // Not JSON, ignore
      }
    }
  }

  private tryParseResult(text: string) {
    if (!this.pendingResolve) return

    // Extract JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as CategoryResult[]
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.categoryChain) {
          this.pendingResolve(parsed)
          this.pendingResolve = null
          this.pendingReject = null
        }
      } catch {
        // Not valid JSON array
      }
    }
  }

  async sendBatch(expressions: string[]): Promise<CategoryResult[]> {
    const expressionList = expressions.map((e, i) => `${i + 1}. "${e}"`).join('\n')
    const prompt = `Generate category chains for these ${expressions.length} terms:\n\n${expressionList}`

    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve
      this.pendingReject = reject

      // Set timeout for response
      const timeout = setTimeout(() => {
        if (this.pendingReject) {
          this.pendingReject(new Error('Timeout waiting for Claude response'))
          this.pendingResolve = null
          this.pendingReject = null
        }
      }, 120000) // 2 minute timeout per batch

      // Clear timeout when resolved
      const originalResolve = this.pendingResolve
      this.pendingResolve = (result) => {
        clearTimeout(timeout)
        originalResolve(result)
      }

      // Send message in stream-json format
      const message = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: prompt }]
        }
      })
      this.proc.stdin!.write(message + '\n')
    })
  }

  close() {
    this.proc.stdin!.end()
    this.proc.kill()
  }
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

  // Process in batches within a single session
  const BATCH_SIZE = 50
  const batches = []
  for (let i = 0; i < toEnrich.length; i += BATCH_SIZE) {
    batches.push(toEnrich.slice(i, i + BATCH_SIZE))
  }

  console.log(`Processing ${toEnrich.length} expressions in ${batches.length} batch(es) using single session...`)

  const claude = new ClaudeConversation()

  try {
    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx]!
      console.log(`\nBatch ${batchIdx + 1}/${batches.length} (${batch.length} expressions)...`)

      const texts = batch.map(b => b.text)

      try {
        const results = await claude.sendBatch(texts)

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
  } finally {
    claude.close()
  }

  console.log(`\nDone! Enriched examples saved to ${ENRICHED_FILE}`)
}

main().catch(console.error)
