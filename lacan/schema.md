# Computational Structure of the Symbolic Order

## I. Atomic Units

**Signifier** (minimal distinguishable unit)
```
Signifier {
    id: Symbol
    acoustic: PhonemeSequence
    features: Set<Feature>        // what it IS
    negations: Set<Feature>       // what it is NOT (finite, domain-specific)
}
```

**Feature** (dimension of distinction)
```
Feature {
    dimension: Dimension          // axis of variation
    value: Value                  // position on that axis
}
```

Value is differential but computationally tractable: not "everything it's not" (infinite) but explicit features in bounded opposition spaces (masculine/feminine/neuter, not infinite non-masculines).

---

## II. Relational Structure

**Symbolic Space** (the totality)
```
SymbolicSpace {
    signifiers: Set<Signifier>
    syntagmatic: SparseGraph<Signifier>      // horizontal: what can follow what
    paradigmatic: FeatureIndex<Signifier>    // vertical: what can substitute what
}
```

Two orthogonal axes:
- **Syntagmatic** (contiguity, combination): explicit sparse graph of attested sequences
- **Paradigmatic** (similarity, substitution): implicit, computed via feature overlap

**Similarity** O(f) where f = feature count
```
similarity(S1, S2) → Real
    shared = S1.features ∩ S2.features
    conflicting = (S1.features ∩ S2.negations) ∪ (S2.features ∩ S1.negations)
    return |shared| / (|S1.features| + |S2.features|) - penalty(conflicting)
```

High similarity → can substitute (paradigmatic operation)
Low similarity → metaphor (high semantic cost)

---

## III. Signifying Chains

**Chain** (ordered sequence with deferred meaning)
```
Chain {
    signifiers: [Signifier]
    interpretations: [Distribution<Meaning>]  // probability distributions, not fixed values
    quilting_indices: Set<Index>              // where meaning crystallizes
}
```

**Meaning** (contextually determined bundle)
```
Meaning {
    features: FeatureBundle
    context_signature: Hash
    confidence: Real
}
```

Key principle: interpretations start as distributions over possibilities, collapse only at quilting points.

---

## IV. Core Operations

### Metonymy (horizontal slide along contiguity)

```
metonymic_slide(S: Signifier, Graph, steps: Int) → Path
    path = [S]
    current = S
    for _ in 1..steps:
        next = sample(Graph.adjacency[current])
        path.append(next)
        current = next
    return path
```

Complexity: **O(k)** where k = steps
Effect: meaning perpetually deferred through contiguous associations

### Metaphor (vertical substitution via similarity)

```
substitute(S_old, S_new, chain: Chain, pos: Index) → (Chain, Cost)
    fit = semantic_fit(S_new, context_at(chain, pos))
    
    cost = if fit < threshold then METAPHORIC else SUBSTITUTION
    
    new_chain = chain.replace_at(pos, S_new)
    propagate_features(new_chain, pos)
    
    return (new_chain, cost)
```

Complexity: **O(1)** + O(window) for feature propagation
Effect: creates new meaning when substitution violates similarity threshold

### Condensation (many → one)

```
condense(Ss: Set<Signifier>) → Signifier
    merged_features = ⋃ {S.features | S ∈ Ss}
    conflicts = find_feature_conflicts(Ss)
    resolution = resolve_conflicts(conflicts)
    acoustic = blend_acoustics([S.acoustic | S ∈ Ss])
    
    return Signifier {
        id: fresh_id(),
        acoustic: acoustic,
        features: merged_features,
        negations: resolution.negations
    }
```

Complexity: **O(n)** in number of inputs
Effect: overdetermination—multiple signifiers compressed into one

---

## V. Retroactive Determination

The central structural principle: meaning flows **backward**, not forward.

**Streaming Chain** (before fixation)
```
StreamingChain {
    signifiers: [Signifier]
    interpretations: [Distribution<Meaning>]
}
```

