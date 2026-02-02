# Taxonomy Merging

When LLMs generate category chains for expressions, they do so without reference to a canonical taxonomy. This creates structural inconsistencies that fragment the category space and produce visual duplication in treemap visualizations.

This document explains the problem, the algorithmic solutions we've implemented, and open problems that remain.

## The Problem

Each expression gets a category chain like:
```
["services", "food-services", "catering"]
```

But different LLM calls produce inconsistent chains for related concepts:

```
Expression: "organic flour"     → ["goods", "food", "ingredients", "flour"]
Expression: "flour for baking"  → ["food", "ingredients", "flour"]
Expression: "flour"             → ["ingredient", "dry-ingredient", "flour"]
```

All three refer to flour, but they:
- Have different roots (`goods` vs `food` vs `ingredient`)
- Have different intermediate nodes
- Place "flour" at different depths

When visualized in a treemap, this creates multiple disconnected "flour" nodes instead of one consolidated category.

## Observed Conflict Patterns

### 1. Root Inconsistency

The same concept used as a root in one chain and nested in another:

```
Existing: goods > food > ingredients > flour
Proposed: food > ingredients > baking-ingredients > flour
           ^^^^
           "food" at depth 0 vs depth 1
```

**Solution**: Deeper root wins. Re-root the shallow path under the existing deeper ancestry.

```
Resolved: goods > food > ingredients > baking-ingredients > flour
```

### 2. Singular/Plural Inconsistency

```
services (229 occurrences)
service  (30 occurrences)
```

**Solution**: Normalize to canonical form (plural for categories).

### 3. Synonym Roots

Different words for the same concept:

```
goods (47)    vs  product (2)  vs  item (1)  vs  object (2)
space (13)    vs  housing (6)
employment (3) vs  labor (1)
```

**Solution**: Define canonical root categories and map synonyms.

### 4. Domain Crossover

The same intermediate node under different top-level domains:

```
Existing: services > creative-services > music > lessons
Proposed: arts > music > experimental-music
          ^^^^
          Different domain entirely
```

This is ambiguous - both could be valid:
- Music lessons are a **service**
- Experimental music is an **art form**

**Current solution**: Existing wins (order-dependent). See Open Problems.

### 5. Entity Flattening

Full ancestry vs flattened:

```
Existing: entity > person > professional > service-provider > coach
Proposed: service-provider > creative-professional > photographer
          ^^^^^^^^^^^^^^^^
          Flattened - missing ancestry
```

**Solution**: Deeper root wins. Photographer becomes:
```
entity > person > professional > service-provider > creative-professional > photographer
```

## Algorithm: Deeper Root Wins

The core principle is simple: **hang your hanger in the deeper tree**.

When a conflict is detected (same node at different depths):

1. Compare the depth of the conflicting node in both paths
2. The path with deeper ancestry for that node wins
3. Re-root the shallower path under the deeper ancestry
4. Append any new suffixes from the shallower path

```typescript
function resolveConflict(tree, newPath, conflict) {
  const { conflictingNode, existingLocation } = conflict

  // Find what comes after the conflicting node in the new path
  const conflictIndex = newPath.indexOf(conflictingNode)
  const suffix = newPath.slice(conflictIndex + 1)

  // Append suffix to existing (deeper) location
  return [...existingLocation, ...suffix]
}
```

## Classification Results

Running the algorithm on 366 category chains from enriched-examples.json:

| Type | Count | Description |
|------|-------|-------------|
| Siblings | 206 | Diverge from common prefix (normal branching) |
| Extensions | 51 | New path extends existing |
| Conflicts | 26 | Same node at different depths |
| Ambiguous | 1 | Same leaf via completely different paths |
| Generalizations | 0 | Would add ancestors to existing |

**26 conflicts resolved** by re-rooting under deeper ancestry.

## Canonical Root Categories

Based on frequency analysis, proposed canonical roots:

| Canonical | Aliases | Frequency |
|-----------|---------|-----------|
| services | service | 259 |
| goods | product, item, object | 52 |
| spaces | space, housing | 19 |
| resources | skills, investment | 7 |
| entities | entity, person | 4 |
| experiences | entertainment, arts, activities | 8 |

## Open Problems

### 1. Order Dependency

Currently, the first path to claim a node wins. This means:
- If `services > creative-services > music` is added first
- Then `arts > music > experimental` gets re-rooted under services
- Result: `services > creative-services > music > experimental`

But "experimental music" is arguably more "arts" than "services".

**Potential solutions**:
- Use semantic similarity to pick the better parent
- Allow multiple valid placements (DAG instead of tree)
- Define domain-specific rules (if leaf contains "lessons" → services)

### 2. Legitimate Parallel Taxonomies (Solved)

Some concepts genuinely belong in multiple places:
- A lawnmower is both a **good** (tools > garden-tools) and a **service** (lending > tool-lending)
- Music is both an **art form** and a **service** (lessons)

**Solution**: Multiple expressions per input, each with its own category chain.

