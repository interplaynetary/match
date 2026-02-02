# Manual vs Automatic: The Analyst's Work in Our Implementation

An audit of where human judgment is required vs what's automated.

## Overview

Our implementation automates the **structural logic** of Lacanian psychoanalysis but requires **human interpretation** at key decision points. This mirrors the actual psychoanalytic situation: the theory provides structure, the analyst provides interpretation.

## 1. ✋ MANUAL: Signifier Creation

**What:** Defining what counts as a signifier and its features

**Where:**
```typescript
const signifier = createSignifier('father', [
  ['gender', 'masculine'],
  ['generation', 'parent'],
  ['authority', true],
]);
```

**Why manual:**
- Requires semantic knowledge
- Determining **which features** are relevant
- Determining **how to categorize** (what dimensions exist)
- No automatic feature extraction from text

**Potential automation:**
```typescript
// Could use NLP/embeddings
async function autoCreateSignifier(word: string): Promise<Signifier> {
  const embedding = await getWordEmbedding(word);
  const features = extractFeaturesFromEmbedding(embedding);
  const negations = inferNegationsFromFeatures(features);
  
  return {
    id: word,
    acoustic: word.split(''),
    features,
    negations,
  };
}
```

**Difficulty:** Medium - modern NLP could help

---

## 2. ✋ MANUAL: Syntagmatic Graph Construction

**What:** Defining which signifiers can follow which (contiguity relations)

**Where:**
```typescript
const space = createSymbolicSpace(signifiers, [
  ['crown', 'king'],
  ['king', 'throne'],
  ['throne', 'palace'],
]);
```

**Why manual:**
- Requires corpus analysis or domain knowledge
- User must specify **all valid transitions**
- No automatic parsing of discourse structure

**Potential automation:**
```typescript
// Could learn from corpus
function learnSyntagmaticGraph(corpus: string[][]): Array<[string, string]> {
  const adjacencyPairs: Array<[string, string]> = [];
  
  corpus.forEach(sentence => {
    for (let i = 0; i < sentence.length - 1; i++) {
      adjacencyPairs.push([sentence[i], sentence[i + 1]]);
    }
  });
  
  return adjacencyPairs;
}
```

**Difficulty:** Easy - n-gram analysis, Markov chains

---

## 3. ✋ MANUAL: Quilting Point Selection

**What:** Where to anchor the chain

**Where:**
```typescript
const quilted = quilt(streamingChain, 3);  // Why 3? User decides
```

**Why manual:**
- Requires **interpretive judgment**
- Master signifier recognition is retroactive
- Context-dependent (clinical, linguistic, political)

**Potential automation:** (see quilting-point-determination.md)
- Sentence boundaries
- Entropy drops  
- Structural markers
- But: fundamentally interpretive

**Difficulty:** Hard - this is the analyst's core skill

---

## 4. ✋ MANUAL: Substitution Selection

**What:** Which signifier to substitute for which, and where

**Where:**
```typescript
const result = substitute(oldSignifier, newSignifier, chain, position);
//                        ^^^^^^^^^^^^ ^^^^^^^^^^^^ ^^^^^ ^^^^^^^^
//                        All manual choices
```

**Why manual:**
- Therapeutic intervention (interpretation)
- Poetic creation (metaphor)
- Requires knowing **why** you're substituting

**Potential automation:**
```typescript
// Could suggest substitutions
function suggestSubstitutions(
  chain: Chain,
  position: number,
  space: SymbolicSpace
): Array<{ signifier: Signifier; cost: SubstitutionCost; reason: string }> {
  const current = chain.signifiers[position];
  const candidates = findSubstitutes(current, space, 0.3);
  
  return candidates.map(s => ({
    signifier: s,
    cost: semanticFit(s, chain, position) < 0.5 ? 'METAPHORIC' : 'SUBSTITUTION',
    reason: explainSubstitution(current, s),
  }));
}
```

**Difficulty:** Medium - can suggest, but choosing requires interpretation

---

## 5. ✋ MANUAL: Condensation Selection

**What:** Which signifiers to condense together

**Where:**
```typescript
const dreamImage = condense([mother, teacher, boss]);
//                           ^^^^^^^^^^^^^^^^^^^^^^
//                           Why these three? Manual choice
```

**Why manual:**
- Dream interpretation is the paradigm case
- Requires recognizing **associative links**
- No algorithm for "day residue" selection

**Potential automation:**
```typescript
// Could cluster by similarity
function autoCondense(
  signifiers: Signifier[],
  threshold: number = 0.6
): Signifier[][] {
  // Cluster by similarity
  const clusters = clusterBySimilarity(signifiers, threshold);
  return clusters;
}
```

**Difficulty:** Medium - clustering is easy, knowing **which** to cluster is hard

---

## 6. ✋ MANUAL: Similarity Threshold

**What:** What counts as "similar enough" for substitution

