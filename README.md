# match

Core matching logic for connecting human capacities to needs.

## The Problem

Coordination at scale requires matching what people *have* (capacities) with what people *need*. This isn't just search — it's finding pairs where both sides benefit.

Key challenges:
- **Type compatibility**: A teacher matches with a student, not another teacher
- **Compositional needs**: "I need flour AND olive oil AND an oven" requires multiple capacities coordinated in time
- **Feasibility constraints**: Time windows, locations, quantities must align
- **Discovery**: Surfacing matches people didn't know to look for

## Approach

1. **User-declared satisfaction paths** — Users specify what would satisfy their need, avoiding semantic inference
2. **Bidirectional queries** — Both needs and capacities actively search for counterparts
3. **LLM embeddings for discovery** — Surface candidates users might not find
4. **Explicit validation** — Users confirm what actually matches
5. **Constraint satisfaction** — Compositional needs require temporally-feasible combinations

## Project Structure

```
src/
  types.ts      # Core type definitions
  matcher.ts    # Matching logic
  matcher.test.ts

data/
  matching-examples.json  # 145 test cases across 8 categories

docs/
  dialectic.md  # Q&A introduction to the system
```

## Development

```bash
bun install
bun test
```

## Documentation

Start with [docs/dialectic.md](docs/dialectic.md) for a step-by-step introduction to how the matching system works.

## Status

Early exploration. The matching logic handles:
- Direct type matches (flour ↔ flour)
- Asymmetric type matches (teacher ↔ student, host ↔ guest)
- Multiple satisfaction paths (OR)
- Quantity feasibility scoring

Not yet implemented:
- Full compositional matching (AND across multiple capacities)
- Time overlap calculation
- Spatial distance scoring
- Embedding-based discovery
