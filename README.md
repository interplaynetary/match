# match

Core matching logic for connecting human capacities to needs.

## The Problem

Coordination at scale requires matching what people *have* (capacities) with what people *need*. This isn't just search — it's finding pairs where both sides benefit.

Key challenges:
- **Semantic matching**: "piano teacher" should match "looking for piano lessons"
- **Flexible abstraction**: Match at different specificity levels (pizza → Italian food → food)
- **Compositional needs**: "I need flour AND olive oil AND an oven" requires multiple capacities
- **Feasibility constraints**: Time windows, locations, quantities must align

## Approach

1. **Expression-based matching** — Each capacity/need has multiple semantic expressions at different abstraction levels
2. **Embedding similarity** — OpenAI embeddings enable semantic matching without hardcoded type rules
3. **Priority weighting** — More specific expressions rank higher than generic ones
4. **Constraint satisfaction** — Time, space, quantity constraints combine with similarity scores

## Project Structure

```
src/
  types.ts           # Core types: Expression, Capacity, Need, MatchResult
  embeddings.ts      # Cosine similarity, OpenAI embedding provider
  matcher.ts         # Embedding-based matching with constraint scoring
  example-converter.ts
  visualizer.ts      # Chord diagram visualization
  matcher.test.ts

scripts/
  generate-embeddings.ts  # Batch generate embeddings for examples
  transform-examples.ts   # One-time data migration

data/
  matching-examples.json  # 145 test cases across 8 categories
  embeddings.json         # Pre-computed embeddings (1536-dim)

output/
  matching-report.html    # Interactive visualization
```

## Development

```bash
bun install
bun test          # Runs tests and generates visualization
```

## Key Concepts

**Expressions** describe what a capacity offers or need requires:
```typescript
expressions: [
  { text: "vegan pizza delivery", priority: 1 },  // most specific
  { text: "pizza", priority: 2 },
  { text: "Italian food", priority: 3 },
  { text: "food", priority: 4 }                   // broadest fallback
]
```

**Matching** uses cosine similarity of embeddings, combined via geometric mean with:
- Priority weight (higher priority = higher weight)
- Constraint feasibility (time, space, quantity)

**Threshold** filters matches below 60% similarity (configurable).

## Documentation

See [docs/dialectic.md](docs/dialectic.md) for a conceptual introduction.

## Status

The matching logic handles:
- Semantic similarity via embeddings (OpenAI text-embedding-3-small)
- Multi-expression matching with priority weighting
- Quantity feasibility scoring
- Interactive visualization with threshold slider

Not yet implemented:
- Full compositional matching (AND across multiple capacities)
- Time overlap calculation
- Spatial distance scoring
