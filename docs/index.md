# Documentation

Technical documentation for the matching system.

## Data Pipeline

The system has two data sources:

### Static Data (UI)

Pre-computed examples that feed the visualization UI:

```
data/matching-examples.json     Raw test cases with expressions
         │
         ├──► scripts/enrich-categories.ts ──► data/enriched-examples.json
         │
         └──► scripts/generate-embeddings.ts ──► data/embeddings.json
                     │
                     ▼
              src/server.ts ──► React visualization
```

### Live Enrichment Pipeline

On-demand enrichment of user inputs using LLM:

```
data/user-inputs.json           Simple {naturalLanguage, type} inputs
         │
         ▼
scripts/run-enrichment.ts       AI enrichment with gpt-4o-mini
         │                      (concurrency=25, ~30s for 145 inputs)
         │
         ├──► Enriched data with category chains + constraints
         │
         └──► Statistics report (root distribution, depth, bad roots)
```

**Key files:**
- [src/enrichment.ts](../src/enrichment.ts) — Zod schemas and enrichment prompt
- [src/ai-pipe.ts](../src/ai-pipe.ts) — Generic LLM integration with structured output
- [src/canonical-roots.ts](../src/canonical-roots.ts) — Single source of truth for root categories

**Usage:**
```bash
bun scripts/run-enrichment.ts --output data/enriched.json
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