**Incremental Update** (as new signifiers arrive)
```
add_signifier(chain: StreamingChain, S_new: Signifier) → StreamingChain
    chain.signifiers.append(S_new)
    
    // Bayesian update: each new S reweights ALL prior interpretations
    for i in 0..len(chain)-1:
        prior = chain.interpretations[i]
        likelihood = compatibility(chain.signifiers[i], S_new, prior)
        posterior = bayes_update(prior, likelihood)
        chain.interpretations[i] = posterior
    
    chain.interpretations.append(initial_distribution(S_new))
    return chain
```

Complexity: **O(n)** per added signifier
Effect: later context continuously recontextualizes earlier signifiers

**Quilting** (crystallization at anchor point)
```
quilt(chain: StreamingChain, index: Index) → Chain
    S_anchor = chain.signifiers[index]
    
    fixed = []
    for i in 0..index:
        distribution = chain.interpretations[i]
        
        // Collapse distribution weighted by anchor affinity
        meaning = argmax({
            m: distribution[m] * anchor_affinity(m, S_anchor)
            for m in distribution
        })
        
        fixed.append(Some(meaning))
    
    return Chain {
        signifiers: chain.signifiers,
        interpretations: fixed,
        quilting_indices: {index}
    }
```

Complexity: **O(n)** one-time collapse
Effect: master signifier retroactively organizes preceding chain

---

## VI. Subject Structure

**Subject Position** (structural void)
```
SubjectPosition {
    between: (Index, Index)     // gap between S_i and S_{i+1}
    value: ⊥                    // bottom type—structurally empty
}
```

The subject is **not a signifier** but the gap signifiers create in representing it.

**Representation Relation**
```
represent_subject(S1: Signifier, chain: Chain) → SubjectPosition
    // "S1 represents subject FOR S2"
    // Subject appears in the gap this representation creates
    
    S2_index = find_next(S1, chain)
    return SubjectPosition {
        between: (index_of(S1), S2_index),
        value: ⊥
    }
```

Complexity: **O(1)** (track gaps, never compute content)
Effect: subject as absence that makes signification possible

---

## VII. Clinical Structures

**Neurotic Chain** (functional quilting)
```
neurotic_chain(space: SymbolicSpace) → Chain
    chain = generate_streaming_chain(space)
    S1 = select_master_signifier()
    return quilt(chain, position_of(S1))
```

Structure: master signifier operative, meaning fixed, repression functional

**Psychotic Chain** (foreclosure of anchor)
```
psychotic_chain(space: SymbolicSpace) → StreamingChain
    chain = generate_streaming_chain(space)
    // No quilting—all interpretations remain distributions
    return chain
```

Structure: no master signifier, free-floating meanings, chain unanchored

**Perverse Chain** (split quilting)
```
perverse_chain(space: SymbolicSpace) → SplitChain
    chain = generate_streaming_chain(space)
    S1 = select_master_signifier()
    return split_quilt(chain, S1, disavowal_mechanism)
```

Structure: "I know but nevertheless," simultaneous quilting and non-quilting

---

## VIII. Complexity Summary

| Operation | Time | Space | Effect |
|-----------|------|-------|--------|
| Value lookup | O(1) | O(f) | Feature bundle |
| Similarity | O(f) | O(1) | Feature comparison |
| Substitute | O(w) | O(1) | Metaphor/metonymy |
| Find substitutes | O(k) | O(nf) | Feature index lookup |
| Metonymic slide | O(d) | O(d) | Chain traversal |
| Condensation | O(n) | O(f) | Feature merge |
| Add signifier | O(n) | O(nm) | Update all distributions |
| Quilting | O(n) | O(n) | Collapse distributions |
| Subject position | O(1) | O(1) | Track gaps |

*where n = chain length, f = features per signifier, m = meanings per position, k = candidates, d = depth, w = window size*

---

## IX. Fundamental Properties

1. **Differential value**: no positive terms, only relational positions in feature space
2. **Retroactive determination**: meaning fixed backward from anchor points
3. **Structural causality**: effects from position in structure, not content
4. **Permanent bar**: direct access to signified impossible (S/s split)
5. **Infinite regress**: each signified becomes another signifier
6. **Subject as lack**: constitutive void, not represented but between signifiers

The system is **computationally tractable** while preserving the core structural insight: signification as a process that never terminates, meaning as differential and deferred, subject as the void that makes representation possible.