From actual enrichment output:
```
"I have a working lawnmower I can lend out"
Expressions:
  - "lawnmower lending" -> [services > lending > tool-lending > lawnmower]
  - "lawnmower" -> [goods > tools > garden-tools > lawnmower]
```

This means:
- **The taxonomy is a DAG, not a tree** - same leaf can appear under different roots
- **Matching works on expressions, not inputs** - a need for "lawnmower" matches both the service and goods expressions
- **No disambiguation needed** - both categorizations are valid and useful for matching

### 3. Semantic Drift

"food-services" could mean:
- Services related to food (catering, delivery)
- Services provided in exchange for food (barter)

Without context, the algorithm can't distinguish these.

**Potential solutions**:
- Include example expressions with each category
- Use embeddings to cluster similar usages
- Flag ambiguous category names for review

### 4. Granularity Mismatch

Some chains are very deep, others shallow:
```
goods > food > ingredients > baking-ingredients > flour > organic-flour (6 levels)
ingredient > flour (2 levels)
```

Both describe flour, but with very different specificity.

**Current behavior**: Deeper wins, but the 2-level chain loses all its structure.

**Potential solution**: Preserve alternate intermediate nodes as annotations or aliases.

## Usage

```typescript
import { TaxonomyTree, compareToTaxonomy, resolveConflict } from './taxonomy-merge'

const tree = new TaxonomyTree()

for (const chain of categoryChains) {
  const result = compareToTaxonomy(tree, chain)

  if (result.type === 'conflict') {
    const resolved = resolveConflict(tree, chain, result)
    tree.addPath(resolved)
  } else {
    tree.addPath(chain)
  }
}

// Export consolidated paths
const paths = tree.getAllPaths()
```

## Embedding-Based Category Cohesion

The structural approach (deeper root wins) solves mechanical inconsistencies but can't answer:
- Is "music" a better child of "services" or "experiences"?
- Should this new term go under category A or B?

We're developing **cohesion metrics** using embeddings to guide these decisions.

### Cohesion Score

For a parent category with children, we compute:

1. **Parent-child similarity**: Average cosine similarity between parent embedding and each child
2. **Sibling variance**: How spread out siblings are (1 - avg pairwise similarity)
3. **Cohesion**: `parentChildSimilarity × (1 - siblingVariance)`

High cohesion means:
- Parent is semantically close to its children (good representation)
- Children are similar to each other (tight cluster)

### Deciding Where to Place New Nodes

When deciding if a new term belongs under parent A or B:

```typescript
const cohesionA = computeCohesionScore('parentA', [...existingChildren, newTerm], embeddings)
const cohesionB = computeCohesionScore('parentB', [...existingChildren, newTerm], embeddings)

// Pick the parent where cohesion drops less after adding
return cohesionA.cohesion > cohesionB.cohesion ? 'parentA' : 'parentB'
```

### Detecting Bad Root Categories

Categories like "entity" have low cohesion because:
- Low child diversity (everything is an entity = meaningless)
- No matching utility (doesn't help connect capacities to needs)

We can automatically flag low-cohesion roots for review.

## Code Architecture

### Live Pipeline (Growing)

| File | Purpose |
|------|---------|
| [src/enrichment.ts](../src/enrichment.ts) | Schemas and prompt for enriching user inputs with category chains, constraints |
| [src/ai-pipe.ts](../src/ai-pipe.ts) | Generic LLM integration with Zod schema validation |
| [src/category-cohesion.ts](../src/category-cohesion.ts) | Embedding-based cohesion metrics for category quality |
| [scripts/run-enrichment.ts](../scripts/run-enrichment.ts) | Run enrichment on user-inputs.json, produce statistics report |

### One-Off Analysis (Reference)

| File | Purpose |
|------|---------|
| [src/taxonomy-merge.ts](../src/taxonomy-merge.ts) | Structural merge algorithm, conflict detection |
| [scripts/analyze-taxonomy-conflicts.ts](../scripts/analyze-taxonomy-conflicts.ts) | Analyze conflicts in existing enriched-examples.json |
| [src/canonical-roots.ts](../src/canonical-roots.ts) | Root normalization rules |

### Data Flow

```
data/user-inputs.json          (simple inputs)
         │
         ▼
scripts/run-enrichment.ts      (AI enrichment)
         │
         ├──► Enriched data with category chains
         │
         └──► Statistics report (root distribution, depth, bad roots)
                    │
                    ▼
         src/category-cohesion.ts  (embedding-based quality metrics)
                    │
                    ▼
         Decision: keep category structure or restructure
```

## Future Work

1. **Prompt-based root enforcement**: Constrain LLM to only use canonical roots (services, goods, spaces, skills, opportunities)
2. **Cohesion-guided merge**: Use embedding similarity to pick better parent when structural merge is ambiguous
3. **Interactive resolution**: Flag low-cohesion categories for human review
4. **Treemap visualization**: Show before/after comparison of taxonomy consolidation
5. **Live cohesion monitoring**: Track cohesion scores as new categories are added
