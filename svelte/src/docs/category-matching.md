# Category Matching

Taxonomy-based semantic matching that complements embedding similarity.

## The Problem

Embedding similarity alone can't distinguish:
- "pork belly" vs "vegan food" — both are food, high similarity, but incompatible
- "potatoes" vs "vegetables" — potatoes ARE vegetables, should match strongly

## The Solution

Annotate terms with **category chains** — paths from abstract to concrete:

```
"pork belly"    → [food, meat, pork, pork-belly]
"potatoes"      → [food, vegetables, potatoes]
"piano teacher" → [instruction, music-instruction, piano-instruction, piano-teaching]
"piano lessons" → [instruction, music-instruction, piano-instruction, piano-lessons]
```

Category matches take **priority over embedding similarity**.

---

## Matching Rules

### Rule 1: Match if chains overlap

```
Need:  [food]
Offer: [food, meat, pork, pork-belly]
         ↑ overlap
→ MATCH at "food" level
```

The overlap point can be anywhere in either chain.

### Rule 2: Closer overlap = higher score

| Match type | Example | Score |
|------------|---------|-------|
| Exact leaf | "pork-belly" ↔ "pork-belly" | 1.0 |
| Sibling | "piano-teaching" ↔ "piano-lessons" | 0.9 |
| Parent | "drum-teacher" ↔ "teacher" | 0.8 |
| Grandparent+ | decreasing | 0.7... |

### Rule 3: Disjoint branches block matches

Some categories are mutually exclusive:

```
food
├── vegan       ⊥ meat, dairy
├── vegetarian  ⊥ meat
├── meat        ⊥ vegan, vegetarian
│   └── pork    ⊥ kosher, halal
├── kosher      ⊥ pork
└── halal       ⊥ pork
```

If chains include disjoint categories, **no match** regardless of shared ancestors:

```
Need:  [food, vegan, ...]
Offer: [food, meat, pork, pork-belly]
              ↑ disjoint
→ NO MATCH (vegan ⊥ meat)
```

---

## Examples

### Example 1: Ancestor match

```
"I need vegetables" ↔ "I have potatoes"

Need:  [food, vegetables]
Offer: [food, vegetables, potatoes]
                  ↑ overlap at "vegetables"
→ MATCH (potatoes is-a vegetable)
```

### Example 2: Disjoint conflict

```
"I need vegan food" ↔ "I have pork belly"

Need:  [food, vegan]
Offer: [food, meat, pork, pork-belly]
→ NO MATCH (vegan ⊥ meat)
```

### Example 3: Sibling match

```
"I need piano lessons" ↔ "I offer piano teaching"

Need:  [instruction, music-instruction, piano-instruction, piano-lessons]
Offer: [instruction, music-instruction, piano-instruction, piano-teaching]
                                                  ↑ overlap
→ MATCH at "piano-instruction" (siblings share parent)
```

### Example 4: Generic offer matches specific need

```
"I need a drum teacher" ↔ "I offer teaching"

Need:  [teacher, music-teacher, drum-teacher]
Offer: [teacher]
          ↑ overlap
→ MATCH at "teacher" level
```

The generic offer claims to satisfy any teaching need. User can narrow later.

### Example 5: Specific offer matches generic need

```
"I need a teacher" ↔ "I offer drum lessons"

Need:  [teacher]
Offer: [teacher, music-teacher, drum-teacher]
          ↑ overlap
→ MATCH at "teacher" level
```

### Example 6: Weak ancestor match

```
"I need a bicycle" ↔ "I have a unicycle"

Need:  [vehicle, human-powered, bicycle]
Offer: [vehicle, human-powered, unicycle]
                     ↑ overlap at "human-powered" (2 steps from leaf)
→ MATCH but weak score (0.8)
```

### Example 7: No category overlap

```
"I need help moving furniture" ↔ "I have a pickup truck"

Need:  [service, moving-help]
Offer: [vehicle, truck, pickup-truck]
→ No category overlap, fall back to embedding similarity
```

---

## Category Generation

Categories are **LLM-generated on demand** when expressions are created:

```
Input:  "pork belly"
Output: {
  categoryChain: ["food", "meat", "pork", "pork-belly"],
  disjointWith: ["vegan", "vegetarian", "kosher", "halal"]
}
```

---

## Score Calculation

```
if (categoryMatch):
  categoryScore = 1.0 - (overlapDistance * 0.1)
  finalScore = categoryScore * 0.7 + embeddingScore * 0.3
else:
  finalScore = embeddingScore
```

Where `overlapDistance` = steps from the need's most specific term to the overlap point.

---

## Match Specificity

Similarity answers "does this satisfy the need?" but doesn't capture **how precise** the match is.

### The Problem

Consider:
- Need: "Will work for food" (generic)
- Capacity: "I have sourdough starter to share" (specific)

These match at the "food" level—technically valid, but vague. The category score might be high (1.0 for exact match on the need's leaf), but this tells us nothing about match precision.

### Specificity vs Similarity

| Metric | Question | Use |
|--------|----------|-----|
| **Similarity** | Does the capacity fulfill the need? | Ranking, filtering |
| **Specificity** | How precise is this match? | UI opacity, confidence |

### Specificity Formula

Specificity depends on two factors:

1. **Match point depth** — where in the taxonomy the overlap occurs (not chain length!)
2. **Balance** — symmetric match depths indicate tighter alignment

```
matchDepthA = position of overlap category in chain A
matchDepthB = position of overlap category in chain B
minMatchDepth = min(matchDepthA, matchDepthB)
balance = minMatchDepth / max(matchDepthA, matchDepthB)
specificity = (minMatchDepth / MAX_DEPTH) * balance
```

**Key insight**: Two long chains matching at a generic root (like "goods") should have LOW specificity. The formula uses where the match *occurred*, not how long the chains are.

### Examples

| Match at | Chain lengths | Specificity | Interpretation |
|----------|---------------|-------------|----------------|
| "goods" (depth 1) | 5 & 4 | 0.17 | Generic root match — barely visible |
| "food" (depth 2) | 5 & 5 | 0.33 | Shallow match — faded |
| "bread" (depth 3) | 3 & 4 | 0.50 | Moderate depth — visible |
| "flour" (depth 5) | 5 & 6 | 0.83 | Deep match — prominent |

### Why This Works

**Match depth matters**: A match at "flour" (depth 5) means both parties specified something concrete. A match at "goods" (depth 1) is essentially "we both want... stuff."

**Balance matters**: If the match point is at depth 2 in one chain and depth 5 in another, there's asymmetry. The shallower side is being vague.

**Commutative**: Specificity is symmetric — order doesn't affect the result.

### UI Application

Edge opacity in the visualization uses specificity (squared for visual emphasis):

```
opacity = specificity * specificity
```

This makes vague matches nearly invisible while specific matches stand out:
- Match at "goods" (depth 1): specificity 0.17 → opacity 0.03
- Match at "food" (depth 2): specificity 0.33 → opacity 0.11
- Match at "flour" (depth 5): specificity 0.83 → opacity 0.69

---

## Data Model

```typescript
type Expression = {
  text: string
  priority?: number
  categoryChain?: string[]      // ["food", "meat", "pork-belly"]
  disjointWith?: string[]       // ["vegan", "kosher"]
}

type CategoryMatch = {
  overlapCategory: string       // where chains intersected
  overlapDistance: number       // 0 = exact, 1 = sibling, 2+ = ancestor
  isBlocked: boolean            // true if disjoint conflict
  specificity: number           // 0-1: match precision (depth * balance)
}
```
