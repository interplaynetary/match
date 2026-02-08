# Effects System

Effects are **transformations on entity attributes that occur in space-time**. They model the reality that changes in the world don't happen instantaneously or in isolation — they have a location, a duration, a lifecycle, and consequences that ripple outward.

## Core Idea

A commons gets created. Slots get filled. Resources get committed. But none of these are instantaneous facts — they're **claims about changes** that must be verified against reality. The effects system makes this explicit.

An effect says: *"This attribute changed by this amount, here, during this window."*

Before it happens, it's a projection. When the moment arrives, it must be judged. After judgment, it becomes history — and everything that depended on it must reconcile.

## Anatomy

### Effect (`effect.ts`)

```
Effect
├── origin_id        stable identity, never changes across versions
├── version          increments on modification
├── author           who created this effect
├── deltas[]         batch of attribute transformations (atomic)
├── envelope         where and when in space-time
├── assertion_log[]  append-only lifecycle history
├── dependencies[]   what other effects this assumes
├── recorded_at      when the system learned of this (known_time)
├── valid_from       when the effect claims to start (valid_time)
└── valid_until      when the effect claims to end (valid_time)
```

### Delta

A single attribute change within the batch:

```
Delta
├── entity_id    what entity
├── attribute    which attribute
├── operation    set | add | subtract | multiply | append | remove
├── value        the operand
└── prior        previous value (enables reversal without log replay)
```

All deltas in an effect are **atomic** — they're asserted together or not at all. "Alice delivered 7 units of lumber to the site on Tuesday" is one effect with changes to quantity, location, and timestamp.

### Envelope

Where and when an effect applies, reusing the existing time and spatial primitives:

- **Temporal**: one-time start/end range, or recurring via the full `AvailabilityWindow` hierarchy (day schedules, week schedules, month schedules). An effect can be as precise as "3pm Tuesday" or as fuzzy as "sometime during business hours, recurring weekly."
- **Spatial**: GPS coordinates with radius, H3 cell, street address, or remote/hybrid. Same fields as `Resource`.

### Assertion Log

Effects don't have a mutable "status" field. Instead, they have an **append-only log** of lifecycle entries:

```
projected  →  future: we expect this to happen
pending    →  present: the moment has arrived, awaiting judgment
accepted   →  judged: happened as described
rejected   →  judged: did not happen
modified   →  judged: happened differently (new version created)
retracted  →  retroactive: previously accepted, now undone
```

Each entry records **who** judged, **when** (known_time), and **why** (optional note). Nothing is deleted — the full history is preserved.

### Composite Effects

Some effects emerge from the combination of others. A `CompositeEffect` extends `Effect` with:

- `composed_of`: origin_ids of constituent effects
- `merge_strategy`: how constituents combine
  - **additive**: deltas stack (two +5s become +10)
  - **overwrite**: composite's deltas replace constituents'
  - **custom**: a json-logic rule resolves the merge

Example: two people each commit partial quantities to a slot. Neither individually fills it, but together they do. The "slot is filled" fact is an emergent composite effect.

## Bitemporality

Every effect tracks two time dimensions:

- **valid_time** (`valid_from` / `valid_until`): when the effect claims to apply in the world
- **known_time** (`recorded_at`, assertion log `at` fields): when the system learned about it

This means you can ask two different questions:
- "What effects were active during February?" (valid_time query)
- "What did we believe about this effect last Tuesday?" (known_time query via `phaseAt()`)

Retroactive rejection works because of this: at known_time=now, we record that the effect at valid_time=past didn't actually happen. The original acceptance entry stays in the log — we just append a `retracted` entry that supersedes it.

## Dependencies

Effects can depend on other effects:

```
EffectDependency
├── origin_id        which effect we depend on
├── assumed_phase    what phase we assumed (projected | accepted)
├── assumed_deltas   snapshot of the values we assumed
└── binding          hard | soft
```

**Hard binding**: if the assumption breaks, the dependent is invalidated — it must be re-judged.

**Soft binding**: if the assumption breaks, the dependent degrades but persists — it gets flagged as at-risk rather than invalidated.

## Effect Stream (`effect-stream.ts`)

The stream is a **processing queue** that moves effects through their lifecycle. It's generic — it doesn't know what effects mean, only how they flow.

### Flow

```
submit(effect)
  → store + index
  → queue for processing
  → drain queue through registered processors
  → processors may assert new phases
  → phase changes trigger propagation to dependents
  → propagation actions are handled by the registered handler
```

### Pluggable Processors

You register processors for specific phase transitions:

```typescript
stream.on('projected→pending', (effect, ctx) => {
    // Check if the effect's valid_from has arrived
    // Return an AssertionEntry to transition, or null to skip
});

stream.on('pending→accepted', (effect, ctx) => {
    // Judgment logic: verify the effect against reality
});

stream.on('*→retracted', (effect, ctx) => {
    // Wildcard: handle retraction from any phase
});
```

This keeps domain logic out of the stream infrastructure. The stream handles storage, indexing, queuing, and propagation. Your processors handle the actual decisions.

### Propagation

When an effect's phase changes, the stream:

1. Finds all effects that depend on it (via the dependency index)
2. Calls `computePropagation()` to determine which dependencies are broken
3. Emits propagation actions: `invalidate` for broken hard bindings, `degrade` for broken soft bindings
4. Passes each action to the registered `PropagationHandler`

The handler decides what to do — re-queue the dependent for re-judgment, flag it for human review, etc.

### Events

The stream emits events that listeners can subscribe to:

- `submitted` — new effect entered the stream
- `phase_changed` — an effect transitioned phases
- `propagation` — a dependent was affected by a phase change
- `composed` — a composite effect was created from constituents
- `error` — a processor failed

### Indexes

The stream maintains indexes for fast lookup:

- **by entity**: which effects target a given entity
- **by phase**: which effects are in each lifecycle phase
- **by dependency**: which effects depend on a given effect

## Connection to Commons

The bridge is natural. Existing operations map onto effects:

| Commons operation | Effect equivalent |
|---|---|
| `fill()` | Submit effect with phase `projected` |
| `complete()` | Assert effect to `accepted` |
| `unfill()` | Append `retracted` to assertion log |
| Commons becomes `actual` | Composite effect emerges from slot-fill effects |
| Slot unfilled after completion | Retraction propagates to dependent composite |

The effects system doesn't replace the commons system — it provides the underlying event model that makes commons operations auditable, reversible, and reactive.

## Derivation (`derivation.ts`)

State is not stored. It's **derived** from the totality of accepted effects. The derivation layer folds effects into current values, checks constraints, and computes metabolic flows.

### Deriving State

The current value of any entity attribute is computed by:

1. Collecting all accepted effects targeting that entity + attribute
2. Sorting them by valid_time
3. Folding: applying each delta's operation sequentially
4. Result: the current derived value

```typescript
// What is the current quantity for entity "wood-supply"?
const state = derive(stream, 'wood-supply', 'quantity', 100);
// state.value = 100 + 50 (add) - 30 (subtract) - 12 (subtract) = 108
// state.contributors = ['effect-1', 'effect-2', 'effect-3']
```

This also works bitemporally — `deriveAt()` computes what we would have derived at a specific known_time, considering only effects that were accepted (and not yet retracted) at that moment.

### Constraint Checking

Constraints define what a derived value must satisfy:

- **max**: upper bound (e.g., resource capacity)
- **min**: lower bound (e.g., minimum required quantity)
- **exact**: must equal this value
- **check**: custom predicate

`checkCapacity()` is a convenience for the common case: does the total consumption of an attribute exceed a known capacity?

### Slot Satisfaction

`evaluateSlot()` brings derivation and constraints together for a single slot:

1. Collect effects bound to the slot
2. Derive state for each required attribute
3. Check each against its constraint
4. Compute metabolic flows for numeric attributes
5. Result: satisfied, partial, or unsatisfied — with full breakdown

### Commons Derivation

`deriveCommons()` aggregates slot satisfaction across all slots:

- Is the commons `actual`? (all required slots satisfied)
- What's the satisfaction ratio?
- Is the commons metabolically sustainable?

This replaces the static `computeState()` counting approach with a derivation from the effect stream — the source of truth moves from `slot.filled_by` to the set of accepted effects.

## Metabolism

Entities are not static. Attributes are being simultaneously consumed and produced by effects. The "current value" is a snapshot of an ongoing metabolic process.

### What Metabolism Measures

For any numeric attribute, `metabolize()` computes:

```
MetabolicFlow
├── production       total from 'add' deltas
├── consumption      total from 'subtract' deltas
├── net              production - consumption
├── producers[]      which effects are producing
├── consumers[]      which effects are consuming
├── *_rate_per_hour  rates derived from temporal envelopes
├── sustainable      is net >= 0?
└── hours_until_exhaustion   if depleting, when does it run out?
```

### Why It Matters

A commons might be `actual` right now — all slots satisfied. But if its attributes are being consumed faster than produced, it's on a trajectory toward failure. Metabolism makes this visible.

Example: A community tool library has 20 drills. Effects show 3 are being borrowed per week, 1 returned. Net rate: -2/week. At this metabolism, the library has 10 weeks before exhaustion. The commons is currently actual, but metabolically unsustainable.

This connects to risk factors in the match system. A match with `FRAGMENTED_TIME` or `PARTIAL_QUANTITY` risk factors is really a metabolic signal — the flows don't quite balance.

### Snapshots

`snapshot()` materializes the full derived state of an entity at a moment: all attribute values and all metabolic flows. This is the "photo" of a living process — useful for display, caching, or comparison across time.

## Architecture Summary

```
effect.ts          — schemas: Effect, Delta, Envelope, Assertion, Dependency
effect-stream.ts   — processing: queue, phase transitions, propagation, events
derivation.ts      — computation: derive state, check constraints, metabolism

Stream (stores effects, moves them through lifecycle)
    ↓
Derivation (folds effects into state, checks constraints)
    ↓
Commons (interprets derived state as slot satisfaction → actual/potential)
```

The stream is shape-agnostic — it stores and propagates. The derivation layer is domain-agnostic — it folds and checks. The commons layer interprets — it knows what "satisfied" means for its particular coordination structure.
