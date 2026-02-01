# Taxonomy Quality: Approaches Under Consideration

> **Status: Experimental**
> This document describes approaches we're exploring but haven't committed to. The goal is to improve how category chains help matching.

## The Purpose of the Taxonomy

The taxonomy is a **blur ladder**, not a classification system.

When matching needs to capacities, you don't traverse down from some root to find things. You start at the most specific level (the item itself) and blur upward until two paths overlap.

```
Need: "organic sourdough bread"
     ↑ blur to "bread"
     ↑ blur to "baked-goods"  ← overlap!

Capacity: "artisanal baked goods"
     ↑ blur to "baked-goods"  ← overlap!
```

The purpose: Provide a larger surface area for soft matches without immediately falling back to the mega-fuzziness of raw embeddings.

The current algorithm (in `category-matcher.ts`) already works this way:
```typescript
// Start from the end (most specific) and work backwards
for (let i = chainA.length - 1; i >= 0; i--) {
  if (setB.has(category)) {
    const distance = chainA.length - 1 - i  // how much we blurred
```

## The Problem

The LLM-generated chains have issues:

- Inconsistent naming ("services" vs "service")
- Arbitrary placement decisions
- No guarantee of optimal organization

And the current matcher requires **exact string matches** at each blur level. So "services" ≠ "service" means no overlap, even though they're semantically identical.

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
| [scripts/analyze-cohesion.ts](../scripts/analyze-cohesion.ts) | Analysis CLI |
| [src/taxonomy-tree.ts](../src/taxonomy-tree.ts) | Tree building with cohesion scores |

---

## Approach B: Soft Matching with Wormholes

**Philosophy**: Don't fix the structure. Keep the blur ladder, but replace exact matching with similarity matching.

### The Idea

Instead of requiring exact string matches at each blur level, use embedding similarity to find "close enough" nodes. Synonymous nodes act as **wormholes**—they connect paths that don't share exact strings.

### Example: Synonym Wormholes

Two completely different-looking paths can connect:
```
Capacity: goods > food > groceries > eggs > organic-eggs
Need:     products > grocery > egg
```

No nodes match exactly. But with similarity matching:
- "egg" ≈ "eggs" (0.99) ← wormhole at blur distance 0

Without wormholes, you'd blur all the way up ("egg" → "grocery" → "products") and never find overlap.

With wormholes, the match happens immediately at the leaf level.

### Example: Piano Lessons

Suppose capacities have generated these paths:
```
Path A: services > education > music > piano-lessons
Path B: service > teaching > musical-instruction > piano
Path C: skills > music > piano-teaching
```

A need comes in with:
```
Need: services > education > music > piano
```

**Exact matching** would only find Path A (partial overlap at "music").

**Similarity matching** finds all three by recognizing wormholes:
```
Need:   ...music ──► piano
                       │
                       ▼
Path A: ...music ── piano-lessons  (piano ≈ piano-lessons, 0.95)
Path B: ...musical-instruction ── piano  (exact match)
Path C: ...music ── piano-teaching  (piano ≈ piano-teaching, 0.93)
```

At each blur step, instead of checking "does this exact string exist?", we check "is there a similar-enough node?"

### Algorithm Sketch

```
function findOverlapWithWormholes(needChain, capacityChain, embeddings):
  // Start from most specific, blur upward
  for blurDistance = 0 to needChain.length - 1:
    needNode = needChain[needChain.length - 1 - blurDistance]
    needEmb = embeddings[needNode]

    // Find best matching node in capacity chain
    bestSim = 0
    bestMatch = null
    for capNode in capacityChain:
      sim = cosineSimilarity(needEmb, embeddings[capNode])
      if sim > bestSim:
        bestSim = sim
        bestMatch = capNode

    if bestSim > threshold:
      return {
        overlapNode: bestMatch,
        blurDistance: blurDistance,
        similarity: bestSim
      }

  return null  // no overlap found
```

### Scoring

Current scoring:
```typescript
categoryScore = 1.0 - distance * 0.1  // minimum 0.5
```

New scoring could incorporate similarity:
```typescript
categoryScore = similarity * (1.0 - distance * 0.1)
```

Higher similarity = better. More blur = worse. Both factors matter.

### Key Properties

1. **Bottom-up** — Same direction as current algorithm. Blur until match.

2. **Best match per level** — At each blur level, find the most similar node.

3. **Wormholes are implicit** — High-similarity nodes create connections without explicit edges.

4. **Scores degrade gracefully** — More blur = higher distance = lower score. Wormhole similarity < 1.0 = slightly lower score.

5. **No restructuring needed** — "services" and "service" stay separate. Their similarity handles it.

### Open Questions

1. **Threshold tuning** — What similarity cutoff for considering a wormhole? 0.8? 0.9?

2. **Efficiency** — Comparing every need node to every capacity node is O(n×m). Acceptable for short chains.

3. **Embeddings for category names** — We need embeddings for strings like "music", "education". Currently only items have embeddings. Could generate on-demand or precompute for all unique category names.

---

## Comparison

| Aspect | Current | Cohesion Optimization | Soft Matching |
|--------|---------|----------------------|---------------|
| Direction | Bottom-up | Bottom-up | Bottom-up |
| String matching | Exact | Exact (after cleanup) | Similarity |
| Synonyms | Must match exactly | Merge them | Wormhole through |
| Build-time work | None | Restructuring | Generate category embeddings |
| Query-time work | Set lookup | Set lookup | Similarity computation |

---

## Next Steps

1. **Generate embeddings for category names** — Add to embeddings.json cache
2. **Implement `findOverlapWithWormholes`** — Replace or augment `findCategoryOverlap`
3. **Compare results** — Same test cases, measure match quality improvement
