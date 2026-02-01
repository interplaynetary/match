# Documentation

Technical documentation for the matching system.

## Data Pipeline

```
data/user-inputs.json              Simple {naturalLanguage, type} inputs
         │
         ▼
scripts/run-enrichment.ts          AI enrichment (gpt-4o-mini, concurrency=25)
         │                         + Taxonomy merging (deeper root wins)
         │
         ▼
data/enriched-full.json            Enriched with merged category chains
         │
         ▼
scripts/generate-embeddings.ts     OpenAI text-embedding-3-small
         │
         ▼
data/embeddings.json               Keyed by content-addressable ID
         │
         ▼
src/server.ts ──► React UI         Graph view + Taxonomy treemap
```

**Run the full pipeline:**
```bash
bun scripts/run-pipeline.ts
```

**Key files:**
- [src/enrichment.ts](../src/enrichment.ts) — Zod schemas and enrichment prompt
- [src/taxonomy-merge.ts](../src/taxonomy-merge.ts) — Taxonomy consolidation (deeper root wins)
- [src/ai-pipe.ts](../src/ai-pipe.ts) — Generic LLM integration with structured output

**Individual steps:**
```bash
# Enrich only (with taxonomy merging)
bun scripts/run-enrichment.ts --output data/enriched-full.json

# Generate embeddings only
bun scripts/generate-embeddings.ts

# Start server
bun --hot src/server.ts
```

## Design Documents

- [Dialectic Introduction](dialectic.md) — Conceptual introduction via Q&A
- [Category Matching](category-matching.md) — Taxonomy-based semantic matching
- [Constraint Matching](constraint-matching.md) — Time, space, and quantity constraints
- [Semantic Colors](semantic-colors.md) — Embedding-based visualization coloring
- [Taxonomy Merging](taxonomy-merging.md) — Category consolidation and cohesion metrics

## Quick Links

- [README](../README.md) — Project overview and setup
- [Source code](../src/) — Implementation
