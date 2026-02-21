# Matching Architecture

How semantic matching and constraint satisfaction work together.

## Core Insight

Semantic matching answers: **"Could these things relate?"**
Constraint matching answers: **"Can this actually happen?"**

Both are necessary. A piano teacher 50km away is semantically perfect but practically useless. A nearby plumber is practically available but semantically irrelevant to your piano needs.

## The Pipeline

```
                         NEED                              CAPACITY
                           │                                   │
                           ▼                                   ▼
                    ┌─────────────┐                     ┌─────────────┐
                    │ Expressions │                     │ Expressions │
                    │  + Embedding│                     │  + Embedding│
                    └──────┬──────┘                     └──────┬──────┘
                           │                                   │
                           └─────────────┬─────────────────────┘
                                         │
                                         ▼
                    ┌────────────────────────────────────────────┐
                    │         STAGE 1: SEMANTIC MATCHING         │
                    │                                            │
                    │  1. Embedding similarity (cosine)          │
                    │  2. Category chain overlap                 │
                    │  3. Disjoint conflict check                │
                    │                                            │
                    │  Output: similarity score (0-1)            │
                    │          or BLOCKED if disjoint            │
                    └────────────────────┬───────────────────────┘
                                         │
                                         ▼
                              ┌──────────────────────┐
                              │ similarity >= 0.6 ?  │
                              └──────────┬───────────┘
                                         │
                         ┌───────────────┴───────────────┐
                         │                               │
                         ▼                               ▼
                       NO                              YES
                  (discard)                              │
                                                         ▼
                    ┌────────────────────────────────────────────┐
                    │        STAGE 2: CONSTRAINT CHECKING        │
                    │                                            │
                    │  For each constraint type present:         │
                    │                                            │
                    │  TIME:     Do availability windows         │
                    │            overlap?                        │
                    │                                            │
                    │  SPACE:    Is distance within              │
                    │            acceptable radius?              │
                    │                                            │
                    │  QUANTITY: Can capacity satisfy            │
                    │            needed amount?                  │
                    │                                            │
                    │  Output: score per dimension (0-1)         │
                    └────────────────────┬───────────────────────┘
                                         │
                                         ▼
                    ┌────────────────────────────────────────────┐
                    │           STAGE 3: SCORE FUSION            │
                    │                                            │
                    │  Geometric mean of all scores:             │
                    │                                            │
                    │  feasibility = ⁿ√(similarity ×             │
                    │                   priority ×               │
                    │                   time ×                   │
                    │                   space ×                  │
                    │                   quantity)                │
                    │                                            │
                    │  (Only includes dimensions that apply)     │
                    └────────────────────┬───────────────────────┘
                                         │
                                         ▼
                              ┌──────────────────────┐
                              │   MATCH RESULT       │
                              │                      │
                              │   • needId           │
                              │   • capacityId       │
                              │   • feasibilityScore │
                              │   • breakdown {}     │
                              └──────────────────────┘
```

## Why This Order?

**Semantic first, constraints second.**

```
All possible pairs:     N × C combinations
                             │
                             ▼
After semantic filter:  ~5-15% pass (cheap: vector math)
                             │
                             ▼
After constraints:      Same set, scored (expensive: time/space logic)
```

Semantic matching is computationally cheap (dot product of cached embeddings). Constraint checking is expensive (time zone conversion, distance calculation, availability intersection). By filtering semantically first, we avoid running expensive constraint logic on irrelevant pairs.

## Scoring Philosophy

**Geometric mean** ensures all dimensions matter:

```
arithmetic mean:  (1.0 + 1.0 + 0.0) / 3 = 0.67  ← hides the zero
geometric mean:   ³√(1.0 × 1.0 × 0.0) = 0.00   ← zero kills the score
```

A match that's perfect semantically but impossible temporally should score zero, not 0.67.

## Dimension Independence

Each constraint dimension scores independently:

```
TIME SCORE
─────────────────────────────────────────────────
  windows overlap?
    yes → 1.0
    no  → 0.0
  (future: partial overlap → proportional score)


SPACE SCORE
─────────────────────────────────────────────────
  both remote?           → 1.0
  one remote, one not?   → 0.7
  within radius?         → 1.0 - (distance / maxRadius)
  outside radius?        → 0.0
  area string match?     → 1.0 (same) or 0.3 (different)


QUANTITY SCORE
─────────────────────────────────────────────────
  units don't match?     → 0.0
  capacity >= need?      → 1.0
  capacity < need?       → capacity / need (partial)
```

## What's Not Covered (Yet)

```
┌─────────────────────────────────────────────────────────┐
│  FUTURE: COMPOSITIONAL MATCHING                         │
│                                                         │
│  "I need flour AND olive oil AND an oven"               │
│                                                         │
│  Requires matching a need against MULTIPLE capacities   │
│  and tracking partial fulfillment across the set.       │
│                                                         │
│  Current system: 1 need → N capacities (independent)    │
│  Future system:  1 need → capacity SET (combined)       │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  FUTURE: SKILLS MATCHING                                │
│                                                         │
│  "Needs someone who can teach piano at intermediate     │
│   level or higher"                                      │
│                                                         │
│  Requires skill taxonomy + level comparison.            │
│  (Infrastructure exists in skills.ts, not integrated)   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  FUTURE: TRAVEL TIME CONSTRAINTS                        │
│                                                         │
│  "Available at 2pm in Oakland, but has a commitment     │
│   at 3pm in SF - can they make it?"                     │
│                                                         │
│  Requires chaining commitments + travel estimation.     │
│  (Infrastructure exists in feasibility.ts)              │
└─────────────────────────────────────────────────────────┘
```

## Summary

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   Semantic Matching    →    "These could relate"        │
│   (embeddings +             (meaning similarity)        │
│    category chains)                                     │
│                                                         │
│           ↓ filters                                     │
│                                                         │
│   Constraint Matching  →    "This can happen"           │
│   (time + space +           (practical feasibility)     │
│    quantity)                                            │
│                                                         │
│           ↓ scores                                      │
│                                                         │
│   Geometric Mean       →    "How good is this match?"   │
│   (all dimensions)          (single 0-1 score)          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```
