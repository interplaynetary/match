# Enhanced Lacanian FCA

**Temporal Probabilistic Formal Concept Analysis with Syntagmatic Dynamics**

This is a fresh implementation combining classical Formal Concept Analysis (FCA) with Lacanian psychoanalytic theory, adding temporal, probabilistic, and syntagmatic dimensions.

## Overview

This implementation synthesizes:

- **FCA (Formal Concept Analysis)** - Paradigmatic structure via Galois connections
- **Temporal Dynamics** - Streaming signifiers with retroactive determination (après-coup)
- **Probabilistic Semantics** - Bayesian updates and distribution collapse
- **Syntagmatic Structure** - Graph-based combinations (metonymic slide)
- **Quilting Mechanism** - Crystallization of floating meanings (point de capiton)

## Mathematical Foundation

### Temporal Probabilistic Formal Context

$$\mathcal{K} = (G_t, M, I_t, I^-, E, \mathbb{P}_t, Q_t)$$

Where:
- $G_t$ = signifiers at time $t$ (growing set)
- $M$ = feature space (stable)
- $I_t: G_t \times M \to [0,1]$ = fuzzy incidence 
- $I^-: G_t \times M \to \{0,1\}$ = negations (crisp)
- $E \subseteq G_t \times G_t$ = syntagmatic edges
- $\mathbb{P}_t: G_t \to \Delta(\mathfrak{M})$ = meaning distributions
- $Q_t \subseteq \mathbb{N}$ = quilting points

### Quilt-Relative Concept

$$C_q^t = (A, B, p)$$

Where:
- $A$ = extent (signifiers)
- $B$ = intent (features)
- $p$ = probability given quilting context

**Key property:** Before quilting, $p$ is a distribution. After quilting, $p$ collapses to point mass.

## Installation

```bash
cd fca-enhanced
bun install
```

## Running Tests

```bash
bun test tests/
```

All 21 tests should pass:
- ✅ FCA basic operations (Galois connection, concepts, lattice)
- ✅ Temporal dynamics (streaming, retroaction)
- ✅ Quilting operations (collapse, entropy)
- ✅ Syntagmatic traversal (metonymic slide)

## API Reference

### Core Operations

#### FCA Operations (`fca-operations.ts`)

**Galois Connection:**
```typescript
extent(features: Feature[], context: TemporalContext): string[]
// A' - signifiers with all features

intent(signifierIds: string[], context: TemporalContext): Feature[]
// B' - features shared by all signifiers
```

**Concept Formation:**
```typescript
conceptFromFeatures(features: Feature[], context): FormalConcept
// Close feature set to formal concept

computeAllConcepts(context): FormalConcept[]
// Generate all concepts via Next Closure algorithm

computeConceptLattice(context): ConceptLattice
// Build complete lattice structure
```

**Lattice Operations:**
```typescript
meet(c1, c2, context): FormalConcept  // Infimum (∧)
join(c1, c2, context): FormalConcept  // Supremum (∨)
conceptOrder(c1, c2): boolean         // c1 ≤ c2?
```

#### Enhanced Operations (`enhanced-operations.ts`)

**Temporal:**
```typescript
createTemporalContext(signifiers, features): TemporalContext
addSignifierTemporal(context, signifier): TemporalContext
// Adds signifier at t+1, performs Bayesian updates
```

**Probabilistic:**
```typescript
distributionEntropy(dist): number
// Shannon entropy H(X) = -Σ p(x) log₂(p(x))

collapseDistribution(dist): MeaningDistribution
// Winner-take-all collapse (quantum measurement)
```

**Quilting:**
```typescript
quilt(context, timeIndex): TemporalContext
// Add quilting point, collapse distributions

getQuilt RelativeConcepts(context): QuiltRelativeConcept[]
// Formal concepts with probabilities
```

**Syntagmatic:**
```typescript
metonymicSlide(context, signifierId, steps): string[]
// Traverse syntagmatic graph

addSyntagmaticEdge(context, from, to): TemporalContext
// Add "can follow" edge
```

