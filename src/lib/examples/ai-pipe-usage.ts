/**
 * Examples showing how to use the generic AI pipe
 */

import { z } from 'zod'
import {
  AIPipe,
  OpenAIProvider,
  AnthropicProvider,
  createOpenAIPipe,
  generateWithOpenAI,
} from '../core/ai/ai-pipe'

// =============================================================================
// EXAMPLE 1: Category enrichment (like enrich-categories.ts)
// =============================================================================

const CategoryResult = z.object({
  text: z.string(),
  categoryChain: z.array(z.string()),
  disjointWith: z.array(z.string()),
})

async function enrichCategories() {
  const pipe = createOpenAIPipe()

  const result = await pipe.generate({
    schema: z.array(CategoryResult),
    prompt: `Generate category chains for these 3 terms:

1. "piano lessons"
2. "vegan cooking class"
3. "childcare services"`,
    systemPrompt: `You are a category enrichment assistant. Generate:
1. categoryChain: taxonomy from general to specific (e.g., ["food", "meat", "pork"])
2. disjointWith: mutually exclusive categories (e.g., vegan conflicts with meat)

Rules:
- Use lowercase, hyphenated multi-word categories
- Keep chains concise (3-6 levels)
- Only list truly exclusive categories in disjointWith`,
  })

  if (result.success) {
    console.log('Enriched categories:')
    for (const item of result.data) {
      console.log(`  "${item.text}" -> [${item.categoryChain.join(' > ')}]`)
    }
  } else {
    console.error('Error:', result.error)
  }
}

// =============================================================================
// EXAMPLE 2: Extract structured data from natural language
// =============================================================================

const ResourceExtraction = z.object({
  type_id: z.string(),
  quantity: z.number(),
  unit: z.string().optional(),
  location: z.object({
    city: z.string().optional(),
    state: z.string().optional(),
  }).optional(),
  time: z.object({
    start_date: z.string().optional(),
    duration_hours: z.number().optional(),
  }).optional(),
})

async function extractResource() {
  const result = await generateWithOpenAI(
    ResourceExtraction,
    'I need 2 hours of guitar lessons in Portland next Tuesday',
    'Extract resource information from the user request'
  )

  if (result.success) {
    console.log('Extracted resource:', result.data)
    // Fully typed!
    const typeId: string = result.data.type_id
    const quantity: number = result.data.quantity
  }
}

// =============================================================================
// EXAMPLE 3: Batch processing with error handling
// =============================================================================

const SkillAnalysis = z.object({
  skill_name: z.string(),
  category: z.enum(['technical', 'creative', 'interpersonal', 'physical']),
  difficulty_level: z.number().min(1).max(5),
  related_skills: z.array(z.string()),
})

async function analyzeSkillsBatch() {
  const pipe = createOpenAIPipe()
  const skills = ['piano', 'typescript', 'meditation', 'rock climbing']

  const results = await Promise.all(
    skills.map(async (skill) => {
      const result = await pipe.generate({
        schema: SkillAnalysis,
        prompt: `Analyze the skill: ${skill}`,
        systemPrompt: 'You are a skill categorization expert',
      })

      return { skill, result }
    })
  )

  for (const { skill, result } of results) {
    if (result.success) {
      console.log(`${skill}: ${result.data.category} (difficulty: ${result.data.difficulty_level})`)
    } else {
      console.error(`Failed to analyze ${skill}:`, result.error)
    }
  }
}

// =============================================================================
// EXAMPLE 4: Custom provider (for local models, other APIs, etc.)
// =============================================================================

class CustomLLMProvider {
  async call(
    prompt: string,
    systemPrompt?: string,
    options?: { temperature?: number; maxTokens?: number; schema?: z.ZodType }
  ): Promise<unknown> {
    // Your custom API call here
    // For example, a local Ollama instance:
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        model: 'llama2',
        prompt: `${systemPrompt ? systemPrompt + '\n\n' : ''}${prompt}\n\nRespond with JSON only.`,
        format: 'json',
      }),
    })

    const data = await response.json()
    return JSON.parse(data.response)
  }
}

async function useCustomProvider() {
  const pipe = new AIPipe(new CustomLLMProvider())

  const result = await pipe.generate({
    schema: CategoryResult,
    prompt: 'Categorize: guitar',
  })

  if (result.success) {
    console.log(result.data)
  }
}

// =============================================================================
// EXAMPLE 5: Using with existing schemas (like Resource from process.ts)
// =============================================================================

import { Resource } from '../core/commons/matching/slot'