**Where:**
```typescript
const substitutes = findSubstitutes(signifier, space, 0.5);
//                                                     ^^^
//                                                     Arbitrary threshold
```

**Why manual:**
- Different contexts need different thresholds
- Clinical vs poetic vs political discourse
- No universal "right" value

**Potential automation:**
```typescript
// Could adapt threshold by context
function adaptiveThreshold(context: 'clinical' | 'poetic' | 'political'): number {
  switch (context) {
    case 'clinical': return 0.3;  // Allow more metaphoric leaps
    case 'poetic': return 0.2;     // Even more metaphoric
    case 'political': return 0.6;  // Tighter control
  }
}
```

**Difficulty:** Easy - but requires **context classification**

---

## 7. ✋ MANUAL: Semantic Compatibility (Simplified)

**What:** How to compute compatibility between signifier and context

**Where:**
```typescript
function compatibility(
  signifier: Signifier,
  newSignifier: Signifier,
  priorDistribution: Distribution
): Distribution {
  const sim = similarity(signifier, newSignifier);
  // ↑ This is oversimplified - just uses similarity
  // Should use richer semantic model
}
```

**Why manual:**
- Current implementation: `likelihood[key] = similarity`
- Ignores **meaning content** of distributions
- No semantic database

**Potential automation:**
```typescript
function richCompatibility(
  signifier: Signifier,
  newSignifier: Signifier,
  priorDistribution: Distribution,
  semanticDB: Map<string, FeatureBundle>
): Distribution {
  const likelihood: Distribution = {};
  
  Object.entries(priorDistribution).forEach(([meaningKey, _]) => {
    const meaningFeatures = semanticDB.get(meaningKey);
    if (meaningFeatures) {
      // Compute how compatible this meaning is with new signifier
      const compat = computeFeatureCompatibility(meaningFeatures, newSignifier.features);
      likelihood[meaningKey] = compat;
    }
  });
  
  return likelihood;
}
```

**Difficulty:** Hard - requires rich semantic database

---

## 8. ✋ MANUAL: Feature Dimension Ontology

**What:** What dimensions exist, what values they can take

**Where:**
```typescript
// User must know to use these dimensions:
['gender', 'masculine']
['generation', 'parent']
// Why not ['sex', 'male'] or ['role', 'father']?
```

**Why manual:**
- No standardized ontology
- Domain-specific (clinical vs linguistic vs political)
- Arbitrary granularity

**Potential automation:**
```typescript
// Could learn from corpus
function extractOntology(corpus: Signifier[]): {
  dimensions: Set<string>;
  values: Map<string, Set<any>>;
} {
  const dimensions = new Set<string>();
  const values = new Map<string, Set<any>>();
  
  corpus.forEach(s => {
    s.features.forEach(f => {
      dimensions.add(f.dimension);
      if (!values.has(f.dimension)) {
        values.set(f.dimension, new Set());
      }
      values.get(f.dimension)!.add(f.value);
    });
  });
  
  return { dimensions, values };
}
```

**Difficulty:** Medium - but requires corpus

---

## 9. ✋ MANUAL: Initial Distributions

**What:** What meanings are possible for a signifier initially

**Where:**
```typescript
function initialDistribution(signifier: Signifier): Distribution {
  const dist: Distribution = {};
  const meaningKey = `meaning_${signifier.id}`;
  dist[meaningKey] = 1.0;  // ← Trivial: one meaning, 100% certain
  return dist;
}
```

**Why manual:**
- Currently: each signifier gets one meaning
- Should have: multiple possible meanings from start
- Requires semantic database

**Potential automation:**
```typescript
function richInitialDistribution(
  signifier: Signifier,
  semanticDB: SemanticDatabase
): Distribution {
  // Look up possible meanings
  const possibleMeanings = semanticDB.getMeanings(signifier.id);
  
  // Create uniform distribution over possibilities
  const dist: Distribution = {};
  const prob = 1.0 / possibleMeanings.length;
  
  possibleMeanings.forEach(meaning => {
    dist[meaning.id] = prob;
  });
  
  return dist;
}
```

**Difficulty:** Hard - requires comprehensive semantic database

---

## 10. ✋ MANUAL: Negation Specification

**What:** What a signifier is NOT (differential value)

**Where:**
```typescript
const masculine = createSignifier('masculine', 
  [['gender', 'masculine']],
  [['gender', 'feminine']]  // ← User specifies negations
);
```