## Usage Example

```typescript
import { createTemporalContext, addSignifierTemporal, quilt, metonymicSlide } from './enhanced-operations';

// Create signifiers
const dog = {
  id: 'dog',
  acoustic: ['d', 'o', 'g'],
  features: [{ dimension: 'animal', value: true }],
  negations: [],
};

const bit = {
  id: 'bit',
  acoustic: ['b', 'i', 't'],
  features: [{ dimension: 'action', value: 'bite' }],
  negations: [],
};

// Initialize context
let context = createTemporalContext([dog], []);

// Add signifier (temporal evolution)
context = addSignifierTemporal(context, bit);
// Bayesian updates occur retroactively

// Add syntagmatic structure
context = addSyntagmaticEdge(context, 'dog', 'bit');

// Quilt at end of phrase
context = quilt(context, 1);
// Distributions collapse to fixed meanings

// Traverse metonymically
const path = metonymicSlide(context, 'dog', 5);
console.log(path); // ['dog', 'bit']
```

## Theoretical Background

### Classical FCA

Formal Concept Analysis (Ganter & Wille, 1999) provides:
- **Galois connection** between objects and attributes
- **Concept lattice** structure
- **Meet/join** operations

### Lacanian Extensions

Our implementation adds:

1. **Temporal Retroaction** (après-coup)
   - Signifiers arrive sequentially
   - Each new signifier retroactively reweights all prior meanings
   - Implements Lacan's deferred action

2. **Probabilistic Semantics**
   - Meanings are probability distributions before quilting
   - Quilting collapses distributions (point de capiton)  
   - Entropy measures uncertainty

3. **Syntagmatic Dimension**
   - FCA only has paradigmatic (vertical) axis
   - We add syntagmatic (horizontal) graph
   - Metaphor vs. metonymy distinction

4. **Subject as Gap**
   - Classical FCA: everything is in the lattice
   - Lacanian: subject is structural void between signifiers
   - $\perp$ (bottom type) represents lack

### Relationship to FCA

```
Enhanced Lacanian FCA = FCA + Temporal + Probabilistic + Syntagmatic + Quilting
```

See [../docs/fca-comparison.md](../docs/fca-comparison.md) for detailed mathematical comparison.

## Files

```
fca-enhanced/
├── core.ts                           # Schemas and types
├── fca-operations.ts                 # Classical FCA operations
├── enhanced-operations.ts            # Temporal/probabilistic/syntagmatic
├── tests/
│   ├── fca-basic.test.ts            # FCA correctness tests
│   └── temporal-quilting.test.ts    # Enhanced operations tests
└── README.md                         # This file
```

## Complexity

- **Time Complexity:**
  - Next Closure: $O(|G| \cdot |M| \cdot |C|)$ where $|C|$ is number of concepts
  - Bayesian update: $O(|G| \cdot |D|)$ where $|D|$ is distribution size
  - Metonymic slide: $O(steps)$

- **Space Complexity:**
  - Context: $O(|G| \cdot |M|)$ for incidence
  - Distributions: $O(|G| \cdot |D|)$
  - Lattice: $O(|C|^2)$ for order relation

## Type Safety

All operations use TypeScript + Zod for:
- **Schema validation** (Temporal Context, Concepts, etc.)
- **Type inference** (automatic type checking)
- **Runtime safety** (invalid inputs rejected)

## References

**FCA:**
- Ganter, B. & Wille, R. (1999). *Formal Concept Analysis: Mathematical Foundations*
- Davey, B.A. & Priestley, H.A. (2002). *Introduction to Lattices and Order*

**Lacanian Theory:**
- Lacan, J. (1966). *Écrits*
- Lacan, J. (1975). *Seminar XX: Encore*

**Integration:**
- Wolff, K.E. (1993). "Temporal Concept Analysis"
- See [comparison document](../docs/fca-comparison.md)

---

**The unconscious is structured like a formal concept lattice - but one that evolves temporally, collapses probabilistically, and leaves gaps for the subject.**