async function generateResourceFromNL() {
  const pipe = createOpenAIPipe()

  // Partial resource generation (since Resource has many optional fields)
  const PartialResource = Resource.partial().required({
    type_id: true,
    quantity: true,
  })

  const result = await pipe.generateOrThrow({
    schema: PartialResource,
    prompt: 'Create a resource for: 10 hours of piano lessons in Brooklyn, available weekday evenings',
    systemPrompt: 'Convert natural language to resource specifications',
  })

  console.log('Generated resource:', result)
  // result is fully typed as Partial<Resource> & { type_id: string, quantity: number }
}

// =============================================================================
// EXAMPLE 6: Self-healing with retries
// =============================================================================

const StrictSchema = z.object({
  name: z.string().min(3).max(50),
  age: z.number().int().min(0).max(120),
  email: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format'),
  tags: z.array(z.string()).min(1).max(5),
  score: z.number().min(0).max(100),
})

async function selfHealingExample() {
  const pipe = createOpenAIPipe()

  // Without retries - might fail validation
  console.log('Attempt 1: Without retries')
  const result1 = await pipe.generate({
    schema: StrictSchema,
    prompt: 'Create a user profile for John who is a 25 year old developer',
  })

  if (!result1.success) {
    console.log('Failed:', result1.error)
    if (result1.validationErrors) {
      console.log('Errors:', result1.validationErrors.issues)
    }
  } else {
    console.log('Success:', result1.data)
  }

  // With retries - will auto-heal validation failures
  console.log('\nAttempt 2: With auto-healing (2 retries)')
  const result2 = await pipe.generate({
    schema: StrictSchema,
    prompt: 'Create a user profile for John who is a 25 year old developer',
    retries: 2, // LLM will get validation errors and try to fix them
  })

  if (result2.success) {
    console.log('Success after healing:', result2.data)
  } else {
    console.log('Failed even after retries:', result2.error)
  }

  // Using the convenience method
  console.log('\nAttempt 3: Using generateWithHealing')
  const result3 = await pipe.generateWithHealing(
    StrictSchema,
    'Create a user profile for Sarah who loves music and coding'
  )

  if (result3.success) {
    console.log('Success:', result3.data)
  }
}

// =============================================================================
// EXAMPLE 7: Custom healing prompts
// =============================================================================

async function customHealingPrompt() {
  const pipe = createOpenAIPipe()

  const ProductSchema = z.object({
    name: z.string(),
    price: z.number().positive(),
    category: z.enum(['electronics', 'clothing', 'food', 'other']),
    inStock: z.boolean(),
  })

  const result = await pipe.generate({
    schema: ProductSchema,
    prompt: 'Create a product: laptop',
    retries: 2,
    healingPrompt: `Your previous JSON had validation errors:

{error}

Previous attempt:
{raw}

Please fix ONLY the validation errors. Keep the same data but ensure it matches the schema exactly.`,
  })

  if (result.success) {
    console.log('Product:', result.data)
  }
}

// =============================================================================
// EXAMPLE 8: Monitoring retry attempts
// =============================================================================

async function monitorRetries() {
  const pipe = createOpenAIPipe()

  // Schema with strict constraints that might trigger retries
  const StrictData = z.object({
    uuid: z.string().regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      'Invalid UUID format'
    ),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'Invalid datetime format'),
    amount: z.number().multipleOf(0.01).min(0).max(1000000),
  })

  console.log('Generating with strict schema...')

  const result = await pipe.generate({
    schema: StrictData,
    prompt: 'Generate a financial transaction record',
    retries: 3,
  })

  if (result.success) {
    console.log('✓ Generated valid data:', result.data)
  } else {
    console.log('✗ Failed after all retries')
    console.log('Error:', result.error)
    if (result.validationErrors) {
      console.log('Final validation errors:')
      for (const issue of result.validationErrors.issues) {
        console.log(`  - ${issue.path.join('.')}: ${issue.message}`)
      }
    }
  }
}

// Run examples
if (import.meta.main) {
  console.log('=== Example 1: Category Enrichment ===')
  await enrichCategories()

  console.log('\n=== Example 2: Resource Extraction ===')
  await extractResource()

  console.log('\n=== Example 3: Batch Processing ===')
  await analyzeSkillsBatch()

  console.log('\n=== Example 5: Generate Resource ===')
  await generateResourceFromNL()

  console.log('\n=== Example 6: Self-Healing ===')
  await selfHealingExample()

  console.log('\n=== Example 7: Custom Healing Prompts ===')
  await customHealingPrompt()

  console.log('\n=== Example 8: Monitor Retries ===')
  await monitorRetries()
}
