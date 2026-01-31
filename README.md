# match

Core matching logic for connecting human capacities to needs.

## The Problem

Coordination at scale requires matching what people *have* (capacities) with what people *need*. This isn't just search — it's finding pairs where both sides benefit.

Key challenges:
- **Semantic matching**: "piano teacher" should match "looking for piano lessons"
- **Flexible abstraction**: Match at different specificity levels (pizza → Italian food → food)
- **Compositional needs**: "I need flour AND olive oil AND an oven" requires multiple capacities
- **Feasibility constraints**: Time windows, locations, quantities must align

## Pipeline

```
matching-examples.json
         │
         ▼
┌─────────────────────┐     ┌──────────────────────┐
│  enrich-categories  │     │  generate-embeddings │
│   (Claude CLI)      │     │     (OpenAI API)     │
└─────────────────────┘     └──────────────────────┘
         │                           │
         ▼                           ▼
enriched-examples.json         embeddings.json
         │                           │
         └───────────┬───────────────┘
                     ▼
              ┌─────────────┐
              │   matcher   │
              └─────────────┘
                     │
                     ▼
         matching-report.html
```

## Approach

1. **Expression-based matching** — Each capacity/need has multiple semantic expressions at different abstraction levels
2. **Embedding similarity** — OpenAI embeddings enable semantic matching without hardcoded type rules
3. **Category matching** — Taxonomy chains detect related items (potatoes → vegetables) and block conflicts (vegan ⊥ meat)
4. **Priority weighting** — More specific expressions rank higher than generic ones
5. **Constraint satisfaction** — Time, space, quantity constraints combine with similarity scores

## Project Structure

```
src/
  types.ts              # Core types: Expression, Capacity, Need, MatchResult
  embeddings.ts         # Cosine similarity, OpenAI embedding provider
  matcher.ts            # Embedding + category matching with constraint scoring
  category-matcher.ts   # Category chain overlap and disjoint detection
  example-converter.ts
  visualizer.ts         # Chord diagram visualization
  *.test.ts

scripts/
  enrich-categories.ts    # Add category chains via Claude CLI
  generate-embeddings.ts  # Batch generate embeddings for examples

data/
  matching-examples.json    # 145 test cases across 8 categories
  enriched-examples.json    # Examples with category chains (generated)
  embeddings.json           # Pre-computed embeddings (1536-dim)

output/
  matching-report.html      # Interactive visualization (open directly)
```

## Getting Started

### Just want to see the visualization?

The pre-generated report is included in the repo:

```bash
open output/matching-report.html
```

No dependencies or API keys required - just open the HTML file in a browser.

### Run the tests (regenerate visualization)

```bash
bun install
bun test
```

This runs the test suite and regenerates `output/matching-report.html` with the latest data.

### Enrich with category chains (requires Claude Code)

To add taxonomy-based category matching to expressions:

```bash
bun scripts/enrich-categories.ts
```

This uses Claude Code (Max subscription) to generate category chains for each expression. The enriched data is saved to `data/enriched-examples.json` and used automatically by the matcher.

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

See [docs/index.md](docs/index.md) for the full documentation index, including:
- [Dialectic Introduction](docs/dialectic.md) — Conceptual introduction via Q&A
- [Category Matching](docs/category-matching.md) — Taxonomy-based semantic matching

## Status

The matching logic handles:
- Semantic similarity via embeddings (OpenAI text-embedding-3-small)
- Category-based matching with taxonomy chains (e.g., food → meat → pork)
- Disjoint detection to block incompatible matches (e.g., vegan ⊥ meat)
- Multi-expression matching with priority weighting
- Quantity feasibility scoring
- Interactive visualization with threshold slider

Not yet implemented:
- Full compositional matching (AND across multiple capacities)
- Time overlap calculation
- Spatial distance scoring
