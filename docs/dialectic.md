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

A: Yes. When declaring a need, you can specify alternative satisfaction paths:

```
Need: "I want vegan pizza"
Can be satisfied by:
  - "vegan pizza" (someone has one)
  - ["flour", "olive oil", "tomatoes", "oven access"] (I'll make it myself if I get ingredients)
```

These alternatives are OR'd together — any path works.

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

## 5. Type Compatibility

**Q: How does the system know that a "host" matches with a "guest"?**

A: This is the type compatibility problem. Unlike simple equality matching (flour matches flour), some types have complementary relationships:

- Host ↔ Guest (hospitality)
- Teacher ↔ Student (role-based)
- Buyer ↔ Seller (transactional)
- Coach ↔ Athlete (training)

**Q: Who declares these relationships?**

A: The user, when expressing their need or capacity. "I'm a host looking for a guest" explicitly declares the compatible type. It's like DNA base pairing (A↔T, C↔G) — the compatibility is part of the type definition.

**Q: Can this be done statically, or does it require semantic understanding?**

A: For well-known pairings (host/guest, buyer/seller), it can be static. For novel pairings, embeddings can suggest compatibility, but the user confirms.

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
type SatisfactionPath =
  | { type: 'direct'; capacityType: string }
  | { type: 'composite'; all: SatisfactionPath[] }

type Need = {
  id: string
  embedding: number[]              // for discovery
  satisfiedBy: SatisfactionPath[]  // OR of these paths
  constraints: Constraints
}

type Capacity = {
  id: string
  embedding: number[]              // for discovery
  capacityType: string
  constraints: Constraints
}

type Constraints = {
  time?: {
    start: Date
    end: Date
    availabilityWindows?: TimeWindow[]
    minDuration?: number
  }
  space?: {
    location: GeoPoint
    maxRadius: number
  }
  quantity?: {
    amount: number
    unit: string
    minAtomic?: number
  }
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

1. **User-declared satisfaction paths** — avoiding the semantic inference problem
2. **Bidirectional queries** — both needs and capacities actively search
3. **LLM embeddings for discovery** — surfacing candidates users might not find
4. **Explicit validation** — users confirm what actually matches
5. **Constraint satisfaction** — compositional needs require temporally-feasible combinations
6. **Feasibility scoring** — ranking matches by time, space, skills, trust
