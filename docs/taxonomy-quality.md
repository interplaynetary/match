# Taxonomy Quality: Approaches Under Consideration

> **Status: Experimental**
> This document describes approaches we're exploring but haven't committed to. The goal is to improve how category chains help matching. We're evaluating two fundamentally different strategies.

## The Problem

When matching needs to capacities, category chains provide structure beyond raw embedding similarity. But the LLM-generated chains have issues:

- Inconsistent naming ("services" vs "service")
- Arbitrary placement decisions
- No guarantee of optimal organization

**Question**: Should we fix the taxonomy structure, or work around it?

---

## Approach A: Cohesion Optimization

**Philosophy**: Fix the taxonomy so it's well-organized.

### The Idea

Measure how well categories group their children using embedding similarity:
- **Parent-child similarity**: Does the parent represent its children?
- **Sibling cohesion**: Are siblings semantically related?

When cohesion is low, restructure: move nodes to better parents, merge synonyms, etc.

### Current State

We built tooling to measure cohesion:

```bash
bun scripts/analyze-cohesion.ts
bun scripts/analyze-cohesion.ts --suggest-moves
```

The taxonomy view has a "Cohesion" toggle showing scores (red=low, green=high).

**Findings:**
- 211 categories analyzed
- Average cohesion: 0.876
- Broad categories (services, goods) naturally score low (~0.2)
- Leaf nodes score 1.0 (trivially)

### Formula

```
cohesion = parentChildSimilarity × siblingCohesion
```

### Concerns

1. **Fixing structure is fighting the data** — LLMs will keep generating inconsistent chains. We'd be constantly patching.

2. **Broad categories are inherently diverse** — Low cohesion at the top is expected, not a bug.

3. **Multiplication compounds penalties** — Two 0.7 scores become 0.49.

4. **Assumes tree structure is right** — Maybe the problem is the tree itself.

### Files

| File | Purpose |
|------|---------|
| [src/category-cohesion.ts](../src/category-cohesion.ts) | Cohesion computation functions |
| [scripts/analyze-cohesion.ts](../scripts/analyze-cohesion.ts) | Analysis CLI |
| [src/taxonomy-tree.ts](../src/taxonomy-tree.ts) | Tree building with cohesion scores |

---

## Approach B: DAG with Similarity Traversal

**Philosophy**: Don't fix the structure. Embrace redundancy, let similarity handle matching.

### The Idea

Instead of a clean tree, build a DAG that keeps all observed paths. Each node gets one embedding. Synonymous nodes act as **soft identities**—they don't need to be merged, because their high embedding similarity creates natural "wormholes" between paths.

### Example: Piano Lessons

Suppose capacities have generated these paths:
```
Path A: services > education > music > piano-lessons
Path B: service > teaching > musical-instruction > piano
Path C: skills > music > piano-teaching
```

A need comes in with:
```
Query: services > education > music > piano
```

**Exact matching** would only find Path A (partial overlap).

**Similarity traversal** can find all three:

1. Start at query node "services"
2. Find similar nodes in DAG: "services" (1.0), "service" (0.98), "skills" (0.7)
3. For each, descend to children similar to "education": "education" (1.0), "teaching" (0.95), "music" (0.8)
4. Continue descending...

The traversal "jumps" between paths through synonym wormholes:
```
Query:  services ──► education ──► music ──► piano
           │            │            │          │
           ▼            ▼            ▼          ▼
Path A: services ── education ── music ── piano-lessons  (direct match)
           ↓            ↓
Path B: service ─── teaching ─── musical-instruction ── piano  (via wormholes)

Path C: skills ───────────────── music ── piano-teaching  (partial wormhole)
```

### Example: Synonym Wormholes

Two completely different-looking paths can connect:
```
Capacity: goods > food > groceries > eggs > organic-eggs
Need:     products > grocery > egg
```

No nodes match exactly. But:
- "goods" ≈ "products" (0.85)
- "food" → "groceries" ≈ "grocery" (0.92)
- "eggs" ≈ "egg" (0.99)

The traversal scores this highly despite zero exact matches.

### Example: Specificity Gradient

A general need should match specific capacities:
```
Need:     services > home-maintenance
Capacity: services > home-maintenance > plumbing > drain-cleaning
```

The need path is a prefix. Traversal naturally handles this—matching the prefix exactly, then exploring all children of `home-maintenance`.

### Traversal Algorithm (Sketch)

```
function findMatchingPaths(queryPath, dag):
  candidates = []

  // Start with nodes similar to query[0]
  for node in dag.roots:
    if similarity(node, queryPath[0]) > threshold:
      explore(node, queryPath, 1, score=similarity, candidates)

  return candidates.sortByScore()

function explore(currentNode, queryPath, queryIndex, score, candidates):
  if queryIndex >= queryPath.length:
    // Reached end of query - this is a match
    candidates.add(currentNode.path, score)
    // Also explore children (need might be more general)
    for child in currentNode.children:
      explore(child, queryPath, queryIndex, score * 0.9, candidates)
    return

  // Continue matching query
  for child in currentNode.children:
    sim = similarity(child, queryPath[queryIndex])
    if sim > threshold:
      explore(child, queryPath, queryIndex + 1, score * sim, candidates)
```

### Key Properties

1. **One embedding per node** — Simple, cacheable.

2. **No merging** — "services" and "service" stay separate. Their similarity handles it.

3. **Wormholes are implicit** — High-similarity nodes create connections without explicit edges.

4. **Scores degrade gracefully** — More wormhole jumps = lower similarity product = lower score.

5. **Prefix matching works** — General queries match specific paths naturally.

### Open Questions

1. **Threshold tuning** — What similarity cutoff for considering a wormhole?

2. **Scoring function** — Multiply similarities? Weighted average? Min?

3. **Efficiency** — With many nodes, how to prune the search space?

4. **Combining with item similarity** — Path score × item embedding similarity?

### Not Yet Implemented

Next steps:
1. Build DAG from current enriched data (keep all paths)
2. Generate embeddings for all unique category names
3. Implement traversal with scoring
4. Compare results to current tree-based matching

---

## Comparison

| Aspect | Cohesion Optimization | DAG Traversal |
|--------|----------------------|---------------|
| Structure | Clean tree | Messy DAG |
| Synonyms | Merge them | Keep them |
| Build-time work | Restructuring | Minimal |
| Query-time work | Tree lookup | Similarity search |
| LLM consistency | Required | Tolerated |
| Complexity | Moderate | Unknown |

---

## Next Steps

Before committing to either approach:

1. **Define success metric** — How do we know matching improved?
2. **Build minimal DAG prototype** — See if traversal is tractable
3. **Compare on test cases** — Same needs/capacities, different approaches
