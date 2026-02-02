# AI Pipe Self-Healing

The AI Pipe includes automatic self-healing when LLM outputs fail schema validation.

## How It Works

1. **LLM generates output** → Parse as JSON
2. **Zod validates** → If validation fails...
3. **Extract validation errors** → Format them for the LLM
4. **Retry with healing prompt** → LLM gets detailed feedback about what was wrong
5. **Repeat** → Until success or max retries reached

## Basic Usage

```typescript
import { createOpenAIPipe } from './src/ai-pipe'
import { z } from 'zod'

const UserSchema = z.object({
  name: z.string().min(2).max(50),
  age: z.number().int().min(0).max(150),
  email: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
  role: z.enum(['admin', 'user', 'guest']),
})

const pipe = createOpenAIPipe()

// Without healing (retries: 0)
const result = await pipe.generate({
  schema: UserSchema,
  prompt: 'Create a user profile for Alice',
  retries: 0, // Default - no healing
})

// With healing (retries: 2)
const result = await pipe.generate({
  schema: UserSchema,
  prompt: 'Create a user profile for Alice',
  retries: 2, // Will attempt to fix validation errors
})
```

## What the LLM Sees During Healing

When validation fails, the LLM receives a prompt like:

```
Your previous response failed validation. Here's what went wrong:

Previous output:
{
  "name": "Alice",
  "age": "25",  // Should be number, not string
  "email": "alice",  // Invalid email format
  "role": "developer"  // Not one of: admin, user, guest
}

Validation errors:
- At "age": Expected number, received string (expected: invalid_type)
- At "email": Invalid email format (expected: invalid_string)
- At "role": Invalid enum value (expected: invalid_enum_value)

Please fix these issues and provide a corrected response.

Original request: Create a user profile for Alice
```

The LLM can now fix the specific issues!

## Convenience Method

```typescript
// Automatically includes 2 retries
const result = await pipe.generateWithHealing(
  UserSchema,
  'Create a user profile for Alice'
)
```

## Custom Healing Prompts

```typescript
const result = await pipe.generate({
  schema: UserSchema,
  prompt: 'Create a user',
  retries: 2,
  healingPrompt: `FIX THESE ERRORS:

{error}

Your previous attempt:
{raw}

Try again and make it perfect!`,
})
```

## When to Use Healing

**Use healing when:**
- Schema has strict constraints (enums, specific formats, ranges)
- LLM might not understand requirements from first prompt alone
- Data quality is critical

**Skip healing when:**
- Simple schemas with loose constraints
- Speed is more important than correctness
- You want to handle failures yourself

## Performance Considerations

Each retry makes an additional API call:
- `retries: 0` → 1 API call
- `retries: 2` → Up to 3 API calls (if all fail)
- `retries: 3` → Up to 4 API calls (if all fail)

If the LLM succeeds on the first try, no extra calls are made.

## Examples

See:
- [examples/test-healing.ts](../examples/test-healing.ts) - Quick demo
- [examples/ai-pipe-usage.ts](../examples/ai-pipe-usage.ts) - Full examples

Run the demo:
```bash
bun examples/test-healing.ts
```

## Real-World Use Case: Category Enrichment

```typescript
const CategoryResult = z.object({
  text: z.string(),
  categoryChain: z.array(z.string()).min(1).max(6),
  disjointWith: z.array(z.string()),
})

// Without healing: Might get empty categoryChain
// With healing: LLM will be told "categoryChain must have at least 1 item"
const result = await pipe.generate({
  schema: z.array(CategoryResult),
  prompt: 'Categorize: piano, guitar, drums',
  retries: 2,
})
```

## Benefits

1. **Higher Success Rate** - Complex schemas validate more reliably
2. **Better Data Quality** - LLM learns from its mistakes
3. **Less Manual Handling** - Fewer validation failures to deal with
4. **Transparent** - You can see the raw output and validation errors
5. **Flexible** - Custom healing prompts for domain-specific needs

## Trade-offs

| Aspect | Without Healing | With Healing |
|--------|----------------|--------------|
| Speed | Fast (1 call) | Slower (up to N calls) |
| Cost | Low | Higher (more API calls) |
| Success Rate | Depends on schema | Higher |
| Data Quality | Variable | More consistent |
| Transparency | Simple | More complex |

Choose based on your needs!