**Why manual:**
- Saussure: value is differential (what it's NOT)
- But which negations to include?
- Finite but arbitrary

**Potential automation:**
```typescript
function inferNegations(
  signifier: Signifier,
  space: SymbolicSpace
): Feature[] {
  const negations: Feature[] = [];
  
  // For each dimension in signifier's features
  signifier.features.forEach(feature => {
    // Find other values on same dimension
    space.signifiers.forEach(other => {
      other.features.forEach(otherFeature => {
        if (otherFeature.dimension === feature.dimension &&
            otherFeature.value !== feature.value) {
          negations.push(otherFeature);
        }
      });
    });
  });
  
  return deduplicateFeatures(negations);
}
```

**Difficulty:** Easy - if space is already defined

---

## 11. ✋ MANUAL: Metonymic Path Length

**What:** How many steps to slide

**Where:**
```typescript
const path = metonymicSlide(signifier, space, 5);
//                                             ^
//                                             Why 5? Arbitrary
```

**Why manual:**
- How far does desire slide before stopping?
- Context-dependent
- No natural stopping point (desire is endless!)

**Potential automation:**
```typescript
// Could slide until some condition
function adaptiveMetonymicSlide(
  signifier: Signifier,
  space: SymbolicSpace,
  stopCondition: (path: Path) => boolean
): Path {
  let path = [signifier];
  let current = signifier;
  
  while (!stopCondition(path)) {
    const next = getNextInChain(current, space);
    if (!next) break;
    path.push(next);
    current = next;
  }
  
  return path;
}
```

**Difficulty:** Easy - but defining stop condition is interpretation

---

## 12. ✋ MANUAL: Context Window Size

**What:** How far surrounding context affects meaning

**Where:**
```typescript
function semanticFit(signifier, chain, position, windowSize = 3) {
//                                                ^^^^^^^^^^^
//                                                Arbitrary choice
}
```

**Why manual:**
- Psycholinguistic parameter
- Varies by processing style
- Trade-off: locality vs global coherence

**Potential automation:**
```typescript
// Could optimize based on prediction accuracy
function learnWindowSize(corpus: Chain[]): number {
  let bestSize = 1;
  let bestAccuracy = 0;
  
  for (let size = 1; size <= 10; size++) {
    const accuracy = evaluatePredictions(corpus, size);
    if (accuracy > bestAccuracy) {
      bestAccuracy = accuracy;
      bestSize = size;
    }
  }
  
  return bestSize;
}
```

**Difficulty:** Medium - requires labeled data

---

## Summary: Manual vs Automatic

### Currently Automatic ✅
- **Similarity computation** (given features)
- **Bayesian updates** (given compatibility function)
- **Metonymic traversal** (given graph)
- **Distribution collapse** (given anchor point)
- **Feature merging** (in condensation)
- **Subject position tracking** (structural)

### Currently Manual ✋
1. Signifier creation (features, negations)
2. Syntagmatic graph construction
3. **Quilting point selection** ⭐
4. Substitution selection
5. Condensation selection
6. Similarity thresholds
7. Semantic compatibility logic
8. Feature ontology
9. Initial distributions
10. Negation specification
11. Path lengths
12. Window sizes

### Could Be Automated (with more work) 🤖
- Feature extraction (NLP embeddings)
- Graph learning (corpus analysis)
- Quilting detection (heuristics)
- Substitution suggestions (similarity)
- Condensation clustering (similarity)
- Threshold adaptation (context)
- Ontology extraction (corpus)
- Negation inference (contrasts)

### Fundamentally Interpretive 🧠
- **Quilting point** (analyst's punctuation)
- **Substitution choice** (interpretation as intervention)
- **Condensation** (recognizing unconscious associations)
- **Threshold setting** (clinical judgment)

---

## The Analyst's Irreducible Role

Three types of manual work:

### Type 1: Data Creation
Building the symbolic space (signifiers, features, graph). Could be automated with corpus/NLP.

### Type 2: Parameter Tuning  
Setting thresholds, window sizes. Could be learned from data.

### Type 3: Interpretive Intervention
**Quilting, substitution, condensation choices**. Fundamentally requires:
- Being in the transference
- Hearing what's unsaid
- Timing (when to intervene)
- Context (clinical/political/poetic)

**Lacan's point:** The analyst's position can't be automated. The symbolic structure can be computational, but the **act** of interpretation involves the subject's desire, the Other's jouissance, the Real's resistance.

Our implementation is honest about this: it provides the **machinery** (retroaction, distributions, quilting mechanism) but requires **human input** at decision points.

---

## Roadmap: Reducing Manual Work

### Easy Wins
1. ✅ Auto-learn syntagmatic graph from corpus
2. ✅ Auto-infer negations from feature space
3. ✅ Suggest substitutions based on similarity
4. ✅ Cluster candidates for condensation

### Medium Difficulty
1. 🟡 Feature extraction via word embeddings
2. 🟡 Adaptive threshold selection
3. 🟡 Rich semantic compatibility function
4. 🟡 Quilting point heuristics

### Hard/Impossible
1. 🔴 Perfect quilting detection (requires interpretation)
2. 🔴 Automatic therapeutic intervention
3. 🔴 Unconscious association recognition
4. 🔴 Transference navigation

The goal isn't to **eliminate** the analyst but to **support** analysis with computational tools that handle structural operations, leaving interpretation where it belongs: with human subjectivity.

---

*"The psychoanalyst is the one who is supposed to know - but the knowing is in the structure, not the subject."*
