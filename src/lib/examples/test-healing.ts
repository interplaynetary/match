/**
 * Quick test to demonstrate self-healing validation
 * Run: bun examples/test-healing.ts
 */

import { z } from 'zod'
import { createOpenAIPipe } from '../core/ai/ai-pipe'

const UserSchema = z.object({
  name: z.string().min(2).max(50),
  age: z.number().int().min(0).max(150),
  email: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email'),
  role: z.enum(['admin', 'user', 'guest']),
  tags: z.array(z.string()).min(1).max(5),
})

async function testWithoutHealing() {
  console.log('🧪 Test 1: WITHOUT self-healing (retries: 0)')
  console.log('─'.repeat(50))

  const pipe = createOpenAIPipe()

  const result = await pipe.generate({
    schema: UserSchema,
    prompt: 'Create a user profile for Alice, a developer',
    retries: 0, // No healing
  })

  if (result.success) {
    console.log('✅ Success on first try!')
    console.log(JSON.stringify(result.data, null, 2))
  } else {
    console.log('❌ Failed validation')
    console.log('Error:', result.error)
    if (result.validationErrors) {
      console.log('\nValidation issues:')
      result.validationErrors.issues.forEach((issue, i) => {
        console.log(`  ${i + 1}. ${issue.path.join('.')}: ${issue.message}`)
      })
    }
    console.log('\nRaw output:', JSON.stringify(result.raw, null, 2))
  }
}

async function testWithHealing() {
  console.log('\n\n🧪 Test 2: WITH self-healing (retries: 3)')
  console.log('─'.repeat(50))

  const pipe = createOpenAIPipe()

  const result = await pipe.generate({
    schema: UserSchema,
    prompt: 'Create a user profile for Bob, a designer',
    retries: 3, // Will auto-heal up to 3 times
  })

  if (result.success) {
    console.log('✅ Success (possibly after healing)!')
    console.log(JSON.stringify(result.data, null, 2))
  } else {
    console.log('❌ Failed even after healing attempts')
    console.log('Error:', result.error)
    if (result.validationErrors) {
      console.log('\nRemaining validation issues:')
      result.validationErrors.issues.forEach((issue, i) => {
        console.log(`  ${i + 1}. ${issue.path.join('.')}: ${issue.message}`)
      })
    }
  }
}

async function testConvenienceMethod() {
  console.log('\n\n🧪 Test 3: Using generateWithHealing convenience method')
  console.log('─'.repeat(50))

  const pipe = createOpenAIPipe()

  const result = await pipe.generateWithHealing(
    UserSchema,
    'Create a user profile for Charlie, a teacher'
  )

  if (result.success) {
    console.log('✅ Success!')
    console.log(JSON.stringify(result.data, null, 2))
  } else {
    console.log('❌ Failed')
    console.log('Error:', result.error)
  }
}

// Run all tests
if (import.meta.main) {
  console.log('\n🚀 AI Pipe Self-Healing Demo\n')

  await testWithoutHealing()
  await testWithHealing()
  await testConvenienceMethod()

  console.log('\n\n✨ Demo complete!')
  console.log(
    '\nKey takeaway: When validation fails, the LLM receives detailed error'
  )
  console.log(
    'messages from Zod and can automatically fix its output to match the schema.'
  )
}
