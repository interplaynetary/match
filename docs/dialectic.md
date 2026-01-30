# Matching Logic: A Dialectical Introduction

*A step-by-step progression from naive questions to understanding how the system solves the coordination problem.*

---

## 1. The Core Problem

**Q: What is this system trying to do?**

A: Connect human capacities to needs. Someone has flour, someone needs flour. Someone can teach piano, someone wants to learn piano. The system finds these matches.

**Q: Isn't that just search?**

A: Search finds things that exist. Matching finds *pairs* — a capacity is only useful if there's a corresponding need, and vice versa. Both sides are active queries looking for their counterpart.

---

## 2. The Semantic Gap

**Q: If I say "I'm hungry," how does the system know I need food?**

A: It doesn't infer this automatically. The UI asks: *"What would satisfy this need?"* You respond: "vegan pizza" or "any hot meal" or "potatoes." The system stores your need in the same format as capacities — but as a placeholder waiting to be filled.

**Q: So the user does the translation from natural language to system representation?**

A: Yes. This sidesteps the hard problem of semantic understanding. The user knows what they want; the system just needs to match it.

**Q: Then what role do LLMs play?**

A: Discovery, not validation. LLM embeddings help surface *candidates* — "you have flour; here's a vegan pizza recipe that needs flour." But whether something *actually* matches is determined by explicit user declarations.

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| **Discovery** | LLM embeddings | Surface candidates you might not have thought of |
| **Validation** | Explicit declarations | Confirm structural match |

---

## 3. Needs as Placeholders

**Q: You said needs are stored "in the same format as capacities." What does that mean?**

A: A capacity says "I have X with these constraints." A need says "I want X with these constraints" — same structure, but it's a hole waiting to be filled rather than a thing that exists.

**Q: Can a need be satisfied in multiple ways?**

A: Yes. A need can have multiple expressions at different abstraction levels:

```
Need: "I want vegan pizza"
Expressions:
  - "vegan pizza" (most specific)
  - "pizza"
  - "Italian food"
  - "food" (fallback)
```

Any capacity with similar expressions can match — more specific matches rank higher via priority weighting.

---

## 4. Compositional Matching

**Q: In that flour+oil+tomatoes example, those are different capacities. Do they need to come from different people?**

A: They can come from multiple agents, but the need only counts as satisfied if ALL components are matched within an acceptable time window.

**Q: So it's not just "all exist" but "all can be coordinated"?**

A: Exactly. This is a constraint satisfaction problem, not just retrieval:

```
∀ component ∈ AND-group:
  ∃ capacity that matches component
  ∧ all matched capacities have overlapping availability window
```

**Q: What if I find flour available Monday and tomatoes available Friday?**

A: No match. The time windows don't overlap sufficiently for the composite need.

---

## 5. Semantic Matching via Expressions

**Q: How does the system know that a "piano teacher" matches with "looking for piano lessons"?**

A: Through semantic similarity of embeddings. Each capacity and need has multiple *expressions* — text descriptions at different abstraction levels. These get embedded using an LLM, and matching uses cosine similarity.

**Q: What are expressions?**

A: Multiple ways to describe the same thing, from specific to general:

```
Capacity: "I can teach piano"
Expressions:
  - "Classical piano lessons for beginners" (priority 1)
  - "Piano teacher" (priority 2)
  - "Music lessons" (priority 3)
  - "Teaching" (priority 4)
```

**Q: Why multiple expressions instead of just one description?**

A: Flexible matching at different abstraction levels. If no one needs exactly "classical piano for beginners," you might still match someone looking for "music lessons." Lower priority matches rank lower but still surface.

**Q: How does this handle asymmetric pairings like teacher/student?**

A: The embeddings understand semantic relationships. "Piano teacher" and "looking for piano lessons" have high cosine similarity because they describe complementary roles. No hardcoded type rules needed.

---

## 6. Bidirectional Queries

**Q: You mentioned both needs AND capacities are "active queries." What does that mean?**

A: When you post a capacity ("I have flour"), it becomes a standing query: "find needs that could use flour." When you post a need ("I need flour"), it becomes a standing query: "find capacities that provide flour."

Both sides are searching. A match happens when a capacity-query finds a need AND that need's query would find that capacity.

**Q: Why bidirectional? Couldn't needs just search for capacities?**

A: Bidirectional enables discovery. If I post flour without knowing about the vegan pizza project, the system can suggest: "Your flour could help this pizza-making effort that needs ingredients."

---

## 7. Feasibility Scoring

**Q: How do you rank matches when multiple capacities could satisfy a need?**

A: Feasibility evaluation functions score different dimensions:

- **Time Score**: Do availability windows overlap meaningfully?
- **Location Score**: Distance decay from 1.0 at same location to 0.0 at max radius
- **Skills Score**: Does the capacity meet skill requirements?
- **Travel Score**: Can the agent physically get there given other commitments?
- **Affinity Score**: Social trust, reputation, prior interactions

**Q: How do these combine?**

A: TBD — could be multiplicative, minimum, weighted sum. The choice affects which matches surface.

**Q: Is feasibility just for ranking, or can it disqualify matches?**

A: For compositional needs, time feasibility is a hard gate. All components must be feasible within the same window, or the composite match fails entirely.

---

## 8. The Data Model

```typescript
type Expression = {
  text: string
  priority?: number  // lower = more specific, higher weight
}

type Capacity = {
  id: string
  expressions: Expression[]  // what this offers
  constraints?: Constraints
  embedding?: number[]       // computed from expressions
}

type Need = {
  id: string
  expressions: Expression[]  // what would satisfy this
  constraints?: Constraints
  embedding?: number[]       // computed from expressions
}

type MatchResult = {
  needId: string
  capacityId: string
  feasibilityScore: number   // 0-1, geometric mean of all scores
  matchedExpressions: {
    need: Expression
    capacity: Expression
    similarity: number       // cosine similarity
  }
  breakdown: {
    similarity: number       // embedding cosine similarity
    priorityWeight: number   // based on matched expression priorities
    time?: number
    space?: number
    quantity?: number
  }
}

type Constraints = {
  time?: { availableFrom?: string; availableTo?: string }
  space?: { area?: string; remote?: boolean }
  quantity?: { amount: number; unit: string }
}
```

---

## 9. Open Questions

- How do compositional matches get proposed to users? Do you show partial matches ("we have flour and oil, just need tomatoes")?
- When embeddings suggest a novel compatibility, how does the user confirm it becomes a valid satisfaction path?
- How does the system handle capacity consumption? If flour is matched to pizza-making, is it still available for bread-making?
- What's the granularity of time windows? Continuous vs discrete slots?

---

## Summary

The matching system solves coordination through:

1. **Expression-based matching** — multiple descriptions at different abstraction levels
2. **Semantic similarity via embeddings** — LLM embeddings enable flexible matching without hardcoded rules
3. **Priority weighting** — specific matches rank higher than generic ones
4. **Bidirectional queries** — both needs and capacities actively search
5. **Constraint satisfaction** — time, space, quantity constraints gate feasibility
6. **Feasibility scoring** — geometric mean of similarity, priority, and constraint scores
