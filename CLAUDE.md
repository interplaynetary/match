# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run visualization server (http://localhost:3000)
bun --hot src/server.ts

# Run tests
bun test

# Run a single test file
bun test src/matcher.test.ts

# Enrich user inputs with LLM (requires OPENAI_API_KEY in .env)
bun scripts/run-enrichment.ts --output data/enriched.json

# Generate embeddings (requires OPENAI_API_KEY in .env)
bun scripts/generate-embeddings.ts
```

## Architecture

This is a **semantic matching system** for connecting human capacities (what people offer) with needs (what people need). It finds mutually beneficial matches using embeddings, taxonomy chains, and constraint satisfaction.

### Data Flow

**Static pipeline (UI):**
```
matching-examples.json ──► enriched-examples.json ──► embeddings.json
                                    │
                                    ▼
                          matcher.ts ──► /api/matches ──► React UI
```

**Live enrichment pipeline:**
```
user-inputs.json ──► run-enrichment.ts (gpt-4o-mini, concurrency=25) ──► enriched output
```

### Key Modules

| File | Purpose |
|------|---------|
| `types.ts` | Core types: Expression, Capacity, Need, MatchResult, Constraints |
| `matcher.ts` | Main engine - combines embedding similarity, category overlap, and constraints |
| `matching.ts` | Slot-to-slot matching logic (time/location/skill compatibility) |
| `category-matcher.ts` | Taxonomy chain overlap + disjoint conflict detection (vegan ⊥ meat) |
| `embeddings.ts` | Cosine similarity, OpenAI embedding provider |
| `constraints/` | Time, space, quantity constraint evaluation |
| `semantic-colors.ts` | PCA-based coloring (similar embeddings → similar colors) |

### Matching Algorithm

The matcher combines multiple signals via geometric mean:

1. **Embedding similarity** — Cosine similarity between need/capacity embeddings
2. **Category matching** — If category chains exist, blends 70% category + 30% embedding
3. **Priority weight** — Lower priority number = more specific = higher weight
4. **Constraint scores** — Time overlap, location compatibility, quantity feasibility

Any score of 0 (including disjoint conflict) blocks the match entirely. Unspecified constraints score 0.5 (uncertainty).

### Expression Abstraction Levels

Each capacity/need has multiple expressions at different specificities:
```typescript
expressions: [
  { text: "vegan pizza delivery", priority: 1 },  // most specific
  { text: "pizza", priority: 2 },
  { text: "food", priority: 4 }                   // broadest fallback
]
```

## Documentation

See [docs/index.md](docs/index.md) for design documents including dialectic intro, category matching, constraint matching, and semantic colors.

## Runtime

Use Bun for everything:
- `bun <file>` instead of node/ts-node
- `bun test` instead of jest/vitest
- `bun install` instead of npm/yarn
- Bun auto-loads .env (no dotenv needed)

Use Bun's native APIs:
- `Bun.serve()` with HTML imports for React (not vite/express)
- `Bun.file()` for file operations
- Import CSS directly in .tsx files